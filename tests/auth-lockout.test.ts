import { describe, expect, it } from 'vitest';
import { LOCKOUT, lockoutAfterFailure } from '../src/services/auth.service.js';

/**
 * The IP rate limiter caps one source. These thresholds follow the account, so
 * a distributed attempt against a single login cannot simply rotate addresses.
 */
describe('per-account login lockout', () => {
  const now = new Date('2026-09-06T10:00:00.000Z');

  it('counts a failure without locking early', () => {
    const result = lockoutAfterFailure(0, now);
    expect(result.failedLoginCount).toBe(1);
    expect(result.lockedUntil).toBeNull();
  });

  it('does not lock on the attempt before the threshold', () => {
    const result = lockoutAfterFailure(LOCKOUT.attempts - 2, now);
    expect(result.failedLoginCount).toBe(LOCKOUT.attempts - 1);
    expect(result.lockedUntil).toBeNull();
  });

  it('locks exactly on the threshold attempt', () => {
    const result = lockoutAfterFailure(LOCKOUT.attempts - 1, now);
    expect(result.failedLoginCount).toBe(LOCKOUT.attempts);
    expect(result.lockedUntil).toEqual(new Date(now.getTime() + LOCKOUT.minutes * 60_000));
  });

  it('extends the window on every further failure while locked', () => {
    const later = new Date(now.getTime() + 60_000);
    const result = lockoutAfterFailure(LOCKOUT.attempts + 3, later);
    expect(result.lockedUntil).toEqual(new Date(later.getTime() + LOCKOUT.minutes * 60_000));
  });
});
