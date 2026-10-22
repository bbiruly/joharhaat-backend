import { ApiError } from '../utils/api-error.js';

export interface JournalLineInput {
  accountId: string;
  debit: string | number;
  credit: string | number;
  itemId?: string | undefined;
  cashFlowActivity?: 'OPERATING' | 'INVESTING' | 'FINANCING' | 'TRANSFER' | null | undefined;
  cashFlowParticular?: string | null | undefined;
}

export function validateCashFlowClassification(lines: JournalLineInput[], cashAccountIds: Set<string>) {
  for (const line of lines) {
    if (!cashAccountIds.has(line.accountId)) continue;
    if (!line.cashFlowActivity || !line.cashFlowParticular?.trim())
      throw new ApiError(422, 'Classify each cash or bank movement and enter its particular.', 'BOOKS_CASH_FLOW_CLASSIFICATION_REQUIRED');
  }
}

export interface CashFlowInputRow {
  activity: 'OPERATING' | 'INVESTING' | 'FINANCING' | 'TRANSFER' | null;
  particular: string | null;
  debit: string;
  credit: string;
}

export function calculateCashFlow(rows: CashFlowInputRow[]) {
  const result = {
    OPERATING: { rows: new Map<string, { inflow: bigint; outflow: bigint }>(), inflow: 0n, outflow: 0n },
    INVESTING: { rows: new Map<string, { inflow: bigint; outflow: bigint }>(), inflow: 0n, outflow: 0n },
    FINANCING: { rows: new Map<string, { inflow: bigint; outflow: bigint }>(), inflow: 0n, outflow: 0n },
    unclassified: { rows: new Map<string, { inflow: bigint; outflow: bigint }>(), inflow: 0n, outflow: 0n },
  };
  for (const line of rows) {
    if (line.activity === 'TRANSFER') continue;
    const group = line.activity ? result[line.activity] : result.unclassified;
    const label = line.particular?.trim() || 'Unclassified';
    const row = group.rows.get(label) ?? { inflow: 0n, outflow: 0n };
    row.inflow += amountInPaise(line.debit);
    row.outflow += amountInPaise(line.credit);
    group.inflow += amountInPaise(line.debit);
    group.outflow += amountInPaise(line.credit);
    group.rows.set(label, row);
  }
  const serialize = (group: typeof result.OPERATING) => ({
    rows: [...group.rows].map(([particular, values]) => ({ particular, inflow: (values.inflow / 100n).toString() + '.' + String(values.inflow % 100n).padStart(2, '0'), outflow: (values.outflow / 100n).toString() + '.' + String(values.outflow % 100n).padStart(2, '0') })),
    totalInflow: (group.inflow / 100n).toString() + '.' + String(group.inflow % 100n).padStart(2, '0'),
    totalOutflow: (group.outflow / 100n).toString() + '.' + String(group.outflow % 100n).padStart(2, '0'),
    net: ((group.inflow - group.outflow) < 0n ? '-' : '') + ( (group.inflow - group.outflow < 0n ? -(group.inflow - group.outflow) : group.inflow - group.outflow) / 100n).toString() + '.' + String((group.inflow - group.outflow < 0n ? -(group.inflow - group.outflow) : group.inflow - group.outflow) % 100n).padStart(2, '0'),
  });
  const operating = serialize(result.OPERATING), investing = serialize(result.INVESTING), financing = serialize(result.FINANCING), unclassified = serialize(result.unclassified);
  const netPaise = result.OPERATING.inflow - result.OPERATING.outflow + result.INVESTING.inflow - result.INVESTING.outflow + result.FINANCING.inflow - result.FINANCING.outflow;
  return { operating, investing, financing, unclassified, netChange: ((netPaise < 0n ? '-' : '') + (netPaise < 0n ? -netPaise : netPaise) / 100n + '.' + String((netPaise < 0n ? -netPaise : netPaise) % 100n).padStart(2, '0')) };
}

export function amountInPaise(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
    throw new ApiError(422, 'Amounts must be non-negative with at most two decimal places.', 'BOOKS_AMOUNT_INVALID');
  const parts = raw.split('.');
  const rupees = parts[0] ?? '0';
  const paise = parts[1] ?? '';
  return BigInt(rupees) * 100n + BigInt(paise.padEnd(2, '0'));
}

export function assertBalancedJournal(lines: JournalLineInput[]) {
  if (lines.length < 2)
    throw new ApiError(422, 'A journal entry needs at least two lines.', 'BOOKS_JOURNAL_TOO_SHORT');
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    const dr = amountInPaise(line.debit);
    const cr = amountInPaise(line.credit);
    if ((dr === 0n) === (cr === 0n))
      throw new ApiError(422, 'Each journal line must contain either a debit or a credit.', 'BOOKS_LINE_SIDE_INVALID');
    debit += dr;
    credit += cr;
  }
  if (debit === 0n || debit !== credit)
    throw new ApiError(422, 'Debits and credits must be equal and non-zero.', 'BOOKS_JOURNAL_UNBALANCED');
  return { debitPaise: debit.toString(), creditPaise: credit.toString() };
}

export function movementDelta(type: string, quantity: string | number): number {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount === 0)
    throw new ApiError(422, 'Stock movement quantity must be non-zero.', 'STOCK_QUANTITY_INVALID');
  const inward = ['PURCHASE', 'PRODUCTION', 'RETURN'].includes(type);
  const outward = ['CONSUMPTION', 'SALE', 'DAMAGE', 'SAMPLE', 'EXPIRY'].includes(type);
  if ((inward && amount < 0) || (outward && amount > 0))
    throw new ApiError(422, 'Stock movement quantity has the wrong direction.', 'STOCK_DIRECTION_INVALID');
  if (!inward && !outward && type !== 'ADJUSTMENT')
    throw new ApiError(422, 'Stock movement type is not supported.', 'STOCK_MOVEMENT_INVALID');
  return amount;
}

export function assertWithinBooksStart(date: Date, startDate: Date) {
  if (Number.isNaN(date.getTime()) || date < startDate)
    throw new ApiError(422, 'The entry date must be on or after the books start date.', 'BOOKS_DATE_BEFORE_START');
}
