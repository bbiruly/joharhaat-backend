import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { allocateVendorTaxShares, extractExclusiveDeliveryTax, extractInclusiveTax, requireProductTaxConfiguration } from './checkout-tax.js';
import { calculateCheckoutTaxTotals } from './checkout.service.js';

const d = (value: string) => new Prisma.Decimal(value);

describe('checkout tax calculations', () => {
  it('blocks checkout until an admin sets a valid HSN and rate, while allowing exempt zero-rate products', () => {
    expect(() => requireProductTaxConfiguration('Soap', null, d('5'))).toThrow('tax classification is pending admin review');
    expect(() => requireProductTaxConfiguration('Soap', '340111', null)).toThrow('tax classification is pending admin review');
    expect(requireProductTaxConfiguration('Soap', '340111', d('0'))).toEqual({ hsnCode: '340111', rate: d('0') });
  });
  it('extracts inclusive GST without increasing the product price', () => {
    const result = extractInclusiveTax(d('2.00'), d('5'), false);
    expect(result).toEqual({ taxableValue: d('1.90'), cgst: d('0.05'), sgst: d('0.05'), igst: d('0.00') });
    expect(result.taxableValue.plus(result.cgst).plus(result.sgst).toFixed(2)).toBe('2.00');
  });

  it('uses IGST for inter-state supplies', () => {
    const result = extractInclusiveTax(d('105.00'), d('5'), true);
    expect(result).toEqual({ taxableValue: d('100.00'), cgst: d('0.00'), sgst: d('0.00'), igst: d('5.00') });
  });

  it('keeps configured delivery tax separate from the product price', () => {
    const result = extractExclusiveDeliveryTax(d('79.00'), d('5'), false);
    expect(result.total.toFixed(2)).toBe('82.95');
    expect(result.cgst.plus(result.sgst).toFixed(2)).toBe('3.95');
  });

  it('keeps mixed product rates and paise rounding in separate tax lines', () => {
    const result = calculateCheckoutTaxTotals([
      { amount: d('100.00'), hsnCode: '340111', rate: d('5') },
      { amount: d('118.00'), hsnCode: '340111', rate: d('18') },
    ], d('0'), d('0'), d('0'), false);
    expect(result.cgst.toFixed(2)).toBe('11.38');
    expect(result.sgst.toFixed(2)).toBe('11.38');
    expect(result.taxLines.map(({ component, rate, amount }) => [component, rate, amount])).toEqual([
      ['CGST', 2.5, 2.38], ['CGST', 9, 9], ['SGST', 2.5, 2.38], ['SGST', 9, 9],
    ]);
    const rounded = extractInclusiveTax(d('1.05'), d('5'), false);
    expect(rounded.cgst.toFixed(2)).toBe('0.03');
    expect(rounded.sgst.toFixed(2)).toBe('0.02');
  });

  it('allocates mixed-rate and delivery taxes to vendor consignments without losing paise', () => {
    const itemTaxes = [
      extractInclusiveTax(d('100.00'), d('5'), false),
      extractInclusiveTax(d('118.00'), d('18'), false),
    ];
    const shares = allocateVendorTaxShares([[0], [1]], itemTaxes, { cgst: d('0.50'), sgst: d('0.50'), igst: d('0') }, [d('100'), d('118')]);
    expect(shares.map((share) => share.cgst.toFixed(2))).toEqual(['2.61', '9.27']);
    expect(shares.map((share) => share.sgst.toFixed(2))).toEqual(['2.61', '9.27']);
    expect(sum(shares.map((share) => share.cgst)).toFixed(2)).toBe('11.88');
  });
});

function sum(values: Prisma.Decimal[]) { return values.reduce((total, value) => total.plus(value), d('0')); }
