import { ApiError } from '../utils/api-error.js';

export interface JournalLineInput {
  accountId: string;
  debit: string | number;
  credit: string | number;
  itemId?: string | undefined;
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
