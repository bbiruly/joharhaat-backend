import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { deliveryFeeForPin, deliveryQuoteStatus, parseDeliveryPincodeCsv } from './delivery-rules.js';

const csv = (rows: string) => `pincode,state,district,serviceable,deliveryFee\n${rows}`;
const d = (value: string) => new Prisma.Decimal(value);

describe('delivery PIN rules', () => {
  it('does not quote a charge until admin PIN rates are active', () => {
    expect(deliveryQuoteStatus(false, true)).toBe('RATES_NOT_CONFIGURED');
    expect(deliveryQuoteStatus(true, false)).toBe('ADDRESS_REQUIRED');
    expect(deliveryQuoteStatus(true, true, true)).toBe('QUOTED');
    expect(deliveryQuoteStatus(true, true, false)).toBe('PIN_NOT_SERVICEABLE');
  });
  it('parses nationwide PIN metadata and normalizes state aliases', () => {
    expect(parseDeliveryPincodeCsv(csv('752001,Orissa,Puri,true,79'))).toEqual({
      ok: true,
      rows: [{ postalCode: '752001', state: 'Odisha', district: 'Puri', isServiceable: true, deliveryFee: '79.00' }],
    });
  });

  it('rejects duplicate, invalid PINs, unknown states, and malformed rates', () => {
    const result = parseDeliveryPincodeCsv(csv([
      '12A456,Jharkhand,Ranchi,true,79',
      '110001,Unknown State,New Delhi,yes,-2',
      '110001,Delhi,New Delhi,true,79',
    ].join('\n')));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes('six digits'))).toBe(true);
      expect(result.issues.some((issue) => issue.message.includes('not recognized'))).toBe(true);
      expect(result.issues.some((issue) => issue.message.includes('true or false'))).toBe(true);
      expect(result.issues.some((issue) => issue.message.includes('Duplicate PIN'))).toBe(true);
    }
  });

  it('supports RFC-style quoted district values', () => {
    expect(parseDeliveryPincodeCsv(csv('110001,Delhi,"Central, New Delhi",true,42.5'))).toMatchObject({
      ok: true,
      rows: [{ district: 'Central, New Delhi', deliveryFee: '42.50' }],
    });
  });

  it('charges the PIN rate below the post-coupon threshold and waives it at the threshold', () => {
    const pin = { isServiceable: true, deliveryFee: d('79') };
    const common = { freeDeliveryThreshold: d('1500'), pin };
    expect(deliveryFeeForPin({ ...common, merchandiseAfterDiscount: d('1499.99') }).toFixed(2)).toBe('79.00');
    expect(deliveryFeeForPin({ ...common, merchandiseAfterDiscount: d('1500') }).toFixed(2)).toBe('0.00');
  });

  it('blocks missing or unserviceable PINs instead of applying a universal fallback fee', () => {
    const common = { freeDeliveryThreshold: d('1500'), merchandiseAfterDiscount: d('100') };
    expect(() => deliveryFeeForPin({ ...common, pin: null })).toThrowError('Delivery is not available');
    expect(() => deliveryFeeForPin({ ...common, pin: { isServiceable: false, deliveryFee: d('0') } })).toThrowError('Delivery is not available');
  });
});
