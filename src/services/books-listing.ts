import { BooksEntryStatus, Prisma, type BooksAccountType, type BooksEntryStatus as EntryStatus, type BooksPartyType, type BooksPeriodStatus, type BooksReconciliationStatus, type StockItemType, type StockMovementType } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { adminAccess } from './admin.service.js';
import { booksListPagination, type BooksListResource } from './books-listing-rules.js';

export interface BooksListQuery {
  page: number;
  pageSize: number;
  q?: string | undefined;
  sort?: string | undefined;
  direction: 'asc' | 'desc';
  status?: string | undefined;
  type?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  itemId?: string | undefined;
  active?: boolean | undefined;
}

const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
const dateBounds = (from?: string, to?: string) => from || to ? { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}) } : undefined;

export async function listBooksRecords(userId: string, resource: BooksListResource, query: BooksListQuery) {
  await adminAccess(userId, 'payouts:manage');
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;
  const direction = query.direction;
  const q = query.q?.trim();
  const dates = dateBounds(query.from, query.to);
  switch (resource) {
    case 'entries': {
      const where: Prisma.BooksEntryWhereInput = {
        status: query.status ? query.status as EntryStatus : { in: [BooksEntryStatus.POSTED, BooksEntryStatus.REVERSED] },
        ...(dates ? { occurredAt: dates } : {}),
        ...(q ? { OR: [{ memo: contains(q) }, { reference: contains(q) }, { documentNumber: contains(q) }, { sourceReference: contains(q) }, { party: { name: contains(q) } }] } : {}),
      };
      const sort = query.sort === 'reference' ? 'reference' : query.sort === 'memo' ? 'memo' : query.sort === 'createdAt' ? 'createdAt' : 'occurredAt';
      const [rows, total] = await Promise.all([
        prisma.booksEntry.findMany({ where, include: { lines: { include: { account: true } }, party: true }, orderBy: [{ [sort]: direction }, { id: 'asc' }], skip, take }),
        prisma.booksEntry.count({ where }),
      ]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
    case 'stock-items': {
      const where: Prisma.StockItemWhereInput = { ...(query.active === undefined ? {} : { isActive: query.active }), ...(query.type ? { type: query.type as StockItemType } : {}), ...(q ? { OR: [{ name: contains(q) }, { sku: contains(q) }, { category: contains(q) }] } : {}) };
      const sort = query.sort === 'sku' ? 'sku' : query.sort === 'type' ? 'type' : 'name';
      const [rows, total] = await Promise.all([prisma.stockItem.findMany({ where, include: { batches: true }, orderBy: [{ [sort]: direction }, { id: 'asc' }], skip, take }), prisma.stockItem.count({ where })]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
    case 'stock-movements': {
      const where: Prisma.StockMovementWhereInput = { ...(query.type ? { type: query.type as StockMovementType } : {}), ...(query.itemId ? { itemId: query.itemId } : {}), ...(dates ? { movedAt: dates } : {}), ...(q ? { OR: [{ reason: contains(q) }, { batch: { batchCode: contains(q) } }, { item: { name: contains(q) } }, { item: { sku: contains(q) } }] } : {}) };
      const sort = query.sort === 'type' ? 'type' : 'movedAt';
      const [rows, total] = await Promise.all([prisma.stockMovement.findMany({ where, include: { item: true, batch: true, entry: { select: { reference: true } } }, orderBy: [{ [sort]: direction }, { id: 'asc' }], skip, take }), prisma.stockMovement.count({ where })]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
    case 'parties': {
      const where: Prisma.BooksPartyWhereInput = { ...(query.active === undefined ? {} : { isActive: query.active }), ...(query.type ? { type: query.type as BooksPartyType } : {}), ...(q ? { OR: [{ name: contains(q) }, { email: contains(q) }, { phone: contains(q) }, { taxId: contains(q) }] } : {}) };
      const sort = query.sort === 'type' ? 'type' : 'name';
      const [rows, total] = await Promise.all([prisma.booksParty.findMany({ where, orderBy: [{ [sort]: direction }, { id: 'asc' }], skip, take }), prisma.booksParty.count({ where })]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
    case 'accounts': {
      const where: Prisma.BooksAccountWhereInput = { ...(query.active === undefined ? {} : { isActive: query.active }), ...(query.type ? { type: query.type as BooksAccountType } : {}), ...(q ? { OR: [{ name: contains(q) }, { code: contains(q) }] } : {}) };
      const sort = query.sort === 'name' ? 'name' : query.sort === 'type' ? 'type' : 'code';
      const [rows, total] = await Promise.all([prisma.booksAccount.findMany({ where, orderBy: [{ [sort]: direction }, { id: 'asc' }], skip, take }), prisma.booksAccount.count({ where })]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
    case 'periods': {
      const statusFilter = query.status ?? (q && ['OPEN', 'CLOSED'].includes(q.toUpperCase()) ? q.toUpperCase() : undefined);
      const where: Prisma.BooksPeriodWhereInput = { ...(statusFilter ? { status: statusFilter as BooksPeriodStatus } : {}), ...(dates ? { startsOn: dates } : {}) };
      const [rows, total] = await Promise.all([prisma.booksPeriod.findMany({ where, orderBy: [{ startsOn: direction }, { id: 'asc' }], skip, take }), prisma.booksPeriod.count({ where })]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
    case 'bank-reconciliations': {
      const where: Prisma.BooksBankReconciliationWhereInput = { ...(query.status ? { status: query.status as BooksReconciliationStatus } : {}), ...(query.accountId ? { accountId: query.accountId } : {}), ...(dates ? { endsOn: dates } : {}), ...(q ? { account: { name: contains(q) } } : {}) };
      const [rows, total] = await Promise.all([prisma.booksBankReconciliation.findMany({ where, include: { account: true }, orderBy: [{ endsOn: direction }, { id: 'asc' }], skip, take }), prisma.booksBankReconciliation.count({ where })]);
      return { rows, pagination: booksListPagination(query.page, take, total) };
    }
  }
}

