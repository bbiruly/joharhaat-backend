import { randomUUID } from 'node:crypto';
import {
  PaymentIntentStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ReservationStatus,
} from '../generated/prisma/client.js';
import { env, integrations } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { razorpay, rupeesToPaise, verifyPaymentSignature } from './razorpay.service.js';
import { recalculateOrderCommissions } from './influencer-commission.service.js';

const terminalIntentStatuses: PaymentIntentStatus[] = [PaymentIntentStatus.SUCCEEDED, PaymentIntentStatus.FAILED, PaymentIntentStatus.CANCELLED, PaymentIntentStatus.EXPIRED];
const activeIntentStatuses: PaymentIntentStatus[] = [PaymentIntentStatus.CREATED, PaymentIntentStatus.PROCESSING];
const confirmedPaymentStatuses: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.AUTHORIZED];

async function setLowStock(tx: Prisma.TransactionClient, variantId: string) {
  const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await tx.productVariant.update({ where: { id: variantId }, data: { lowStock: variant.stock < env.LOW_STOCK_THRESHOLD } });
}

async function releaseReservations(tx: Prisma.TransactionClient, intentId: string, finalStatus: ReservationStatus) {
  const reservations = await tx.inventoryReservation.findMany({ where: { paymentIntentId: intentId, status: ReservationStatus.ACTIVE } });
  for (const reservation of reservations) {
    await tx.productVariant.update({ where: { id: reservation.variantId }, data: { stock: { increment: reservation.quantity }, version: { increment: 1 } } });
    await setLowStock(tx, reservation.variantId);
  }
  await tx.inventoryReservation.updateMany({ where: { paymentIntentId: intentId, status: ReservationStatus.ACTIVE }, data: { status: finalStatus } });
}

async function releaseCoupon(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order || order.couponFinalized) return;
  await tx.couponRedemption.deleteMany({ where: { orderId } });
}

async function finalizeCoupon(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order?.couponCode || order.couponFinalized) return;
  const coupon = await tx.coupon.findUnique({ where: { code: order.couponCode } });
  if (!coupon) throw new ApiError(409, 'The order coupon no longer exists.', 'COUPON_UNAVAILABLE');
  await tx.couponRedemption.upsert({
    where: { orderId },
    create: { couponId: coupon.id, userId: order.customerId, orderId, discountAmount: order.discount },
    update: {},
  });
  await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
  await tx.order.update({ where: { id: orderId }, data: { couponFinalized: true } });
}

export async function createIntent(userId: string, orderId: string, method: PaymentMethod, idempotencyKey: string) {
  if (method !== PaymentMethod.UPI) throw new ApiError(422, 'Only UPI is available in this release.', 'PAYMENT_METHOD_UNAVAILABLE');
  if (!integrations.razorpay) throw new ApiError(503, 'Online payments are not configured in this environment.', 'PAYMENT_PROVIDER_NOT_CONFIGURED');

  const expired = await prisma.paymentIntent.findMany({
    where: { orderId, status: { in: activeIntentStatuses }, expiresAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const intent of expired)
    await transitionIntent(userId, intent.id, PaymentIntentStatus.EXPIRED, `expiry:${intent.id}`);

  const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey }, include: { order: true } });
  if (existing) {
    if (existing.order.customerId !== userId || existing.orderId !== orderId) throw new ApiError(409, 'This idempotency key belongs to another payment.', 'IDEMPOTENCY_KEY_CONFLICT');
    if (existing.method !== method) throw new ApiError(409, 'This idempotency key belongs to another payment method.', 'IDEMPOTENCY_KEY_CONFLICT');
    return checkoutIntent(existing);
  }
  const intent = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, customerId: userId } });
    if (!order) throw new ApiError(404, 'Order was not found.', 'ORDER_NOT_FOUND');
    if (confirmedPaymentStatuses.includes(order.paymentStatus)) throw new ApiError(409, 'This order payment is already confirmed.', 'ORDER_ALREADY_PAID');

    const active = await tx.paymentIntent.findFirst({ where: { orderId, status: { in: activeIntentStatuses } }, orderBy: { createdAt: 'desc' } });
    if (active) {
      if (active.method !== method) throw new ApiError(409, 'Another payment method is already active for this order.', 'PAYMENT_ALREADY_ACTIVE');
      return active;
    }

    const items = await tx.orderItem.findMany({ where: { vendorOrder: { orderId } } });
    const previous = await tx.paymentIntent.findFirst({ where: { orderId, status: { in: terminalIntentStatuses } }, orderBy: { createdAt: 'desc' } });
    if (previous && previous.status !== PaymentIntentStatus.SUCCEEDED) {
      for (const item of items) {
        const reserved = await tx.productVariant.updateMany({ where: { id: item.variantId, isActive: true, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, version: { increment: 1 } } });
        if (!reserved.count) throw new ApiError(409, `${item.productName} no longer has enough stock for payment retry.`, 'INSUFFICIENT_STOCK');
        await setLowStock(tx, item.variantId);
      }
    }
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    return tx.paymentIntent.create({ data: { orderId, idempotencyKey, method, amount: order.totalPayable, expiresAt, reservations: { create: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, expiresAt })) } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (intent.providerOrderId) return checkoutIntent(intent);
  try {
    const providerOrder = await razorpay.orders.create({ amount: rupeesToPaise(intent.amount.toFixed(2)), currency: 'INR', receipt: intent.id, notes: { localOrderId: orderId, paymentIntentId: intent.id } });
    const updated = await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerOrderId: providerOrder.id, providerRef: providerOrder.id, status: PaymentIntentStatus.PROCESSING } });
    return checkoutIntent(updated);
  } catch {
    await transitionIntent(userId, intent.id, PaymentIntentStatus.FAILED, `provider-create:${intent.id}`);
    throw new ApiError(502, 'Payment provider is temporarily unavailable.', 'PAYMENT_PROVIDER_UNAVAILABLE');
  }
}

function checkoutIntent<T extends { id: string; method: PaymentMethod; status: PaymentIntentStatus; amount: Prisma.Decimal; expiresAt: Date; providerOrderId: string | null }>(intent: T) {
  return { ...intent, razorpayOrderId: intent.providerOrderId, razorpayKeyId: env.RAZORPAY_KEY_ID, currency: 'INR', amountPaise: rupeesToPaise(intent.amount.toFixed(2)) };
}

export async function transitionIntent(userId: string, intentId: string, status: PaymentIntentStatus, eventKey: string = randomUUID()) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findFirst({ where: { id: intentId, order: { customerId: userId } }, include: { order: { include: { customer: true, vendorOrders: { include: { vendor: { include: { owner: true } } } } } } } });
    if (!intent) throw new ApiError(404, 'Payment intent was not found.', 'PAYMENT_INTENT_NOT_FOUND');
    if (terminalIntentStatuses.includes(intent.status)) return intent;
    if (intent.expiresAt <= new Date()) status = PaymentIntentStatus.EXPIRED;
    const updated = await tx.paymentIntent.update({ where: { id: intent.id }, data: { status } });
    await tx.paymentEvent.upsert({ where: { eventKey }, create: { paymentIntentId: intent.id, eventKey, status, payload: { source: 'razorpay' } }, update: {} });

    if (status === PaymentIntentStatus.SUCCEEDED) {
      await tx.order.update({ where: { id: intent.orderId }, data: { paymentStatus: intent.method === PaymentMethod.COD ? PaymentStatus.AUTHORIZED : PaymentStatus.PAID } });
      await recalculateOrderCommissions(tx, intent.orderId);
      await tx.inventoryReservation.updateMany({ where: { paymentIntentId: intent.id, status: ReservationStatus.ACTIVE }, data: { status: ReservationStatus.CONSUMED } });
      await finalizeCoupon(tx, intent.orderId);
      if (intent.order.customer.email) await tx.emailOutbox.upsert({ where: { dedupeKey: `order-paid:${intent.orderId}` }, update: {}, create: { dedupeKey: `order-paid:${intent.orderId}`, recipient: intent.order.customer.email, subject: `Payment confirmed for ${intent.order.orderNumber}`, template: 'order-paid', payload: { name: intent.order.customer.name, orderNumber: intent.order.orderNumber } } });
      for (const vendorOrder of intent.order.vendorOrders) if (vendorOrder.vendor.owner.email) await tx.emailOutbox.upsert({ where: { dedupeKey: `vendor-new-order:${vendorOrder.id}` }, update: {}, create: { dedupeKey: `vendor-new-order:${vendorOrder.id}`, recipient: vendorOrder.vendor.owner.email, subject: `New JoharHaat order ${intent.order.orderNumber}`, template: 'vendor-new-order', payload: { name: vendorOrder.vendor.owner.name, orderNumber: intent.order.orderNumber, vendorOrderId: vendorOrder.id } } });
    } else if (status === PaymentIntentStatus.FAILED || status === PaymentIntentStatus.CANCELLED || status === PaymentIntentStatus.EXPIRED) {
      await releaseReservations(tx, intent.id, status === PaymentIntentStatus.EXPIRED ? ReservationStatus.EXPIRED : ReservationStatus.RELEASED);
      await releaseCoupon(tx, intent.orderId);
      await tx.order.update({ where: { id: intent.orderId }, data: { paymentStatus: PaymentStatus.FAILED } });
      if (intent.order.customer.email) await tx.emailOutbox.upsert({ where: { dedupeKey: `payment-failed:${intent.id}` }, update: {}, create: { dedupeKey: `payment-failed:${intent.id}`, recipient: intent.order.customer.email, subject: `Payment needs attention for ${intent.order.orderNumber}`, template: 'payment-failed', payload: { name: intent.order.customer.name, orderNumber: intent.order.orderNumber } } });
    }
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function verifyCheckout(userId: string, intentId: string, input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  if (!integrations.razorpay) throw new ApiError(503, 'Online payments are not configured in this environment.', 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  const intent = await prisma.paymentIntent.findFirst({ where: { id: intentId, order: { customerId: userId } } });
  if (!intent || !intent.providerOrderId) throw new ApiError(404, 'Payment intent was not found.', 'PAYMENT_INTENT_NOT_FOUND');
  if (intent.providerOrderId !== input.razorpayOrderId || !verifyPaymentSignature(intent.providerOrderId, input.razorpayPaymentId, input.razorpaySignature)) throw new ApiError(401, 'Payment signature is invalid.', 'INVALID_PAYMENT_SIGNATURE');
  const providerPayment = await razorpay.payments.fetch(input.razorpayPaymentId);
  if (providerPayment.order_id !== intent.providerOrderId || Number(providerPayment.amount) !== rupeesToPaise(intent.amount.toFixed(2)) || providerPayment.currency !== 'INR' || providerPayment.status !== 'captured') throw new ApiError(409, 'Payment provider state does not match this order.', 'PAYMENT_STATE_MISMATCH');
  await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerPaymentId: input.razorpayPaymentId, verifiedAt: new Date() } });
  return transitionIntent(userId, intent.id, PaymentIntentStatus.SUCCEEDED, `checkout:${input.razorpayPaymentId}`);
}

export async function handleRazorpayWebhook(eventId: string, payload: any) {
  if (!integrations.razorpay) throw new ApiError(503, 'Online payments are not configured in this environment.', 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  const payment = payload?.payload?.payment?.entity;
  if (!payment?.order_id) return { accepted: true };
  const intent = await prisma.paymentIntent.findUnique({ where: { providerOrderId: String(payment.order_id) }, include: { order: true } });
  if (!intent) return { accepted: true };
  if (payload.event === 'payment.captured') {
    if (Number(payment.amount) !== rupeesToPaise(intent.amount.toFixed(2)) || payment.currency !== 'INR') throw new ApiError(409, 'Webhook amount does not match the payment intent.', 'PAYMENT_STATE_MISMATCH');
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerPaymentId: String(payment.id), verifiedAt: new Date() } });
    await transitionIntent(intent.order.customerId, intent.id, PaymentIntentStatus.SUCCEEDED, eventId);
  } else if (payload.event === 'payment.failed') {
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerPaymentId: String(payment.id), failureCode: String(payment.error_code ?? 'PAYMENT_FAILED') } });
    await transitionIntent(intent.order.customerId, intent.id, PaymentIntentStatus.FAILED, eventId);
  }
  return { accepted: true };
}

export async function getPaymentState(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId: userId }, include: { paymentIntents: { include: { reservations: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!order) throw new ApiError(404, 'Order was not found.', 'ORDER_NOT_FOUND');
  const intent = order.paymentIntents[0] ?? null;
  return { orderId, paymentStatus: order.paymentStatus, intent, allowedRetry: !confirmedPaymentStatuses.includes(order.paymentStatus) && (!intent || terminalIntentStatuses.includes(intent.status)) };
}

export async function expireReservations() {
  const now = new Date();
  const intents = await prisma.paymentIntent.findMany({ where: { expiresAt: { lte: now }, status: { in: activeIntentStatuses } } });
  for (const intent of intents) await transitionIntent((await prisma.order.findUniqueOrThrow({ where: { id: intent.orderId } })).customerId, intent.id, PaymentIntentStatus.EXPIRED, `expiry:${intent.id}`);

  const cutoff = new Date(Date.now() - 15 * 60_000);
  const orphanOrders = await prisma.order.findMany({ where: { paymentStatus: PaymentStatus.PENDING, createdAt: { lte: cutoff }, paymentIntents: { none: {} } }, include: { vendorOrders: { include: { items: true } } } });
  for (const order of orphanOrders) await prisma.$transaction(async (tx) => {
    const locked = await tx.order.updateMany({ where: { id: order.id, paymentStatus: PaymentStatus.PENDING, paymentIntents: { none: {} } }, data: { paymentStatus: PaymentStatus.FAILED } });
    if (!locked.count) return;
    for (const item of order.vendorOrders.flatMap((vendorOrder) => vendorOrder.items)) {
      await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity }, version: { increment: 1 } } });
      await setLowStock(tx, item.variantId);
    }
    await releaseCoupon(tx, order.id);
  });
  return intents.length + orphanOrders.length;
}

export async function reconcileProcessingPayments() {
  if (!integrations.razorpay) return 0;
  const intents = await prisma.paymentIntent.findMany({ where: { status: PaymentIntentStatus.PROCESSING, providerOrderId: { not: null }, updatedAt: { lte: new Date(Date.now() - 60_000) } }, include: { order: true }, take: 50, orderBy: { updatedAt: 'asc' } });
  for (const intent of intents) {
    const result = await razorpay.orders.fetchPayments(intent.providerOrderId!);
    const payments = Array.isArray(result) ? result : result.items;
    const captured = payments.find((payment: any) => payment.status === 'captured');
    const failed = payments.find((payment: any) => payment.status === 'failed');
    if (captured) {
      if (Number(captured.amount) !== rupeesToPaise(intent.amount.toFixed(2)) || captured.currency !== 'INR') continue;
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerPaymentId: String(captured.id), verifiedAt: new Date() } });
      await transitionIntent(intent.order.customerId, intent.id, PaymentIntentStatus.SUCCEEDED, `reconcile:${captured.id}`);
    } else if (failed) {
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerPaymentId: String(failed.id), failureCode: String(failed.error_code ?? 'PAYMENT_FAILED') } });
      await transitionIntent(intent.order.customerId, intent.id, PaymentIntentStatus.FAILED, `reconcile:${failed.id}`);
    }
  }
  return intents.length;
}
