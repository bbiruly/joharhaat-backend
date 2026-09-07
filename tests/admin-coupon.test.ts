import { describe, expect, it } from 'vitest';
import { assertCouponValid, couponState } from '../src/services/admin-coupon.service.js';
import { ApiError } from '../src/utils/api-error.js';

/**
 * Every rule here mirrors one that `resolveCoupon` in checkout.service enforces
 * at redemption time. Without them an operator can create a coupon, see it
 * listed as active, and never learn why no customer can use it — the failure
 * only ever surfaces as "Coupon is invalid" on someone else's checkout.
 */
const valid = {
  code: 'HAAT10',
  percent: 10,
  maxDiscount: 200,
  minOrderValue: 500,
  startsAt: '2026-01-01T00:00:00Z',
  expiresAt: '2026-12-31T00:00:00Z',
  usageLimit: 100 as number | null,
  perUserLimit: 1,
  isActive: true,
};

const codeOf = (input: typeof valid) => {
  try {
    assertCouponValid(input);
    return null;
  } catch (error) {
    return (error as ApiError).code;
  }
};

describe('coupon validation', () => {
  it('accepts a well-formed coupon and upper-cases the code', () => {
    const result = assertCouponValid({ ...valid, code: ' haat10 ' });
    expect(result.code).toBe('HAAT10');
    expect(result.startsAt).toBeInstanceOf(Date);
  });

  it('rejects codes that are too short, too long or oddly punctuated', () => {
    for (const code of ['AB', 'A'.repeat(25), 'HAAT 10', 'HAAT@10', '-LEAD'])
      expect(codeOf({ ...valid, code }), code).toBe('COUPON_CODE_INVALID');
  });

  it('keeps the discount inside a sane band', () => {
    expect(codeOf({ ...valid, percent: 0 })).toBe('COUPON_PERCENT_INVALID');
    expect(codeOf({ ...valid, percent: -5 })).toBe('COUPON_PERCENT_INVALID');
    // A typo of 100 would give the whole order away.
    expect(codeOf({ ...valid, percent: 100 })).toBe('COUPON_PERCENT_INVALID');
    expect(codeOf({ ...valid, percent: 90 })).toBeNull();
  });

  it('requires a discount cap', () => {
    // percent without a cap is unbounded on a large order.
    expect(codeOf({ ...valid, maxDiscount: 0 })).toBe('COUPON_CAP_INVALID');
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      codeOf({ ...valid, startsAt: '2026-06-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }),
    ).toBe('COUPON_DATES_INVALID');
    expect(codeOf({ ...valid, expiresAt: 'not-a-date' })).toBe('COUPON_DATES_INVALID');
  });

  it('accepts an unlimited total but never a zero or fractional one', () => {
    expect(codeOf({ ...valid, usageLimit: null })).toBeNull();
    expect(codeOf({ ...valid, usageLimit: 0 })).toBe('COUPON_LIMIT_INVALID');
    expect(codeOf({ ...valid, usageLimit: 2.5 })).toBe('COUPON_LIMIT_INVALID');
    expect(codeOf({ ...valid, perUserLimit: 0 })).toBe('COUPON_LIMIT_INVALID');
  });
});

describe('coupon state', () => {
  const base = {
    isActive: true,
    startsAt: new Date('2020-01-01'),
    expiresAt: new Date('2099-01-01'),
    usageLimit: null as number | null,
    usedCount: 0,
  };

  it('reads a live coupon as active', () => expect(couponState(base)).toBe('ACTIVE'));

  it('reports disabled ahead of every other reason', () =>
    // A disabled coupon that is also expired should read as disabled: that is
    // the state an operator changed and can change back.
    expect(couponState({ ...base, isActive: false, expiresAt: new Date('2020-06-01') })).toBe(
      'DISABLED',
    ));

  it('separates expired, scheduled and exhausted', () => {
    expect(couponState({ ...base, expiresAt: new Date('2020-06-01') })).toBe('EXPIRED');
    expect(couponState({ ...base, startsAt: new Date('2099-06-01') })).toBe('SCHEDULED');
    expect(couponState({ ...base, usageLimit: 5, usedCount: 5 })).toBe('EXHAUSTED');
  });

  it('does not call an unlimited coupon exhausted', () =>
    expect(couponState({ ...base, usageLimit: null, usedCount: 9999 })).toBe('ACTIVE'));
});
