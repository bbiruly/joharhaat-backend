import { z } from 'zod';

export const booksListResources = ['entries', 'stock-items', 'stock-movements', 'parties', 'accounts', 'periods', 'bank-reconciliations'] as const;
export type BooksListResource = typeof booksListResources[number];
export function booksListPagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const booksListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), 'Choose 25, 50 or 100 rows per page.').default(25),
  q: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(32).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
  status: z.string().trim().max(32).optional(),
  type: z.string().trim().max(32).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  accountId: z.string().trim().max(80).optional(),
  itemId: z.string().trim().max(80).optional(),
  active: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

const sortFields: Record<BooksListResource, string[]> = {
  entries: ['occurredAt', 'reference', 'memo', 'createdAt'],
  'stock-items': ['name', 'sku', 'type'],
  'stock-movements': ['movedAt', 'type'],
  parties: ['name', 'type'],
  accounts: ['code', 'name', 'type'],
  periods: ['startsOn'],
  'bank-reconciliations': ['endsOn'],
};
const statusValues: Partial<Record<BooksListResource, string[]>> = {
  entries: ['POSTED', 'REVERSED'],
  periods: ['OPEN', 'CLOSED'],
  'bank-reconciliations': ['RECONCILED', 'DISCREPANCY'],
};
const typeValues: Partial<Record<BooksListResource, string[]>> = {
  'stock-items': ['FINISHED_GOOD', 'RAW_MATERIAL', 'PACKAGING'],
  'stock-movements': ['PURCHASE', 'PRODUCTION', 'CONSUMPTION', 'SALE', 'RETURN', 'DAMAGE', 'SAMPLE', 'EXPIRY', 'ADJUSTMENT'],
  parties: ['SUPPLIER', 'CUSTOMER', 'MANUFACTURER', 'OTHER'],
  accounts: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'],
};

export const booksListParamsSchema = z.object({ resource: z.enum(booksListResources) });
export const booksListRequestSchema = z.object({ params: booksListParamsSchema, query: booksListQuerySchema }).superRefine(({ params, query }, context) => {
  const allowedSorts = sortFields[params.resource];
  if (query.sort && !allowedSorts.includes(query.sort)) context.addIssue({ code: 'custom', path: ['query', 'sort'], message: 'Sort field is not supported for this list.' });
  const allowedStatuses = statusValues[params.resource];
  if (query.status && (!allowedStatuses || !allowedStatuses.includes(query.status))) context.addIssue({ code: 'custom', path: ['query', 'status'], message: 'Status filter is not supported for this list.' });
  const allowedTypes = typeValues[params.resource];
  if (query.type && (!allowedTypes || !allowedTypes.includes(query.type))) context.addIssue({ code: 'custom', path: ['query', 'type'], message: 'Type filter is not supported for this list.' });
  if (query.from && query.to && query.from > query.to) context.addIssue({ code: 'custom', path: ['query', 'from'], message: 'The start date must be before the end date.' });
});

