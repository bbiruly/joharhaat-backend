import { LedgerDirection, LedgerType, PayoutRequestStatus, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { logAudit } from '../utils/audit-log.js';
import { adminAccess } from './admin.service.js';
import { assertPayoutCanComplete, assertPayoutCanProcess, assertPayoutCanReject, isSettlementReplay } from './payout-rules.js';
import { codeOf } from '../config/status-codes.js';

export async function processPayoutRequest(userId: string, requestId: string, id: string) {
  await adminAccess(userId, 'payouts:manage');
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payout_requests WHERE id = ${id} FOR UPDATE`);
    const request = await tx.payoutRequest.findUnique({ where: { id } });
    if (!request) throw new ApiError(404, 'Payout request was not found.', 'PAYOUT_REQUEST_NOT_FOUND');
    if (request.status === PayoutRequestStatus.PROCESSING) return { request, replayed: true };
    assertPayoutCanProcess(request.status);
    const updated = await tx.payoutRequest.update({ where: { id }, data: { status: PayoutRequestStatus.PROCESSING, processedById: userId, processedAt: new Date() } });
    await tx.adminAuditLog.create({ data: { actorId: userId, action: codeOf('PAYOUT_REQUEST_PROCESSING'), entityType: 'PayoutRequest', entityId: id, requestId, permission: 'payouts:manage', previousState: { status: request.status }, nextState: { status: updated.status } } });
    return { request: updated, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.replayed) logAudit({ event: 'PAYOUT_REQUEST_PROCESSING', actorId: userId, entityType: 'PayoutRequest', entityId: id, requestId, permission: 'payouts:manage', previousState: { status: 'PENDING' }, nextState: { status: 'PROCESSING' } });
  return result.request;
}

export async function completePayoutRequest(userId: string, requestId: string, id: string, settlementReference: string) {
  await adminAccess(userId, 'payouts:manage');
  const reference = settlementReference.trim();
  if (reference.length < 4 || reference.length > 64) throw new ApiError(422, 'Enter a valid UTR or settlement reference.', 'PAYOUT_REFERENCE_REQUIRED');
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payout_requests WHERE id = ${id} FOR UPDATE`);
    const request = await tx.payoutRequest.findUnique({ where: { id } });
    if (!request) throw new ApiError(404, 'Payout request was not found.', 'PAYOUT_REQUEST_NOT_FOUND');
    if (request.status === PayoutRequestStatus.COMPLETED) {
      if (isSettlementReplay(request.status, request.settlementReference, reference)) return { request, replayed: true };
      throw new ApiError(409, 'This payout was already settled with a different reference.', 'PAYOUT_ALREADY_SETTLED');
    }
    assertPayoutCanComplete(request.status, reference);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM vendors WHERE id = ${request.vendorId} FOR UPDATE`);
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: request.vendorId } });
    if (vendor.walletBalance.lessThan(request.amount)) throw new ApiError(409, 'Wallet balance is lower than the payout request.', 'PAYOUT_BALANCE_CONFLICT');
    const updatedVendor = await tx.vendor.update({ where: { id: vendor.id }, data: { walletBalance: { decrement: request.amount } } });
    const updatedRequest = await tx.payoutRequest.update({ where: { id }, data: { status: PayoutRequestStatus.COMPLETED, settlementReference: reference, processedById: userId, processedAt: new Date() } });
    const ledger = await tx.walletLedger.create({ data: { vendorId: vendor.id, payoutRequestId: request.id, type: LedgerType.BANK_TRANSFER, direction: LedgerDirection.DEBIT, amount: request.amount, balanceAfter: updatedVendor.walletBalance, reference: `TRF-${request.reference}`, metadata: { settlementReference: reference } } });
    await tx.adminAuditLog.create({ data: { actorId: userId, action: codeOf('PAYOUT_REQUEST_COMPLETED'), entityType: 'PayoutRequest', entityId: id, requestId, permission: 'payouts:manage', previousState: { status: request.status, walletBalance: vendor.walletBalance.toString() }, nextState: { status: updatedRequest.status, settlementReference: reference, walletBalance: updatedVendor.walletBalance.toString(), ledgerId: ledger.id } } });
    return { request: updatedRequest, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.replayed) logAudit({ event: 'PAYOUT_REQUEST_COMPLETED', actorId: userId, entityType: 'PayoutRequest', entityId: id, requestId, permission: 'payouts:manage', nextState: { status: 'COMPLETED', settlementReference: reference } });
  return result.request;
}

export async function rejectPayoutRequest(userId: string, requestId: string, id: string, reason: string) {
  await adminAccess(userId, 'payouts:manage');
  const decisionReason = reason.trim();
  if (decisionReason.length < 5 || decisionReason.length > 500) throw new ApiError(422, 'Enter a rejection reason between 5 and 500 characters.', 'PAYOUT_REJECTION_REASON_REQUIRED');
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payout_requests WHERE id = ${id} FOR UPDATE`);
    const request = await tx.payoutRequest.findUnique({ where: { id } });
    if (!request) throw new ApiError(404, 'Payout request was not found.', 'PAYOUT_REQUEST_NOT_FOUND');
    if (request.status === PayoutRequestStatus.REJECTED && request.decisionReason === decisionReason) return { request, replayed: true };
    assertPayoutCanReject(request.status, decisionReason);
    const updated = await tx.payoutRequest.update({ where: { id }, data: { status: PayoutRequestStatus.REJECTED, decisionReason, processedById: userId, processedAt: new Date() } });
    await tx.adminAuditLog.create({ data: { actorId: userId, action: codeOf('PAYOUT_REQUEST_REJECTED'), entityType: 'PayoutRequest', entityId: id, requestId, permission: 'payouts:manage', previousState: { status: request.status }, nextState: { status: updated.status, decisionReason } } });
    return { request: updated, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.replayed) logAudit({ event: 'PAYOUT_REQUEST_REJECTED', actorId: userId, entityType: 'PayoutRequest', entityId: id, requestId, permission: 'payouts:manage', nextState: { status: 'REJECTED', decisionReason } });
  return result.request;
}
