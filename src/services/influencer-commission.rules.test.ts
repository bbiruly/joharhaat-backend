import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import {
  allocateCouponDiscount,
  commissionFor,
  effectiveCommissionRate,
  payableBalance,
  payableForCommission,
  settlementFitsBalance,
  settlementRequestAlreadyRecorded,
} from './influencer-commission.rules.js';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('influencer commission rules', () => {
  it('allocates a capped coupon discount proportionally and assigns rounding residue', () => {
    const shares = allocateCouponDiscount(d('10.00'), [d('33.33'), d('66.67')]);
    expect(shares.map(String)).toEqual(['3.33', '6.67']);
    expect(shares.reduce((sum, item) => sum.plus(item), d(0)).toFixed(2)).toBe('10.00');
  });

  it('uses a coupon override when present and otherwise snapshots the influencer default', () => {
    expect(effectiveCommissionRate(d('0.10'), d('0.125')).toFixed(4)).toBe('0.1250');
    expect(effectiveCommissionRate(d('0.10'), null).toFixed(4)).toBe('0.1000');
  });

  it('subtracts allocated discounts and partial merchandise refunds before rounding commission', () => {
    expect(commissionFor({ subtotal: d('100.00'), discount: d('10.00'), refunded: d('20.00'), rate: d('0.125') }).toFixed(2)).toBe('8.75');
  });

  it('pays only delivered consignments after Razorpay PAID, regardless of arrival order', () => {
    expect(payableForCommission({ status: 'PENDING', paymentStatus: 'PAID', earned: d(10) }).toFixed(2)).toBe('0.00');
    expect(payableForCommission({ status: 'DELIVERED', paymentStatus: 'PENDING', earned: d(10) }).toFixed(2)).toBe('0.00');
    expect(payableForCommission({ status: 'DELIVERED', paymentStatus: 'AUTHORIZED', earned: d(10) }).toFixed(2)).toBe('0.00');
    expect(payableForCommission({ status: 'DELIVERED', paymentStatus: 'PAID', earned: d(10) }).toFixed(2)).toBe('10.00');
  });

  it('does not create payable balance on RTO/cancel and carries refunds beyond paid amount forward', () => {
    expect(payableForCommission({ status: 'RTO', paymentStatus: 'PAID', earned: d(10) }).toFixed(2)).toBe('0.00');
    expect(payableForCommission({ status: 'CANCELLED', paymentStatus: 'PAID', earned: d(10) }).toFixed(2)).toBe('0.00');
    expect(payableBalance(d(8), d(10)).toFixed(2)).toBe('-2.00');
  });

  it('rejects overpayment and a repeated settlement key', () => {
    expect(settlementFitsBalance(d(10), d(10))).toBe(true);
    expect(settlementFitsBalance(d('10.01'), d(10))).toBe(false);
    expect(settlementRequestAlreadyRecorded('batch-1', ['batch-1:commission-1'])).toBe(true);
    expect(settlementRequestAlreadyRecorded('batch-2', ['batch-1:commission-1'])).toBe(false);
  });
});
