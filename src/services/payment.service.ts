import { createHmac, randomUUID } from 'node:crypto';
import {
  PaymentIntentStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ReservationStatus,
} from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';

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
  const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey }, include: { order: true } });
  if (existing) {
    if (existing.order.customerId !== userId || existing.orderId !== orderId) throw new ApiError(409, 'This idempotency key belongs to another payment.', 'IDEMPOTENCY_KEY_CONFLICT');
    return existing;
  }
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, customerId: userId } });
    if (!order) throw new ApiError(404, 'Order was not found.', 'ORDER_NOT_FOUND');
    if (confirmedPaymentStatuses.includes(order.paymentStatus)) throw new ApiError(409, 'This order payment is already confirmed.', 'ORDER_ALREADY_PAID');
    if (method === PaymentMethod.COD && order.totalPayable.greaterThan(5000)) throw new ApiError(422, 'COD is available only for orders up to ₹5,000.', 'COD_INELIGIBLE');

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
    return tx.paymentIntent.create({ data: { orderId, idempotencyKey, method, amount: order.totalPayable, expiresAt, providerRef: `MOCK-${randomUUID()}`, reservations: { create: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, expiresAt })) } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function transitionIntent(userId: string, intentId: string, status: PaymentIntentStatus, eventKey: string = randomUUID()) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findFirst({ where: { id: intentId, order: { customerId: userId } }, include: { order: true } });
    if (!intent) throw new ApiError(404, 'Payment intent was not found.', 'PAYMENT_INTENT_NOT_FOUND');
    if (terminalIntentStatuses.includes(intent.status)) return intent;
    if (intent.expiresAt <= new Date()) status = PaymentIntentStatus.EXPIRED;
    const updated = await tx.paymentIntent.update({ where: { id: intent.id }, data: { status } });
    await tx.paymentEvent.upsert({ where: { eventKey }, create: { paymentIntentId: intent.id, eventKey, status, payload: { source: 'mock-api' } }, update: {} });

    if (status === PaymentIntentStatus.SUCCEEDED) {
      await tx.order.update({ where: { id: intent.orderId }, data: { paymentStatus: intent.method === PaymentMethod.COD ? PaymentStatus.AUTHORIZED : PaymentStatus.PAID } });
      await tx.inventoryReservation.updateMany({ where: { paymentIntentId: intent.id, status: ReservationStatus.ACTIVE }, data: { status: ReservationStatus.CONSUMED } });
      await finalizeCoupon(tx, intent.orderId);
    } else if (status === PaymentIntentStatus.FAILED || status === PaymentIntentStatus.CANCELLED || status === PaymentIntentStatus.EXPIRED) {
      await releaseReservations(tx, intent.id, status === PaymentIntentStatus.EXPIRED ? ReservationStatus.EXPIRED : ReservationStatus.RELEASED);
      await releaseCoupon(tx, intent.orderId);
      await tx.order.update({ where: { id: intent.orderId }, data: { paymentStatus: PaymentStatus.FAILED } });
    }
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getPaymentState(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId: userId }, include: { paymentIntents: { include: { reservations: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!order) throw new ApiError(404, 'Order was not found.', 'ORDER_NOT_FOUND');
  const intent = order.paymentIntents[0] ?? null;
  return { orderId, paymentStatus: order.paymentStatus, intent, allowedRetry: !confirmedPaymentStatuses.includes(order.paymentStatus) && (!intent || terminalIntentStatuses.includes(intent.status)) };
}

export function verifyWebhook(payload: string, signature: string): boolean {
  return createHmac('sha256', env.MOCK_WEBHOOK_SECRET).update(payload).digest('hex') === signature;
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
