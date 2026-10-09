import { describe, expect, it } from 'vitest';
import { PayoutRequestStatus } from '../generated/prisma/client.js';
import { assertPayoutCanComplete, assertPayoutCanProcess, assertPayoutCanReject, isPayoutRequestActive, isSettlementReplay } from './payout-rules.js';

describe('vendor payout lifecycle rules', () => {
  it('allows only active requests to be processed and rejects terminal transitions', () => {
    expect(() => assertPayoutCanProcess(PayoutRequestStatus.PENDING)).not.toThrow();
    expect(() => assertPayoutCanProcess(PayoutRequestStatus.PROCESSING)).not.toThrow();
    expect(() => assertPayoutCanProcess(PayoutRequestStatus.COMPLETED)).toThrowError(expect.objectContaining({ code: 'PAYOUT_STATE_CONFLICT' }));
  });

  it('requires processing and a valid UTR before completion', () => {
    expect(() => assertPayoutCanComplete(PayoutRequestStatus.PENDING, 'UTR123456')).toThrowError(expect.objectContaining({ code: 'PAYOUT_STATE_CONFLICT' }));
    expect(() => assertPayoutCanComplete(PayoutRequestStatus.PROCESSING, '123')).toThrowError(expect.objectContaining({ code: 'PAYOUT_REFERENCE_REQUIRED' }));
    expect(() => assertPayoutCanComplete(PayoutRequestStatus.PROCESSING, 'UTR123456')).not.toThrow();
  });

  it('requires a rejection reason and reserves pending/processing amounts only', () => {
    expect(() => assertPayoutCanReject(PayoutRequestStatus.PENDING, 'no')).toThrowError(expect.objectContaining({ code: 'PAYOUT_REJECTION_REASON_REQUIRED' }));
    expect(() => assertPayoutCanReject(PayoutRequestStatus.PROCESSING, 'Account mismatch')).not.toThrow();
    expect(isPayoutRequestActive(PayoutRequestStatus.PENDING)).toBe(true);
    expect(isPayoutRequestActive(PayoutRequestStatus.PROCESSING)).toBe(true);
    expect(isPayoutRequestActive(PayoutRequestStatus.REJECTED)).toBe(false);
  });

  it('recognizes a repeated settlement reference as an idempotent replay only', () => {
    expect(isSettlementReplay(PayoutRequestStatus.COMPLETED, 'UTR123456', 'UTR123456')).toBe(true);
    expect(isSettlementReplay(PayoutRequestStatus.COMPLETED, 'UTR123456', 'DIFFERENT')).toBe(false);
    expect(isSettlementReplay(PayoutRequestStatus.PROCESSING, null, 'UTR123456')).toBe(false);
  });
});
