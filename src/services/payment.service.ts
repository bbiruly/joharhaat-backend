import { createHmac, randomUUID } from 'node:crypto';
import { PaymentIntentStatus, PaymentMethod, PaymentStatus, Prisma, ReservationStatus } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';

export async function createIntent(userId: string, orderId: string, method: PaymentMethod, idempotencyKey: string) {
  const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId: userId } });
  if (!order) throw new ApiError(404, 'Order was not found.', 'ORDER_NOT_FOUND');
  if (method === PaymentMethod.COD && order.totalPayable.greaterThan(5000)) throw new ApiError(422, 'COD is available only for orders up to ₹5,000.', 'COD_INELIGIBLE');
  const items = await prisma.orderItem.findMany({ where: { vendorOrder: { orderId } } });
  return prisma.paymentIntent.create({ data: { orderId, idempotencyKey, method, amount: order.totalPayable, expiresAt: new Date(Date.now() + 15 * 60_000), providerRef: `MOCK-${randomUUID()}`, reservations: { create: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, expiresAt: new Date(Date.now() + 15 * 60_000) })) } } });
}

export async function transitionIntent(userId: string, intentId: string, status: PaymentIntentStatus, eventKey = randomUUID()) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findFirst({ where: { id: intentId, order: { customerId: userId } }, include: { order: true } });
    if (!intent) throw new ApiError(404, 'Payment intent was not found.', 'PAYMENT_INTENT_NOT_FOUND');
    if (intent.status === PaymentIntentStatus.SUCCEEDED || intent.status === PaymentIntentStatus.FAILED || intent.status === PaymentIntentStatus.CANCELLED) return intent;
    const reservations = await tx.inventoryReservation.findMany({ where: { paymentIntentId: intent.id, status: ReservationStatus.ACTIVE } });
    const updated = await tx.paymentIntent.update({ where: { id: intent.id }, data: { status } });
    await tx.paymentEvent.create({ data: { paymentIntentId: intent.id, eventKey, status, payload: { source: 'mock-api' } } });
    await tx.order.update({ where: { id: intent.orderId }, data: { paymentStatus: status === PaymentIntentStatus.SUCCEEDED ? PaymentStatus.PAID : status === PaymentIntentStatus.FAILED ? PaymentStatus.FAILED : PaymentStatus.PENDING } });
    const releasesStock = status === PaymentIntentStatus.FAILED || status === PaymentIntentStatus.CANCELLED;
    if (releasesStock) for (const reservation of reservations) { const restored = await tx.productVariant.update({ where: { id: reservation.variantId }, data: { stock: { increment: reservation.quantity }, version: { increment: 1 } } }); await tx.productVariant.update({ where: { id: restored.id }, data: { lowStock: restored.stock < env.LOW_STOCK_THRESHOLD } }); }
    await tx.inventoryReservation.updateMany({ where: { paymentIntentId: intent.id, status: ReservationStatus.ACTIVE }, data: { status: status === PaymentIntentStatus.SUCCEEDED ? ReservationStatus.CONSUMED : ReservationStatus.RELEASED } });
    return updated;
  });
}

export function verifyWebhook(payload: string, signature: string): boolean { return createHmac('sha256', env.MOCK_WEBHOOK_SECRET).update(payload).digest('hex') === signature; }
export async function expireReservations() { const now = new Date(); const intents = await prisma.paymentIntent.findMany({ where: { expiresAt: { lte: now }, status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.PROCESSING] } }, include: { reservations: { where: { status: ReservationStatus.ACTIVE } } } }); for (const intent of intents) await prisma.$transaction(async (tx) => { for (const reservation of intent.reservations) { const restored = await tx.productVariant.update({ where: { id: reservation.variantId }, data: { stock: { increment: reservation.quantity }, version: { increment: 1 } } }); await tx.productVariant.update({ where: { id: restored.id }, data: { lowStock: restored.stock < env.LOW_STOCK_THRESHOLD } }); } await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: PaymentIntentStatus.EXPIRED } }); await tx.inventoryReservation.updateMany({ where: { paymentIntentId: intent.id, status: ReservationStatus.ACTIVE }, data: { status: ReservationStatus.EXPIRED } }); }); return intents.length; }
