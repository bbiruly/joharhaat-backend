import { describe, expect, it } from 'vitest';
import { FulfillmentStatus } from '../src/generated/prisma/client.js';
import { assertCorrectionAllowed, deliveredAtFor } from '../src/services/admin.service.js';
import { ApiError } from '../src/utils/api-error.js';

describe('deliveredAt on an admin status correction', () => {
  const now = new Date('2026-09-05T10:00:00.000Z');
  const earlier = new Date('2026-09-01T08:00:00.000Z');

  it('stamps a timestamp when correcting to DELIVERED', () => {
    expect(deliveredAtFor(FulfillmentStatus.DELIVERED, null, now)).toEqual(now);
  });

  it('keeps the original delivery time on a re-correction to DELIVERED', () => {
    expect(deliveredAtFor(FulfillmentStatus.DELIVERED, earlier, now)).toEqual(earlier);
  });

  it('clears the timestamp when correcting away from DELIVERED', () => {
    for (const status of [
      FulfillmentStatus.PENDING,
      FulfillmentStatus.PACKED,
      FulfillmentStatus.SHIPPED,
      FulfillmentStatus.RTO,
      FulfillmentStatus.CANCELLED,
    ]) {
      expect(deliveredAtFor(status, earlier, now)).toBeNull();
    }
  });
});

describe('escrow guard on an admin status correction', () => {
  it('allows any correction when escrow has not been released', () => {
    expect(() => assertCorrectionAllowed(FulfillmentStatus.RTO, false)).not.toThrow();
    expect(() => assertCorrectionAllowed(FulfillmentStatus.PENDING, false)).not.toThrow();
  });

  it('still allows a DELIVERED-to-DELIVERED correction after release', () => {
    expect(() => assertCorrectionAllowed(FulfillmentStatus.DELIVERED, true)).not.toThrow();
  });

  it('blocks moving out of DELIVERED once escrow is released', () => {
    try {
      assertCorrectionAllowed(FulfillmentStatus.RTO, true);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(422);
      expect((error as ApiError).code).toBe('PAYOUT_ALREADY_RELEASED');
    }
  });
});
