import { describe, expect, it } from 'vitest';
import { addressSchema } from './customer.schema.js';

const address = {
  label: 'Home', fullName: 'Asha Kumar', mobile: '9876543210',
  line1: 'Main Road, Village', district: 'Ranchi', postalCode: '834001',
};

describe('customer address input', () => {
  it('requires an explicit state so unknown PINs are never assigned a guessed state', () => {
    expect(addressSchema.safeParse(address).success).toBe(false);
    expect(addressSchema.safeParse({ ...address, state: 'Jharkhand' }).success).toBe(true);
  });
});
