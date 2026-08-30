import { describe, expect, it } from 'vitest';
import { decimal } from '../src/utils/money.js';
import { calculateCheckoutTotals } from '../src/services/checkout.service.js';

describe('checkout money policy', () => {
  it('calculates 2.5% CGST, 2.5% SGST and exact total', () => {
    const result = calculateCheckoutTotals(decimal('1000'), decimal('100'), decimal('60'));
    expect(result.cgst.toFixed(2)).toBe('22.50');
    expect(result.sgst.toFixed(2)).toBe('22.50');
    expect(result.total.toFixed(2)).toBe('1005.00');
  });
  it('rejects discount above GMV', () => expect(() => calculateCheckoutTotals(decimal(10), decimal(11), decimal(0))).toThrow('Discount cannot exceed'));
});
