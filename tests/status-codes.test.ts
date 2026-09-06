import { describe, expect, it } from 'vitest';
import {
  FulfillmentStatus,
  ModerationStatus,
  PaymentIntentStatus,
  ProductLifecycleStatus,
} from '../src/generated/prisma/client.js';
import {
  CATALOG_EVENTS,
  ORDER_EVENTS,
  PAYMENT_EVENTS,
  STATUS_CODES,
  VENDOR_EVENTS,
  codeOf,
  describeEvent,
  findByCode,
  labelOf,
} from '../src/config/status-codes.js';

describe('status code registry', () => {
  it('has no duplicate codes', () => {
    const codes = Object.values(STATUS_CODES).map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('carries both languages for every event, with no empty string', () => {
    for (const [name, entry] of Object.entries(STATUS_CODES)) {
      expect(entry.en.trim(), `${name}.en`).not.toBe('');
      expect(entry.hi.trim(), `${name}.hi`).not.toBe('');
      // A Hindi string that is byte-identical to the English one is almost
      // certainly an untranslated placeholder.
      expect(entry.hi, `${name}.hi is untranslated`).not.toBe(entry.en);
    }
  });

  it('resolves a raw code back to its entry', () => {
    expect(findByCode('O001')).toBe(STATUS_CODES.ORDER_CREATED);
    expect(findByCode('P004')).toBe(STATUS_CODES.PAYMENT_FAILED);
    expect(findByCode('NOPE')).toBeUndefined();
  });

  it('formats codes and labels for logs', () => {
    expect(codeOf('ORDER_CREATED')).toBe('O001');
    expect(labelOf('ORDER_CREATED')).toBe('O001 Order placed by customer');
    expect(describeEvent('PAYMENT_FAILED', 'hi')).toBe('भुगतान विफल');
  });
});

/**
 * The registry is only useful if it cannot drift from the schema. Every
 * dbStatus must be a real enum value, and every enum value that represents a
 * lifecycle state an operator sees must have an event.
 */
describe('registry stays in sync with the Prisma enums', () => {
  it('every dbStatus is a real enum value', () => {
    const known = new Set<string>([
      ...Object.values(FulfillmentStatus),
      ...Object.values(PaymentIntentStatus),
      ...Object.values(ModerationStatus),
      ...Object.values(ProductLifecycleStatus),
    ]);
    for (const [name, entry] of Object.entries(STATUS_CODES)) {
      if (entry.dbStatus) expect(known, `${name}.dbStatus`).toContain(entry.dbStatus);
    }
  });

  it('covers every FulfillmentStatus', () => {
    const mapped = new Set(
      Object.values(ORDER_EVENTS).map((entry) => entry.dbStatus).filter(Boolean),
    );
    for (const status of Object.values(FulfillmentStatus)) expect(mapped).toContain(status);
  });

  it('covers every PaymentIntentStatus', () => {
    const mapped = new Set(
      Object.values(PAYMENT_EVENTS).map((entry) => entry.dbStatus).filter(Boolean),
    );
    for (const status of Object.values(PaymentIntentStatus)) expect(mapped).toContain(status);
  });

  it('covers every ProductLifecycleStatus', () => {
    const mapped = new Set(
      Object.values(CATALOG_EVENTS).map((entry) => entry.dbStatus).filter(Boolean),
    );
    for (const status of Object.values(ProductLifecycleStatus)) expect(mapped).toContain(status);
  });

  it('covers every ModerationStatus', () => {
    const mapped = new Set(
      Object.values(VENDOR_EVENTS).map((entry) => entry.dbStatus).filter(Boolean),
    );
    for (const status of Object.values(ModerationStatus)) expect(mapped).toContain(status);
  });
});
