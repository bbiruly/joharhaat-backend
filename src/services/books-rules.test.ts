import { describe, expect, it } from 'vitest';
import { ApiError } from '../utils/api-error.js';
import { amountInPaise, assertBalancedJournal, assertWithinBooksStart, movementDelta } from './books-rules.js';

const codeOf = (fn: () => unknown) => {
  try { fn(); return null; } catch (error) { return error instanceof ApiError ? error.code : 'unexpected'; }
};

describe('Kolhan books rules', () => {
  it('parses money exactly as paise', () => {
    expect(amountInPaise('120.05')).toBe(12005n);
    expect(codeOf(() => amountInPaise('1.005'))).toBe('BOOKS_AMOUNT_INVALID');
  });

  it('requires balanced entries with one side per line', () => {
    expect(assertBalancedJournal([{ accountId: 'cash', debit: '10', credit: 0 }, { accountId: 'sales', debit: 0, credit: '10.00' }])).toEqual({ debitPaise: '1000', creditPaise: '1000' });
    expect(codeOf(() => assertBalancedJournal([{ accountId: 'cash', debit: 10, credit: 0 }, { accountId: 'sales', debit: 0, credit: 9 }]))).toBe('BOOKS_JOURNAL_UNBALANCED');
    expect(codeOf(() => assertBalancedJournal([{ accountId: 'cash', debit: 10, credit: 10 }, { accountId: 'sales', debit: 0, credit: 10 }]))).toBe('BOOKS_LINE_SIDE_INVALID');
  });

  it('checks movement direction and permits signed adjustments', () => {
    expect(movementDelta('PURCHASE', '2.5')).toBe(2.5);
    expect(movementDelta('SALE', '-1')).toBe(-1);
    expect(movementDelta('CONSUMPTION', '-0.5')).toBe(-0.5);
    expect(movementDelta('ADJUSTMENT', '-3')).toBe(-3);
    expect(codeOf(() => movementDelta('SALE', 1))).toBe('STOCK_DIRECTION_INVALID');
  });

  it('keeps entries on or after the configured start date', () => {
    expect(codeOf(() => assertWithinBooksStart(new Date('2026-01-01'), new Date('2026-01-02')))).toBe('BOOKS_DATE_BEFORE_START');
    expect(codeOf(() => assertWithinBooksStart(new Date('2026-01-02'), new Date('2026-01-02')))).toBeNull();
  });
});
