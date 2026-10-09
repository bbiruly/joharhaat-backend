import { randomUUID } from 'node:crypto';
import { CartAbandonmentStatus, FulfillmentStatus, LedgerDirection, LedgerType, PaymentStatus, PayoutStatus, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';

export function assertPayoutEligible(status: FulfillmentStatus): void {
  if (status !== FulfillmentStatus.DELIVERED) throw new ApiError(422, 'Escrow can only be released after delivery.', 'ORDER_NOT_DELIVERED');
}

export async function handleEscrowPayoutSplit(vendorOrderId: string, actor?: { userId: string; isSystem: boolean; requestId?: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM vendor_orders WHERE id = ${vendorOrderId} FOR UPDATE`);
      const vendorOrder = await tx.vendorOrder.findUnique({ where: { id: vendorOrderId }, include: { order: true } });
      if (!vendorOrder) throw new ApiError(404, 'Vendor order was not found.', 'VENDOR_ORDER_NOT_FOUND');
      assertPayoutEligible(vendorOrder.status);
      if (vendorOrder.order.paymentStatus !== PaymentStatus.PAID && vendorOrder.order.paymentStatus !== PaymentStatus.AUTHORIZED) throw new ApiError(409, 'Only paid orders can release escrow.', 'ORDER_PAYMENT_REQUIRED');

      await tx.$queryRaw(Prisma.sql`SELECT id FROM vendors WHERE id = ${vendorOrder.vendorId} FOR UPDATE`);
      const existing = await tx.walletLedger.findUnique({
        where: { vendorId_vendorOrderId_type: { vendorId: vendorOrder.vendorId, vendorOrderId, type: LedgerType.ESCROW_RELEASE } },
      });
      const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorOrder.vendorId } });
      if (existing) return { ledger: existing, walletBalance: vendor.walletBalance, replayed: true };
      if (vendorOrder.payoutStatus === PayoutStatus.RELEASED) throw new ApiError(409, 'Payout is marked released but no escrow ledger exists.', 'PAYOUT_STATE_CONFLICT');

      const updatedVendor = await tx.vendor.update({
        where: { id: vendor.id },
        data: { walletBalance: { increment: vendorOrder.netVendorPayout } },
      });
      const ledger = await tx.walletLedger.create({
        data: {
          vendorId: vendor.id,
          vendorOrderId,
          type: LedgerType.ESCROW_RELEASE,
          direction: LedgerDirection.CREDIT,
          amount: vendorOrder.netVendorPayout,
          balanceAfter: updatedVendor.walletBalance,
          reference: `ESC-${randomUUID()}`,
          metadata: { orderId: vendorOrder.orderId, trackingId: vendorOrder.trackingId },
        },
      });
      await tx.vendorOrder.update({ where: { id: vendorOrderId }, data: { payoutStatus: PayoutStatus.RELEASED } });
      await tx.cart.update({ where: { id: vendorOrder.order.cartId }, data: { abandonmentStatus: CartAbandonmentStatus.RECOVERED } });
      if (actor && !actor.isSystem) {
        const { adminAccess } = await import('./admin.service.js');
        const { codeOf } = await import('../config/status-codes.js');
        const { logAudit } = await import('../utils/audit-log.js');
        await adminAccess(actor.userId, 'payouts:manage');
        await tx.adminAuditLog.create({ data: { actorId: actor.userId, action: codeOf('ESCROW_RELEASED'), entityType: 'VendorOrder', entityId: vendorOrderId, requestId: actor.requestId ?? null, permission: 'payouts:manage', previousState: { payoutStatus: vendorOrder.payoutStatus }, nextState: { payoutStatus: PayoutStatus.RELEASED, amount: vendorOrder.netVendorPayout.toString() } } });
        logAudit({ event: 'ESCROW_RELEASED', actorId: actor.userId, entityType: 'VendorOrder', entityId: vendorOrderId, requestId: actor.requestId, permission: 'payouts:manage' });
      }
      return { ledger, walletBalance: updatedVendor.walletBalance, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const ledger = await prisma.walletLedger.findUnique({ where: { vendorId_vendorOrderId_type: { vendorId: (await prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId } })).vendorId, vendorOrderId, type: LedgerType.ESCROW_RELEASE } } });
      if (ledger) {
        const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: ledger.vendorId } });
        return { ledger, walletBalance: vendor.walletBalance, replayed: true };
      }
    }
    throw error;
  }
}
