import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { checkoutCouponEligible, offersWithSavings, shapeCheckoutCouponOffer } from './checkout.service.js';

const now = new Date('2026-10-08T12:00:00.000Z');
const coupon = {
  isActive: true,
  showInCheckoutOffers: true,
  startsAt: new Date('2026-10-01T00:00:00.000Z'),
  expiresAt: new Date('2026-10-09T00:00:00.000Z'),
  usageLimit: 10,
  usedCount: 2,
  perUserLimit: 1,
  minOrderValue: 500,
};

describe('checkout coupon offer visibility', () => {
  it('includes active public coupons inside their date and usage limits', () => {
    expect(checkoutCouponEligible(coupon, now, 750, 0)).toBe(true);
  });

  it('returns only public offer details and calculates this cart’s capped discount', () => {
    expect(shapeCheckoutCouponOffer({
      code: 'INFLUENCER10',
      percent: new Prisma.Decimal('0.10'),
      maxDiscount: new Prisma.Decimal('50.00'),
      minOrderValue: new Prisma.Decimal('500.00'),
      startsAt: new Date('2026-10-01T00:00:00.000Z'),
      expiresAt: new Date('2026-10-09T00:00:00.000Z'),
      usageLimit: 100,
      perUserLimit: 2,
    }, new Prisma.Decimal('750.00'))).toEqual({
      code: 'INFLUENCER10',
      percent: 10,
      discount: 50,
      maxDiscount: 50,
      minOrderValue: 500,
      startsAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-09T00:00:00.000Z',
      usageLimit: 100,
      perUserLimit: 2,
    });
  });

  it('hides coupons that produce no savings on the current cart', () => {
    expect(offersWithSavings([
      { code: 'ZERO', percent: 10, discount: 0 },
      { code: 'SAVE', percent: 10, discount: 1 },
    ])).toEqual([{ code: 'SAVE', percent: 10, discount: 1 }]);
  });

  it.each<[string, Partial<typeof coupon>, number, number]>([
    ['private', { showInCheckoutOffers: false }, 750, 0],
    ['disabled', { isActive: false }, 750, 0],
    ['not started', { startsAt: new Date('2026-10-09T00:00:00.000Z') }, 750, 0],
    ['expired', { expiresAt: new Date('2026-10-08T11:59:59.000Z') }, 750, 0],
    ['global usage limit', { usageLimit: 2 }, 750, 0],
    ['per-customer usage limit', {}, 750, 1],
    ['minimum order is not met', {}, 499, 0],
  ])('excludes coupons when %s', (_reason, change, gmv, userUses) => {
    expect(checkoutCouponEligible({ ...coupon, ...change }, now, gmv, userUses)).toBe(false);
  });
});
