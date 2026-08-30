import { randomUUID } from 'node:crypto';
import { CartAbandonmentStatus, FulfillmentStatus, LedgerDirection, LedgerType, PayoutStatus, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';

export function assertPayoutEligible(status: FulfillmentStatus): void {
  if (status !== FulfillmentStatus.DELIVERED) throw new ApiError(422, 'Escrow can only be released after delivery.', 'ORDER_NOT_DELIVERED');
}

export async function handleEscrowPayoutSplit(vendorOrderId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM vendor_orders WHERE id = ${vendorOrderId} FOR UPDATE`);
      const vendorOrder = await tx.vendorOrder.findUnique({ where: { id: vendorOrderId }, include: { order: true } });
      if (!vendorOrder) throw new ApiError(404, 'Vendor order was not found.', 'VENDOR_ORDER_NOT_FOUND');
      assertPayoutEligible(vendorOrder.status);

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
