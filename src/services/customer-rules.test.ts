import { describe, expect, it } from 'vitest';
import { addressDeletionPlan } from './customer-rules.js';

describe('address deletion', () => {
  it('archives addresses referenced by historical orders and promotes a replacement default', () => {
    expect(addressDeletionPlan({ referencedByOrder: true, isDefault: true, hasOtherActiveAddress: true }))
      .toEqual({ archive: true, promoteNextDefault: true });
  });

  it('physically removes an unreferenced non-default address', () => {
    expect(addressDeletionPlan({ referencedByOrder: false, isDefault: false, hasOtherActiveAddress: true }))
      .toEqual({ archive: false, promoteNextDefault: false });
  });
});
