import { randomUUID } from 'node:crypto';
import { BooksAccountType, BooksEntryStatus, BooksPartyType, BooksPeriodStatus, BooksReconciliationStatus, BooksSalesChannel, LedgerType, PaymentIntentStatus, Prisma, StockItemType, StockMovementType } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { adminAccess } from './admin.service.js';
import { ApiError } from '../utils/api-error.js';
import { codeOf, type StatusEvent } from '../config/status-codes.js';
import { assertBalancedJournal, assertWithinBooksStart, calculateCashFlow, movementDelta, validateCashFlowClassification, type JournalLineInput } from './books-rules.js';

const FINANCE = 'payouts:manage' as const;
const defaultAccounts = [
  ['1000', 'Cash on hand', BooksAccountType.ASSET, true, false],
  ['1010', 'Bank account', BooksAccountType.ASSET, true, false],
  ['1100', 'Accounts receivable', BooksAccountType.ASSET, false, false],
  ['1200', 'Inventory', BooksAccountType.ASSET, false, false],
  ['2000', 'Accounts payable', BooksAccountType.LIABILITY, false, false],
  ['2100', 'Tax payable', BooksAccountType.LIABILITY, false, false],
  ['3000', "Owner's equity", BooksAccountType.EQUITY, false, false],
  ['4000', 'Sales income', BooksAccountType.INCOME, false, false],
  ['4100', 'Other income', BooksAccountType.INCOME, false, false],
  ['5000', 'Cost of goods sold', BooksAccountType.EXPENSE, false, true],
  ['6000', 'Operating expenses', BooksAccountType.EXPENSE, false, false],
] as const;

async function requireSettings(tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const settings = await tx.booksSettings.findUnique({ where: { id: 'kolhan' } });
  if (!settings) throw new ApiError(409, 'Set up Kolhan books before adding records.', 'BOOKS_SETUP_REQUIRED');
  return settings;
}

async function lockBooks(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM books_settings WHERE id = 'kolhan' FOR UPDATE`;
}

function parseDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new ApiError(422, 'Enter a valid calendar date.', 'BOOKS_DATE_INVALID');
  return date;
}

async function assertOpenDate(tx: Prisma.TransactionClient, date: Date, startDate: Date) {
  await lockBooks(tx);
  assertWithinBooksStart(date, startDate);
  const closed = await tx.booksPeriod.findFirst({ where: { status: BooksPeriodStatus.CLOSED, startsOn: { lte: date }, endsOn: { gte: date } } });
  if (closed) throw new ApiError(409, 'This accounting period is closed.', 'BOOKS_PERIOD_CLOSED');
}

function auditData(actorId: string, action: StatusEvent, entityType: string, entityId: string, requestId?: string) {
  return { actorId, action: codeOf(action), entityType, entityId, requestId: requestId ?? null, permission: FINANCE };
}

export async function booksOverview(userId: string) {
  await adminAccess(userId, FINANCE);
  const settings = await prisma.booksSettings.findUnique({ where: { id: 'kolhan' } });
  if (!settings) return { setupRequired: true, settings: null, accounts: [], entries: [], stock: [], movements: [], parties: [], periods: [], reconciliations: [] };
  const [accounts, entries, stock, movements, parties, periods, reconciliations] = await Promise.all([
    prisma.booksAccount.findMany({ orderBy: { code: 'asc' } }),
    prisma.booksEntry.findMany({ where: { status: { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] } }, include: { lines: { include: { account: true } }, party: true }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 100 }),
    prisma.stockItem.findMany({ where: { isActive: true }, include: { batches: true }, orderBy: { name: 'asc' } }),
    prisma.stockMovement.findMany({ include: { item: true, batch: true, entry: { select: { reference: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.booksParty.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.booksPeriod.findMany({ orderBy: { startsOn: 'desc' }, take: 24 }),
    prisma.booksBankReconciliation.findMany({ include: { account: true }, orderBy: { endsOn: 'desc' }, take: 24 }),
  ]);
  return { setupRequired: false, settings, accounts, entries, stock, movements, parties, periods, reconciliations };
}

export async function setupBooks(userId: string, requestId: string | undefined, startDateValue: string) {
  await adminAccess(userId, FINANCE);
  const startDate = parseDay(startDateValue);
  return prisma.$transaction(async (tx) => {
    if (await tx.booksSettings.findUnique({ where: { id: 'kolhan' } }))
      throw new ApiError(409, 'Kolhan books have already been set up.', 'BOOKS_ALREADY_CONFIGURED');
    const settings = await tx.booksSettings.create({ data: { id: 'kolhan', startDate } });
    for (const [code, name, type, isCashAccount, isCostOfGoodsSold] of defaultAccounts)
      await tx.booksAccount.create({ data: { code, name, type, isCashAccount, isCostOfGoodsSold, isSystem: true } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_SETUP_SAVED', 'BooksSettings', settings.id, requestId) });
    return settings;
  });
}

export async function listAccounts(userId: string) {
  await adminAccess(userId, FINANCE);
  return prisma.booksAccount.findMany({ orderBy: { code: 'asc' } });
}

export async function createAccount(userId: string, requestId: string | undefined, input: { code: string; name: string; type: BooksAccountType; isCashAccount?: boolean; isCostOfGoodsSold?: boolean }) {
  await adminAccess(userId, FINANCE);
  if (!/^[A-Z0-9-]{2,20}$/.test(input.code)) throw new ApiError(422, 'Account code format is invalid.', 'BOOKS_ACCOUNT_CODE_INVALID');
  if ((input.isCashAccount && input.type !== BooksAccountType.ASSET) || (input.isCostOfGoodsSold && input.type !== BooksAccountType.EXPENSE)) throw new ApiError(422, 'Cash accounts must be assets and cost-of-goods-sold accounts must be expenses.', 'BOOKS_ACCOUNT_CLASSIFICATION_INVALID');
  return prisma.$transaction(async (tx) => {
    await requireSettings(tx);
    const account = await tx.booksAccount.create({ data: input });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_REFERENCE_CREATED', 'BooksAccount', account.id, requestId) });
    return account;
  });
}

export async function createParty(userId: string, requestId: string | undefined, input: { type: BooksPartyType; name: string; email?: string; phone?: string; taxId?: string; address?: string }) {
  await adminAccess(userId, FINANCE);
  return prisma.$transaction(async (tx) => {
    await requireSettings(tx);
    const party = await tx.booksParty.create({ data: input });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_REFERENCE_CREATED', 'BooksParty', party.id, requestId) });
    return party;
  });
}

export async function createStockItem(userId: string, requestId: string | undefined, input: { sku: string; name: string; type: StockItemType; unit: string; category?: string; hsnCode?: string; taxRate?: number }) {
  await adminAccess(userId, FINANCE);
  return prisma.$transaction(async (tx) => {
    await requireSettings(tx);
    const item = await tx.stockItem.create({ data: { ...input, taxRate: input.taxRate === undefined ? null : new Prisma.Decimal(input.taxRate) } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_REFERENCE_CREATED', 'StockItem', item.id, requestId) });
    return item;
  });
}

export async function postEntry(userId: string, requestId: string | undefined, input: {
  reference?: string; documentNumber?: string; source?: string; sourceReference?: string; channel?: BooksSalesChannel;
  memo: string; occurredAt: string; partyId?: string; lines: JournalLineInput[];
}) {
  await adminAccess(userId, FINANCE);
  assertBalancedJournal(input.lines);
  const occurredAt = parseDay(input.occurredAt);
  return prisma.$transaction(async (tx) => {
    const settings = await requireSettings(tx);
    await assertOpenDate(tx, occurredAt, settings.startDate);
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
    const accounts = await tx.booksAccount.findMany({ where: { id: { in: accountIds }, isActive: true }, select: { id: true } });
    if (accounts.length !== accountIds.length) throw new ApiError(422, 'Every journal account must exist and be active.', 'BOOKS_ACCOUNT_INVALID');
    validateCashFlowClassification(input.lines, new Set((await tx.booksAccount.findMany({ where: { id: { in: accountIds }, isCashAccount: true }, select: { id: true } })).map((account) => account.id)));
    const itemIds = [...new Set(input.lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
    if (itemIds.length && (await tx.stockItem.count({ where: { id: { in: itemIds }, isActive: true } })) !== itemIds.length)
      throw new ApiError(422, 'Every linked stock item must exist and be active.', 'STOCK_ITEM_INVALID');
    if (input.partyId && !(await tx.booksParty.findUnique({ where: { id: input.partyId } })))
      throw new ApiError(422, 'The selected supplier or customer does not exist.', 'BOOKS_PARTY_INVALID');
    const entry = await tx.booksEntry.create({ data: {
      reference: input.reference?.trim() || `KJ-${randomUUID()}`,
      ...(input.documentNumber ? { documentNumber: input.documentNumber } : {}),
      source: input.source ?? 'MANUAL', ...(input.sourceReference ? { sourceReference: input.sourceReference } : {}),
      ...(input.channel ? { channel: input.channel } : {}), memo: input.memo.trim(), occurredAt,
      ...(input.partyId ? { party: { connect: { id: input.partyId } } } : {}), createdById: userId,
      status: BooksEntryStatus.POSTED, postedAt: new Date(),
      lines: { create: input.lines.map((line) => ({ accountId: line.accountId, debit: new Prisma.Decimal(line.debit), credit: new Prisma.Decimal(line.credit), itemId: line.itemId ?? null, cashFlowActivity: line.cashFlowActivity ?? null, cashFlowParticular: line.cashFlowParticular?.trim() || null })) },
    } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_ENTRY_POSTED', 'BooksEntry', entry.id, requestId) });
    return entry;
  });
}

export async function reverseEntry(userId: string, requestId: string | undefined, id: string, reason: string) {
  await adminAccess(userId, FINANCE);
  return prisma.$transaction(async (tx) => {
    const original = await tx.booksEntry.findUnique({ where: { id }, include: { lines: true, stockMovements: true } });
    if (!original || original.status !== BooksEntryStatus.POSTED) throw new ApiError(404, 'Posted entry was not found.', 'BOOKS_ENTRY_NOT_FOUND');
    if (original.stockMovements.length) throw new ApiError(409, 'Correct linked stock movements before reversing this entry.', 'BOOKS_ENTRY_HAS_STOCK_MOVEMENTS');
    const settings = await requireSettings(tx);
    await assertOpenDate(tx, new Date(), settings.startDate);
    const existing = await tx.booksEntry.findUnique({ where: { reversalOfId: id } });
    if (existing) throw new ApiError(409, 'This entry has already been reversed.', 'BOOKS_ENTRY_ALREADY_REVERSED');
    const reversal = await tx.booksEntry.create({ data: {
      reference: `REV-${randomUUID()}`, source: 'REVERSAL', sourceReference: original.reference,
      memo: `Reversal: ${reason.trim()}`, occurredAt: new Date(new Date().toISOString().slice(0, 10)),
      status: BooksEntryStatus.POSTED, postedAt: new Date(), createdById: userId, reversalOfId: id,
      lines: { create: original.lines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit, itemId: line.itemId, cashFlowActivity: line.cashFlowActivity, cashFlowParticular: line.cashFlowParticular })) },
    } });
    await tx.booksEntry.update({ where: { id }, data: { status: BooksEntryStatus.REVERSED } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_ENTRY_REVERSED', 'BooksEntry', id, requestId) });
    return reversal;
  });
}

export async function closePeriod(userId: string, requestId: string | undefined, startsOnValue: string, endsOnValue: string) {
  await adminAccess(userId, FINANCE);
  const startsOn = parseDay(startsOnValue), endsOn = parseDay(endsOnValue);
  if (startsOn > endsOn) throw new ApiError(422, 'Period end date must not come before its start date.', 'BOOKS_PERIOD_INVALID');
  return prisma.$transaction(async (tx) => {
    const settings = await requireSettings(tx);
    await lockBooks(tx);
    assertWithinBooksStart(startsOn, settings.startDate);
    const overlapping = await tx.booksPeriod.findFirst({ where: { startsOn: { lte: endsOn }, endsOn: { gte: startsOn } } });
    if (overlapping) throw new ApiError(409, 'This date range overlaps an existing closed period.', 'BOOKS_PERIOD_OVERLAP');
    const period = await tx.booksPeriod.create({ data: { startsOn, endsOn, status: BooksPeriodStatus.CLOSED, closedAt: new Date(), closedById: userId } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_PERIOD_CLOSED', 'BooksPeriod', period.id, requestId) });
    return period;
  });
}

export async function recordStockMovement(userId: string, requestId: string | undefined, input: {
  itemId: string; batchCode: string; location?: string; manufacturedAt?: string; expiresAt?: string; entryId?: string; type: StockMovementType;
  quantity: string; unitCost?: string; reason?: string; movedAt: string;
}) {
  await adminAccess(userId, FINANCE);
  const delta = movementDelta(input.type, input.quantity);
  const movedAt = parseDay(input.movedAt);
  return prisma.$transaction(async (tx) => {
    const settings = await requireSettings(tx);
    await assertOpenDate(tx, movedAt, settings.startDate);
    const item = await tx.stockItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ApiError(404, 'Stock item was not found.', 'STOCK_ITEM_NOT_FOUND');
    if (input.entryId) {
      const entry = await tx.booksEntry.findUnique({ where: { id: input.entryId } });
      if (!entry || entry.status !== BooksEntryStatus.POSTED) throw new ApiError(422, 'Link the stock movement to a posted accounting entry.', 'BOOKS_ENTRY_INVALID');
    }
    const createdBatch = await tx.stockBatch.upsert({
      where: { itemId_batchCode: { itemId: item.id, batchCode: input.batchCode } },
      create: { itemId: item.id, batchCode: input.batchCode, location: input.location ?? null, manufacturedAt: input.manufacturedAt ? parseDay(input.manufacturedAt) : null, expiresAt: input.expiresAt ? parseDay(input.expiresAt) : null, quantityOnHand: 0, unitCost: input.unitCost ? new Prisma.Decimal(input.unitCost) : null },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM stock_batches WHERE id = ${createdBatch.id} FOR UPDATE`;
    const batch = await tx.stockBatch.findUniqueOrThrow({ where: { id: createdBatch.id } });
    const quantityOnHand = batch.quantityOnHand.plus(new Prisma.Decimal(delta));
    if (quantityOnHand.lessThan(0)) throw new ApiError(409, 'This movement would make batch stock negative.', 'STOCK_NEGATIVE');
    await tx.stockBatch.update({ where: { id: batch.id }, data: { quantityOnHand } });
    const movement = await tx.stockMovement.create({ data: { itemId: item.id, batchId: batch.id, entryId: input.entryId ?? null, type: input.type, quantity: new Prisma.Decimal(delta), unitCost: input.unitCost ? new Prisma.Decimal(input.unitCost) : null, reason: input.reason ?? null, movedAt, createdById: userId } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'STOCK_MOVEMENT_RECORDED', 'StockMovement', movement.id, requestId) });
    return movement;
  });
}

export async function reconcileBank(userId: string, requestId: string | undefined, input: { accountId: string; startsOn: string; endsOn: string; statementBalance: string }) {
  await adminAccess(userId, FINANCE);
  const startsOn = parseDay(input.startsOn), endsOn = parseDay(input.endsOn);
  if (startsOn > endsOn) throw new ApiError(422, 'Period end date must not come before its start date.', 'BOOKS_PERIOD_INVALID');
  const statementBalance = new Prisma.Decimal(input.statementBalance);
  return prisma.$transaction(async (tx) => {
    const settings = await requireSettings(tx);
    await lockBooks(tx);
    assertWithinBooksStart(startsOn, settings.startDate);
    const account = await tx.booksAccount.findUnique({ where: { id: input.accountId } });
    if (!account || account.type !== BooksAccountType.ASSET || !account.isActive || !account.isCashAccount) throw new ApiError(422, 'Choose an active cash or bank account.', 'BOOKS_BANK_ACCOUNT_INVALID');
    const lines = await tx.booksEntryLine.findMany({ where: { accountId: account.id, entry: { status: { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] }, occurredAt: { lte: endsOn } } }, select: { debit: true, credit: true } });
    const bookBalance = lines.reduce((balance, line) => balance.plus(line.debit).minus(line.credit), new Prisma.Decimal(0));
    const difference = statementBalance.minus(bookBalance);
    const reconciliation = await tx.booksBankReconciliation.create({ data: {
      accountId: account.id, startsOn, endsOn, statementBalance, bookBalance, difference,
      status: difference.isZero() ? BooksReconciliationStatus.RECONCILED : BooksReconciliationStatus.DISCREPANCY,
      createdById: userId,
    } });
    await tx.adminAuditLog.create({ data: auditData(userId, 'BOOKS_BANK_RECONCILED', 'BooksBankReconciliation', reconciliation.id, requestId) });
    return reconciliation;
  });
}

export async function booksReports(userId: string, fromValue: string, toValue: string) {
  await adminAccess(userId, FINANCE);
  const from = parseDay(fromValue), to = parseDay(toValue);
  if (from > to) throw new ApiError(422, 'Report end date must not come before its start date.', 'BOOKS_PERIOD_INVALID');
  const settings = await requireSettings();
  assertWithinBooksStart(from, settings.startDate);
  const reportStatus = [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED];
  const [income, allThrough, cashAccounts, marginLines, partyLines] = await Promise.all([
    prisma.booksEntryLine.findMany({ where: { entry: { status: { in: reportStatus }, occurredAt: { gte: from, lte: to } } }, include: { account: true } }),
    prisma.booksEntryLine.findMany({ where: { entry: { status: { in: reportStatus }, occurredAt: { lte: to } } }, include: { account: true } }),
    prisma.booksAccount.findMany({ where: { isCashAccount: true } }),
    prisma.booksEntryLine.findMany({ where: { itemId: { not: null }, entry: { status: { in: reportStatus }, occurredAt: { gte: from, lte: to } } }, include: { account: true, item: true, entry: { select: { channel: true } } } }),
    prisma.booksEntryLine.findMany({ where: { account: { code: { in: ['1100', '2000'] } }, entry: { status: { in: reportStatus }, occurredAt: { lte: to } } }, include: { account: true, entry: { include: { party: true } } } }),
  ]);
  const sumByAccount = (lines: typeof income) => {
    const totals = new Map<string, { account: typeof lines[number]['account']; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of lines) {
      const row = totals.get(line.accountId) ?? { account: line.account, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      row.debit = row.debit.plus(line.debit); row.credit = row.credit.plus(line.credit); totals.set(line.accountId, row);
    }
    return [...totals.values()].map(({ account, debit, credit }) => ({ accountId: account.id, code: account.code, name: account.name, type: account.type, debit: debit.toString(), credit: credit.toString(), balance: (['ASSET', 'EXPENSE'].includes(account.type) ? debit.minus(credit) : credit.minus(debit)).toString() }));
  };
  const periodLines = sumByAccount(income), balanceLines = sumByAccount(allThrough);
  const cashIds = new Set(cashAccounts.map((a) => a.id));
  const retainedEarnings = balanceLines.filter((row) => ['INCOME', 'EXPENSE'].includes(row.type)).reduce((total, row) => total.plus(row.type === 'INCOME' ? row.balance : new Prisma.Decimal(row.balance).negated()), new Prisma.Decimal(0));
  const cashFlow = periodLines.filter((row) => cashIds.has(row.accountId));
  if (!retainedEarnings.isZero()) balanceLines.push({ accountId: 'derived:retained-earnings', code: 'RE', name: 'Retained earnings to date', type: BooksAccountType.EQUITY, debit: retainedEarnings.isNegative() ? retainedEarnings.abs().toString() : '0', credit: retainedEarnings.isPositive() ? retainedEarnings.toString() : '0', balance: retainedEarnings.toString() });
  const sumRows = (rows: typeof balanceLines, select: (row: typeof balanceLines[number]) => boolean) => rows.filter(select).reduce((total, row) => total.plus(row.balance), new Prisma.Decimal(0)).toString();
  const itemMargins = new Map<string, { name: string; revenue: Prisma.Decimal; cost: Prisma.Decimal }>();
  const channelMargins = new Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal }>();
  for (const line of marginLines) {
    const revenue = line.account.type === BooksAccountType.INCOME ? line.credit.minus(line.debit) : new Prisma.Decimal(0);
    const cost = line.account.isCostOfGoodsSold ? line.debit.minus(line.credit) : new Prisma.Decimal(0);
    if (!line.item || !line.itemId) continue;
    const item = itemMargins.get(line.itemId!) ?? { name: line.item.name, revenue: new Prisma.Decimal(0), cost: new Prisma.Decimal(0) };
    item.revenue = item.revenue.plus(revenue); item.cost = item.cost.plus(cost); itemMargins.set(line.itemId!, item);
    if (line.entry.channel) {
      const channel = channelMargins.get(line.entry.channel) ?? { revenue: new Prisma.Decimal(0), cost: new Prisma.Decimal(0) };
      channel.revenue = channel.revenue.plus(revenue); channel.cost = channel.cost.plus(cost); channelMargins.set(line.entry.channel, channel);
    }
  }
  const productMargins = [...itemMargins.entries()].filter(([, row]) => row.revenue.greaterThan(0) && row.cost.greaterThan(0)).map(([itemId, row]) => ({ itemId, itemName: row.name, revenue: row.revenue.toString(), cost: row.cost.toString(), margin: row.revenue.minus(row.cost).toString() }));
  const channelMarginRows = [...channelMargins.entries()].filter(([, row]) => row.revenue.greaterThan(0) && row.cost.greaterThan(0)).map(([channel, row]) => ({ channel, revenue: row.revenue.toString(), cost: row.cost.toString(), margin: row.revenue.minus(row.cost).toString() }));
  const partyBalances = new Map<string, { partyId: string | null; partyName: string; receivable: Prisma.Decimal; payable: Prisma.Decimal }>();
  for (const line of partyLines) {
    const partyId = line.entry.partyId;
    const key = partyId ?? 'unassigned';
    const row = partyBalances.get(key) ?? { partyId, partyName: line.entry.party?.name ?? '', receivable: new Prisma.Decimal(0), payable: new Prisma.Decimal(0) };
    if (line.account.code === '1100') row.receivable = row.receivable.plus(line.debit).minus(line.credit);
    if (line.account.code === '2000') row.payable = row.payable.plus(line.credit).minus(line.debit);
    partyBalances.set(key, row);
  }
  return {
    from: fromValue, to: toValue,
    incomeStatement: periodLines.filter((row) => ['INCOME', 'EXPENSE'].includes(row.type)),
    balanceSheet: balanceLines.filter((row) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(row.type)),
    trialBalance: balanceLines,
    cashFlow,
    balanceCheck: {
      assets: sumRows(balanceLines, (row) => row.type === 'ASSET'),
      liabilitiesAndEquity: sumRows(balanceLines, (row) => ['LIABILITY', 'EQUITY'].includes(row.type)),
    },
    totals: {
      income: sumRows(periodLines, (row) => row.type === 'INCOME'),
      expense: sumRows(periodLines, (row) => row.type === 'EXPENSE'),
    },
    productMargins,
    channelMargins: channelMarginRows,
    receivables: [...partyBalances.values()].filter((row) => !row.receivable.isZero()).map((row) => ({ partyId: row.partyId, partyName: row.partyName, amount: row.receivable.toString() })),
    payables: [...partyBalances.values()].filter((row) => !row.payable.isZero()).map((row) => ({ partyId: row.partyId, partyName: row.partyName, amount: row.payable.toString() })),
  };
}

export async function booksCashFlow(userId: string, fromValue: string, toValue: string) {
  await adminAccess(userId, FINANCE);
  const from = parseDay(fromValue), to = parseDay(toValue);
  if (from > to) throw new ApiError(422, 'Report end date must not come before its start date.', 'BOOKS_PERIOD_INVALID');
  const settings = await requireSettings();
  assertWithinBooksStart(from, settings.startDate);
  const cashAccounts = await prisma.booksAccount.findMany({ where: { isCashAccount: true }, select: { id: true } });
  const cashIds = cashAccounts.map((account) => account.id);
  const lineWhere = { accountId: { in: cashIds }, entry: { status: { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] }, occurredAt: { gte: from, lte: to } } };
  const [periodLines, openingLines, closingLines, payments, transfers] = await Promise.all([
    prisma.booksEntryLine.findMany({ where: lineWhere, include: { account: true, entry: { select: { reference: true, memo: true, occurredAt: true } } }, orderBy: { entry: { occurredAt: 'asc' } } }),
    prisma.booksEntryLine.findMany({ where: { accountId: { in: cashIds }, entry: { status: { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] }, occurredAt: { lt: from } } }, select: { debit: true, credit: true } }),
    prisma.booksEntryLine.findMany({ where: { accountId: { in: cashIds }, entry: { status: { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] }, occurredAt: { lte: to } } }, select: { debit: true, credit: true } }),
    prisma.paymentIntent.findMany({ where: { status: PaymentIntentStatus.SUCCEEDED, verifiedAt: { gte: from, lte: new Date(to.getTime() + 86400000 - 1) } }, select: { id: true, providerPaymentId: true, amount: true } }),
    prisma.walletLedger.findMany({ where: { type: LedgerType.BANK_TRANSFER, createdAt: { gte: from, lte: new Date(to.getTime() + 86400000 - 1) } }, select: { reference: true, amount: true } }),
  ]);
  const statement = calculateCashFlow(periodLines.map((line) => ({ activity: line.cashFlowActivity, particular: line.cashFlowParticular, debit: line.debit.toString(), credit: line.credit.toString() })));
  const sum = (lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[]) => lines.reduce((total, line) => total.plus(line.debit).minus(line.credit), new Prisma.Decimal(0));
  const openingCash = sum(openingLines), closingCash = sum(closingLines);
  const paymentRefs = payments.flatMap((payment) => payment.providerPaymentId ? [payment.providerPaymentId] : [payment.id]);
  const transferRefs = transfers.map((transfer) => transfer.reference);
  const relevantRefs = [...paymentRefs, ...transferRefs];
  const matchedLines = relevantRefs.length ? await prisma.booksEntryLine.findMany({ where: { accountId: { in: cashIds }, entry: { sourceReference: { in: relevantRefs }, status: { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] }, occurredAt: { gte: from, lte: to } } }, select: { debit: true, credit: true, entry: { select: { sourceReference: true } } } }) : [];
  const matchedByRef = new Map<string, Prisma.Decimal>();
  for (const line of matchedLines) {
    const reference = line.entry.sourceReference;
    if (!reference) continue;
    matchedByRef.set(reference, (matchedByRef.get(reference) ?? new Prisma.Decimal(0)).plus(line.debit).minus(line.credit));
  }
  const collected = payments.reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
  const transferred = transfers.reduce((total, transfer) => total.plus(transfer.amount), new Prisma.Decimal(0));
  const recordedCollections = payments.reduce((total, payment) => total.plus(matchedByRef.get(payment.providerPaymentId ?? payment.id) ?? 0), new Prisma.Decimal(0));
  const recordedTransfers = transfers.reduce((total, transfer) => total.plus((matchedByRef.get(transfer.reference) ?? new Prisma.Decimal(0)).abs()), new Prisma.Decimal(0));
  return {
    from: fromValue, to: toValue,
    activities: { operating: statement.operating, investing: statement.investing, financing: statement.financing, unclassified: statement.unclassified },
    openingCash: openingCash.toString(), closingCash: closingCash.toString(), netChange: statement.netChange,
    marketplaceReconciliation: {
      customerCollections: { operational: collected.toString(), recordedInBooks: recordedCollections.toString(), difference: collected.minus(recordedCollections).toString(), transactions: payments.length },
      vendorBankTransfers: { operational: transferred.toString(), recordedInBooks: recordedTransfers.toString(), difference: transferred.minus(recordedTransfers).toString(), transactions: transfers.length },
    },
  };
}
