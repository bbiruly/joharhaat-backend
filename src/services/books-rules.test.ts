import { describe, expect, it } from 'vitest';
import { ApiError } from '../utils/api-error.js';
import { amountInPaise, assertBalancedJournal, assertWithinBooksStart, calculateCashFlow, movementDelta, validateCashFlowClassification } from './books-rules.js';

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

  it('requires classification for cash journal lines but not non-cash lines', () => {
    expect(codeOf(() => validateCashFlowClassification([{ accountId: 'cash', debit: '10', credit: '0' }], new Set(['cash'])))).toBe('BOOKS_CASH_FLOW_CLASSIFICATION_REQUIRED');
    expect(() => validateCashFlowClassification([{ accountId: 'sales', debit: '0', credit: '10' }], new Set(['cash']))).not.toThrow();
  });

  it('totals each activity, excludes transfers, and computes combined net using paise precision', () => {
    const result = calculateCashFlow([
      { activity: 'OPERATING', particular: 'Customer receipts', debit: '800000', credit: '0' },
      { activity: 'OPERATING', particular: 'Supplier payments', debit: '0', credit: '350000' },
      { activity: 'OPERATING', particular: 'Supplier payments', debit: '0', credit: '210000' },
      { activity: 'INVESTING', particular: 'Equipment sale', debit: '60000', credit: '0' },
      { activity: 'INVESTING', particular: 'Interest received on investments', debit: '20000', credit: '0' },
      { activity: 'INVESTING', particular: 'Machinery purchase', debit: '0', credit: '200000' },
      { activity: 'INVESTING', particular: 'Long-term investment purchase', debit: '0', credit: '100000' },
      { activity: 'FINANCING', particular: 'Equity shares issued', debit: '300000', credit: '0' },
      { activity: 'FINANCING', particular: 'Loan proceeds', debit: '200000', credit: '0' },
      { activity: 'FINANCING', particular: 'Loan repayment', debit: '0', credit: '80000' },
      { activity: 'FINANCING', particular: 'Dividend paid', debit: '0', credit: '30000' },
      { activity: 'FINANCING', particular: 'Interest paid', debit: '0', credit: '25000' },
      { activity: 'TRANSFER', particular: 'Cash to bank', debit: '50000', credit: '0' },
      { activity: null, particular: null, debit: '100', credit: '0' },
    ]);
    expect(result.operating).toMatchObject({ totalInflow: '800000.00', totalOutflow: '560000.00', net: '240000.00' });
    expect(result.investing).toMatchObject({ totalInflow: '80000.00', totalOutflow: '300000.00', net: '-220000.00' });
    expect(result.financing).toMatchObject({ totalInflow: '500000.00', totalOutflow: '135000.00', net: '365000.00' });
    expect(result.unclassified.totalInflow).toBe('100.00');
    expect(result.netChange).toBe('385000.00');
  });

  it('nets a classified reversal against the original cash movement', () => {
    const result = calculateCashFlow([
      { activity: 'OPERATING', particular: 'Customer receipt', debit: '100.25', credit: '0' },
      { activity: 'OPERATING', particular: 'Customer receipt', debit: '0', credit: '100.25' },
    ]);
    expect(result.operating).toMatchObject({ totalInflow: '100.25', totalOutflow: '100.25', net: '0.00' });
    expect(result.netChange).toBe('0.00');
  });
});
