import { describe, expect, it } from 'vitest';
import { decimal } from '../src/utils/money.js';
import { calculateCheckoutTaxTotals } from '../src/services/checkout.service.js';

describe('checkout money policy', () => {
  it('extracts GST from the inclusive product price without increasing the charged total', () => {
    const result = calculateCheckoutTaxTotals([{ amount: decimal('2'), hsnCode: '340111', rate: decimal('5') }], decimal('0'), decimal('79'), decimal('0'), false);
    expect(result.cgst.toFixed(2)).toBe('0.05');
    expect(result.sgst.toFixed(2)).toBe('0.05');
    expect(result.total.toFixed(2)).toBe('81.00');
    expect(result.taxLines.map((line) => [line.component, line.rate, line.amount, line.includedInProductPrice])).toEqual([
      ['CGST', 2.5, 0.05, true], ['SGST', 2.5, 0.05, true],
    ]);
  });
  it('subtracts coupons before extracting inclusive tax', () => {
    const result = calculateCheckoutTaxTotals([{ amount: decimal('100'), hsnCode: '340111', rate: decimal('5') }], decimal('10'), decimal('0'), decimal('0'), false);
    expect(result.total.toFixed(2)).toBe('90.00');
    expect(result.cgst.plus(result.sgst).toFixed(2)).toBe('4.29');
  });
  it('uses IGST for inter-state orders and adds delivery tax separately when configured', () => {
    const result = calculateCheckoutTaxTotals([{ amount: decimal('105'), hsnCode: '340111', rate: decimal('5') }], decimal('0'), decimal('79'), decimal('5'), true);
    expect(result.igst.toFixed(2)).toBe('8.95');
    expect(result.taxLines.map((line) => line.component)).toEqual(['DELIVERY_IGST', 'IGST']);
    expect(result.cgst.toFixed(2)).toBe('0.00');
    expect(result.total.toFixed(2)).toBe('187.95');
  });
  it('rejects discount above merchandise value', () => expect(() => calculateCheckoutTaxTotals([{ amount: decimal(10), hsnCode: '340111', rate: decimal('5') }], decimal(11), decimal(0), decimal(0), false)).toThrow('Discount cannot exceed'));
});
