import { describe, expect, it } from 'vitest';
import { FulfillmentStatus } from '../generated/prisma/client.js';
import { assertVendorOrderTransition } from './vendor.service.js';

describe('vendor order transitions', () => {
  it('blocks packing until payment is paid or authorized', () => {
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.PENDING, next: FulfillmentStatus.PACKED, paymentStatus: 'PENDING' })).toThrowError(expect.objectContaining({ code: 'ORDER_PAYMENT_REQUIRED' }));
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.PENDING, next: FulfillmentStatus.PACKED, paymentStatus: 'FAILED' })).toThrowError(expect.objectContaining({ code: 'ORDER_PAYMENT_REQUIRED' }));
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.PENDING, next: FulfillmentStatus.PACKED, paymentStatus: 'PAID' })).not.toThrow();
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.PENDING, next: FulfillmentStatus.PACKED, paymentStatus: 'AUTHORIZED' })).not.toThrow();
  });

  it('requires carrier and tracking details before shipment', () => {
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.PACKED, next: FulfillmentStatus.SHIPPED, paymentStatus: 'PAID' })).toThrowError(expect.objectContaining({ code: 'SHIPMENT_DETAILS_REQUIRED' }));
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.PACKED, next: FulfillmentStatus.SHIPPED, paymentStatus: 'PAID', carrierName: 'India Post', carrierTrackingId: 'AB1234' })).not.toThrow();
  });

  it('rejects invalid transitions', () => {
    expect(() => assertVendorOrderTransition({ current: FulfillmentStatus.DELIVERED, next: FulfillmentStatus.SHIPPED, paymentStatus: 'PAID', carrierName: 'India Post', carrierTrackingId: 'AB1234' })).toThrowError(expect.objectContaining({ code: 'INVALID_ORDER_TRANSITION' }));
  });
});
