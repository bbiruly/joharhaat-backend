import { InfluencerCommissionLedgerType, PaymentStatus, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { pagination } from '../utils/pagination.js';
import { logAudit, writeAudit } from '../utils/audit-log.js';
import { codeOf } from '../config/status-codes.js';
import { adminAccess } from './admin.service.js';
import { commissionFor, payableForCommission, settlementFitsBalance, settlementRequestAlreadyRecorded } from './influencer-commission.rules.js';

const MARKETING = 'marketing:manage' as const;
const FINANCE = 'payouts:manage' as const;
const MAX_RATE = 50;

const percent = (rate: Prisma.Decimal) => rate.mul(100).toNumber();
const fraction = (rate: number) => new Prisma.Decimal(rate).div(100);

export function assertRate(rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE)
    throw new ApiError(422, `Commission rate must be between 0 and ${MAX_RATE} percent.`, 'INFLUENCER_RATE_INVALID');
}

export async function influencers(userId: string) {
  await adminAccess(userId, MARKETING);
  return prisma.influencer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { coupons: true, commissions: true } } } });
}

export async function saveInfluencer(userId: string, requestId: string | undefined, input: { id?: string; name: string; email?: string | null; mobile?: string | null; defaultRate: number; isActive: boolean }) {
  await adminAccess(userId, MARKETING);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new ApiError(422, 'Enter an influencer name up to 120 characters.', 'INFLUENCER_NAME_INVALID');
  assertRate(input.defaultRate);
  const data = { name, email: input.email?.trim() || null, mobile: input.mobile?.trim() || null, defaultRate: fraction(input.defaultRate), isActive: input.isActive };
  if (input.id) {
    const previous = await prisma.influencer.findUnique({ where: { id: input.id } });
    if (!previous) throw new ApiError(404, 'Influencer was not found.', 'INFLUENCER_NOT_FOUND');
    const updated = await prisma.influencer.update({ where: { id: input.id }, data });
    await writeAudit(prisma, { event: 'INFLUENCER_UPDATED', actorId: userId, entityType: 'Influencer', entityId: updated.id, requestId, permission: MARKETING, previousState: { name: previous.name, defaultRate: percent(previous.defaultRate), isActive: previous.isActive }, nextState: { name, defaultRate: input.defaultRate, isActive: input.isActive } });
    return updated;
  }
  const created = await prisma.influencer.create({ data: { ...data, createdById: userId } });
  await writeAudit(prisma, { event: 'INFLUENCER_CREATED', actorId: userId, entityType: 'Influencer', entityId: created.id, requestId, permission: MARKETING, nextState: { name, defaultRate: input.defaultRate, isActive: input.isActive } });
  return created;
}

export async function createOrderCommissionSnapshots(tx: Prisma.TransactionClient, influencerId: string | null, rate: Prisma.Decimal | null, consignments: { id: string; productSubtotal: Prisma.Decimal; allocatedDiscount: Prisma.Decimal }[]) {
  if (!influencerId || !rate) return;
  for (const consignment of consignments) {
    await tx.influencerCommission.create({ data: { influencerId, vendorOrderId: consignment.id, rate, productSubtotal: consignment.productSubtotal, allocatedDiscount: consignment.allocatedDiscount, earnedAmount: new Prisma.Decimal(0), payableAmount: new Prisma.Decimal(0) } });
  }
}

export async function recalculateOrderCommissions(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { vendorOrders: { include: { influencerCommission: { include: { ledgerEntries: true } } } } } });
  if (!order) return;
  for (const consignment of order.vendorOrders) {
    const commission = consignment.influencerCommission;
    if (!commission) continue;
    const refunded = commission.ledgerEntries.filter((item) => item.type === InfluencerCommissionLedgerType.REFUND_REVERSAL).reduce((total, item) => total.plus(item.refundAmount ?? 0), new Prisma.Decimal(0));
    const earned = consignment.status === 'DELIVERED' && order.paymentStatus === PaymentStatus.PAID
      ? commissionFor({ subtotal: commission.productSubtotal, discount: commission.allocatedDiscount, refunded, rate: commission.rate })
      : new Prisma.Decimal(0);
    const payable = payableForCommission({ status: consignment.status, paymentStatus: order.paymentStatus, earned });
    await tx.influencerCommission.update({ where: { id: commission.id }, data: { refundedMerchandise: refunded, earnedAmount: earned, payableAmount: payable } });
  }
}

export async function recordRefund(userId: string, requestId: string | undefined, vendorOrderId: string, refundAmount: number, requestKey: string) {
  await adminAccess(userId, FINANCE);
  if (!(refundAmount > 0) || !Number.isFinite(refundAmount) || !requestKey.trim()) throw new ApiError(422, 'Enter a refund amount and unique request key.', 'REFUND_ADJUSTMENT_INVALID');
  const result = await prisma.$transaction(async (tx) => {
    const commission = await tx.influencerCommission.findUnique({ where: { vendorOrderId }, include: { ledgerEntries: true, vendorOrder: true } });
    if (!commission) throw new ApiError(404, 'Influencer commission was not found for this consignment.', 'COMMISSION_NOT_FOUND');
    const amount = new Prisma.Decimal(refundAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const duplicate = await tx.influencerCommissionLedger.findUnique({ where: { requestKey: requestKey.trim() } });
    if (duplicate) throw new ApiError(409, 'This refund adjustment was already recorded.', 'COMMISSION_LEDGER_DUPLICATE');
    const refunded = commission.refundedMerchandise.plus(amount);
    const maxRefundable = commission.productSubtotal.minus(commission.allocatedDiscount);
    if (refunded.greaterThan(maxRefundable)) throw new ApiError(422, 'Refund exceeds this consignment’s discounted merchandise subtotal.', 'REFUND_EXCEEDS_SUBTOTAL');
    const order = await tx.order.findUniqueOrThrow({ where: { id: commission.vendorOrder.orderId } });
    const eligible = commission.vendorOrder.status === 'DELIVERED' && order.paymentStatus === PaymentStatus.PAID;
    const earned = eligible ? commissionFor({ subtotal: commission.productSubtotal, discount: commission.allocatedDiscount, refunded, rate: commission.rate }) : new Prisma.Decimal(0);
    const entry = await tx.influencerCommissionLedger.create({ data: { influencerId: commission.influencerId, commissionId: commission.id, type: InfluencerCommissionLedgerType.REFUND_REVERSAL, refundAmount: amount, amount: earned.minus(commission.earnedAmount), actorId: userId, requestKey: requestKey.trim() } });
    const payable = payableForCommission({ status: commission.vendorOrder.status, paymentStatus: order.paymentStatus, earned });
    const updated = await tx.influencerCommission.update({ where: { id: commission.id }, data: { refundedMerchandise: refunded, earnedAmount: earned, payableAmount: payable } });
    await tx.adminAuditLog.create({ data: { actorId: userId, action: codeOf('COMMISSION_REFUND_RECORDED'), entityType: 'InfluencerCommission', entityId: commission.id, requestId: requestId ?? null, permission: FINANCE, previousState: { refundedMerchandise: commission.refundedMerchandise.toString() }, nextState: { refundedMerchandise: refunded.toString(), requestKey: requestKey.trim() } } });
    return { entry, commission: updated };
  });
  logAudit({ event: 'COMMISSION_REFUND_RECORDED', actorId: userId, entityType: 'InfluencerCommission', entityId: result.commission.id, requestId, permission: FINANCE });
  return result;
}

export async function settleCommission(userId: string, requestId: string | undefined, influencerId: string, amountInput: number, reference: string, requestKey: string) {
  await adminAccess(userId, FINANCE);
  const amount = new Prisma.Decimal(amountInput).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!amount.greaterThan(0) || !reference.trim() || !requestKey.trim()) throw new ApiError(422, 'Enter a positive settlement, payment reference and unique request key.', 'COMMISSION_SETTLEMENT_INVALID');
  const result = await prisma.$transaction(async (tx) => {
    const influencer = await tx.influencer.findUnique({ where: { id: influencerId } });
    if (!influencer) throw new ApiError(404, 'Influencer was not found.', 'INFLUENCER_NOT_FOUND');
    const commissions = await tx.influencerCommission.findMany({ where: { influencerId }, include: { ledgerEntries: true, vendorOrder: { include: { order: true } } }, orderBy: { createdAt: 'asc' } });
    if (commissions.some((item) => settlementRequestAlreadyRecorded(requestKey.trim(), item.ledgerEntries.map((entry) => entry.requestKey)))) throw new ApiError(409, 'This settlement was already recorded.', 'COMMISSION_LEDGER_DUPLICATE');
    const balance = commissions.reduce((total, item) => total.plus(item.payableAmount).minus(item.ledgerEntries.filter((entry) => entry.type === InfluencerCommissionLedgerType.SETTLEMENT).reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0))), new Prisma.Decimal(0));
    if (!settlementFitsBalance(amount, balance)) throw new ApiError(422, 'Settlement exceeds the current payable balance.', 'COMMISSION_SETTLEMENT_EXCEEDS_BALANCE');
    let remaining = amount;
    for (const commission of commissions) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const paid = commission.ledgerEntries.filter((entry) => entry.type === InfluencerCommissionLedgerType.SETTLEMENT).reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      const available = Prisma.Decimal.max(commission.payableAmount.minus(paid), 0);
      const allocated = Prisma.Decimal.min(available, remaining);
      if (allocated.greaterThan(0)) {
        await tx.influencerCommissionLedger.create({ data: { influencerId, commissionId: commission.id, type: InfluencerCommissionLedgerType.SETTLEMENT, amount: allocated, reference: reference.trim(), actorId: userId, requestKey: `${requestKey.trim()}:${commission.id}` } });
        await tx.influencerCommission.update({ where: { id: commission.id }, data: { paidAmount: { increment: allocated } } });
        remaining = remaining.minus(allocated);
      }
    }
    await tx.adminAuditLog.create({ data: { actorId: userId, action: codeOf('COMMISSION_SETTLED'), entityType: 'Influencer', entityId: influencerId, requestId: requestId ?? null, permission: FINANCE, nextState: { amount: amount.toString(), reference: reference.trim(), requestKey: requestKey.trim() } } });
    return { influencerId, amount, reference: reference.trim(), settled: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  logAudit({ event: 'COMMISSION_SETTLED', actorId: userId, entityType: 'Influencer', entityId: influencerId, requestId, permission: FINANCE });
  return result;
}

export async function commissionReport(userId: string, query: { page?: unknown; pageSize?: unknown; influencerId?: unknown } = {}) {
  await adminAccess(userId, FINANCE);
  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const where = typeof query.influencerId === 'string' && query.influencerId ? { influencerId: query.influencerId } : {};
  const [items, total] = await Promise.all([
    prisma.influencerCommission.findMany({ where, include: { influencer: true, vendorOrder: { include: { order: true, vendor: true } }, ledgerEntries: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.influencerCommission.count({ where }),
  ]);
  const influencerRows = await prisma.influencer.findMany({ where: typeof query.influencerId === 'string' && query.influencerId ? { id: query.influencerId } : {}, include: { commissions: { include: { ledgerEntries: true, vendorOrder: { include: { order: true } } } } }, orderBy: { name: 'asc' } });
  const summaries = influencerRows.map((influencer) => {
    const earned = influencer.commissions.reduce((sum, item) => sum.plus(item.earnedAmount), new Prisma.Decimal(0));
    const paid = influencer.commissions.reduce((sum, item) => sum.plus(item.ledgerEntries.filter((entry) => entry.type === InfluencerCommissionLedgerType.SETTLEMENT).reduce((inner, entry) => inner.plus(entry.amount), new Prisma.Decimal(0))), new Prisma.Decimal(0));
    const payable = influencer.commissions.reduce((sum, item) => {
      const refunded = item.ledgerEntries.filter((entry) => entry.type === InfluencerCommissionLedgerType.REFUND_REVERSAL).reduce((inner, entry) => inner.plus(entry.refundAmount ?? 0), new Prisma.Decimal(0));
      const currentEarned = commissionFor({ subtotal: item.productSubtotal, discount: item.allocatedDiscount, refunded, rate: item.rate });
      return sum.plus(payableForCommission({ status: item.vendorOrder.status, paymentStatus: item.vendorOrder.order.paymentStatus, earned: currentEarned }));
    }, new Prisma.Decimal(0)).minus(paid);
    return { id: influencer.id, name: influencer.name, defaultRate: percent(influencer.defaultRate), earned, paid, payable };
  });
  const shaped = items.map((item) => {
    const refunded = item.ledgerEntries.filter((entry) => entry.type === InfluencerCommissionLedgerType.REFUND_REVERSAL).reduce((sum, entry) => sum.plus(entry.refundAmount ?? 0), new Prisma.Decimal(0));
    const eligible = item.vendorOrder.status === 'DELIVERED' && item.vendorOrder.order.paymentStatus === PaymentStatus.PAID;
    const currentEarned = eligible ? commissionFor({ subtotal: item.productSubtotal, discount: item.allocatedDiscount, refunded, rate: item.rate }) : new Prisma.Decimal(0);
    const reversals = eligible ? commissionFor({ subtotal: item.productSubtotal, discount: item.allocatedDiscount, refunded: new Prisma.Decimal(0), rate: item.rate }).minus(currentEarned) : new Prisma.Decimal(0);
    const settlements = item.ledgerEntries.filter((entry) => entry.type === InfluencerCommissionLedgerType.SETTLEMENT).reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
    return { ...item, earnedAmount: currentEarned, paidAmount: settlements, payableAmount: item.payableAmount.minus(settlements), refundReversal: reversals };
  });
  return { items: shaped, summaries, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
