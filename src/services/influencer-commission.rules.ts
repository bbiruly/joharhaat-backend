import { Prisma } from '../generated/prisma/client.js';
import { allocateMoney, money } from '../utils/money.js';

export function allocateCouponDiscount(discount: Prisma.Decimal, subtotals: Prisma.Decimal[]) {
  return allocateMoney(discount, subtotals);
}

export function effectiveCommissionRate(defaultRate: Prisma.Decimal, overrideRate: Prisma.Decimal | null) {
  return overrideRate ?? defaultRate;
}

export function settlementRequestAlreadyRecorded(requestKey: string, recordedKeys: (string | null)[]) {
  return recordedKeys.some((key) => key?.startsWith(`${requestKey}:`));
}

export function settlementFitsBalance(amount: Prisma.Decimal, balance: Prisma.Decimal) {
  return amount.greaterThan(0) && amount.lessThanOrEqualTo(balance);
}

export function commissionFor(input: {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  refunded: Prisma.Decimal;
  rate: Prisma.Decimal;
}) {
  const eligible = Prisma.Decimal.max(input.subtotal.minus(input.discount).minus(input.refunded), 0);
  return money(eligible.mul(input.rate));
}

export function confirmedForCommission(paymentStatus: string) {
  return paymentStatus === 'PAID';
}

export function payableForCommission(input: {
  status: string;
  paymentStatus: string;
  earned: Prisma.Decimal;
}) {
  return input.status === 'DELIVERED' && confirmedForCommission(input.paymentStatus)
    ? money(input.earned)
    : money(0);
}

export function payableBalance(earned: Prisma.Decimal, paid: Prisma.Decimal) {
  return money(earned.minus(paid));
}
