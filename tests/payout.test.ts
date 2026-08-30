import { describe, expect, it } from 'vitest';
import { FulfillmentStatus } from '../src/generated/prisma/client.js';
import { assertPayoutEligible } from '../src/services/payout.service.js';

describe('escrow eligibility', () => {
  it('accepts delivered orders', () => expect(() => assertPayoutEligible(FulfillmentStatus.DELIVERED)).not.toThrow());
  it('rejects pending and RTO orders', () => {
    expect(() => assertPayoutEligible(FulfillmentStatus.PENDING)).toThrow('only be released after delivery');
    expect(() => assertPayoutEligible(FulfillmentStatus.RTO)).toThrow('only be released after delivery');
  });
});
