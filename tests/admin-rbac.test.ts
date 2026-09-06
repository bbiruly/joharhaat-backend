import { describe, expect, it } from 'vitest';
import { AdminTeamRole } from '../src/generated/prisma/client.js';
import { assertTeamChangeAllowed } from '../src/services/admin.service.js';
import { ApiError } from '../src/utils/api-error.js';

/**
 * SUPER_ADMIN must not be removable through the UI. Losing the last one would
 * leave the permission matrix unmanageable with no way back in.
 */
describe('SUPER_ADMIN protection', () => {
  const base = { targetRole: AdminTeamRole.SUPER_ADMIN, targetIsSelf: false };

  it('blocks disabling a SUPER_ADMIN', () => {
    try {
      assertTeamChangeAllowed({ ...base, nextIsActive: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).statusCode).toBe(422);
      expect((error as ApiError).code).toBe('SUPER_ADMIN_PROTECTED');
    }
  });

  it('blocks demoting a SUPER_ADMIN to any other role', () => {
    for (const nextRole of [
      AdminTeamRole.OPERATIONS,
      AdminTeamRole.FINANCE,
      AdminTeamRole.MARKETING,
      AdminTeamRole.MODERATOR,
    ]) {
      expect(() => assertTeamChangeAllowed({ ...base, nextRole })).toThrow(
        'cannot be disabled or have their role changed',
      );
    }
  });

  it('blocks a SUPER_ADMIN from demoting themselves', () => {
    expect(() =>
      assertTeamChangeAllowed({
        targetRole: AdminTeamRole.SUPER_ADMIN,
        targetIsSelf: true,
        nextRole: AdminTeamRole.OPERATIONS,
      }),
    ).toThrow('SUPER_ADMIN');
  });

  it('allows a no-op re-save of a SUPER_ADMIN', () => {
    expect(() =>
      assertTeamChangeAllowed({ ...base, nextRole: AdminTeamRole.SUPER_ADMIN }),
    ).not.toThrow();
  });

  it('still allows disabling and re-roling a non-super admin', () => {
    expect(() =>
      assertTeamChangeAllowed({
        targetRole: AdminTeamRole.OPERATIONS,
        targetIsSelf: false,
        nextIsActive: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTeamChangeAllowed({
        targetRole: AdminTeamRole.MODERATOR,
        targetIsSelf: false,
        nextRole: AdminTeamRole.FINANCE,
      }),
    ).not.toThrow();
  });

  it('still blocks an admin disabling their own access', () => {
    try {
      assertTeamChangeAllowed({
        targetRole: AdminTeamRole.OPERATIONS,
        targetIsSelf: true,
        nextIsActive: false,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('SELF_DISABLE_FORBIDDEN');
    }
  });
});
