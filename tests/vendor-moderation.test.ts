import { describe, expect, it } from 'vitest';
import { assertApprovalEligible } from '../src/services/admin.service.js';
import { ApiError } from '../src/utils/api-error.js';

/**
 * Regression cover for the "Someone else changed this record first" report.
 * Both preconditions previously reached the client as 409, which the admin UI
 * renders as an optimistic-concurrency conflict.
 */
describe('vendor approval preconditions', () => {
  it('accepts an applicant with an account and a free MSME number', () => {
    expect(() =>
      assertApprovalEligible({ ownerHasPassword: true, msmeOwnedByAnotherVendor: false }),
    ).not.toThrow();
  });

  it('rejects an applicant with no password-protected account as 422, not 409', () => {
    try {
      assertApprovalEligible({ ownerHasPassword: false, msmeOwnedByAnotherVendor: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(422);
      expect((error as ApiError).code).toBe('APPLICANT_ACCOUNT_REQUIRED');
    }
  });

  it('rejects an MSME number already held by another vendor as 422, not 409', () => {
    try {
      assertApprovalEligible({ ownerHasPassword: true, msmeOwnedByAnotherVendor: true });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(422);
      expect((error as ApiError).code).toBe('MSME_ALREADY_REGISTERED');
    }
  });

  it('reports the missing account before the MSME clash when both are wrong', () => {
    try {
      assertApprovalEligible({ ownerHasPassword: false, msmeOwnedByAnotherVendor: true });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('APPLICANT_ACCOUNT_REQUIRED');
    }
  });
});
