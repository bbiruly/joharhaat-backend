import { describe, expect, it } from 'vitest';
import { booksListPagination, booksListRequestSchema } from './books-listing-rules.js';

const request = (resource: string, query: Record<string, string> = {}) => booksListRequestSchema.safeParse({ params: { resource }, query });

describe('Books list query rules', () => {
  it('uses stable page defaults and accepts supported page sizes', () => {
    expect(request('entries').success).toBe(true);
    expect(request('entries', { page: '2', pageSize: '50' }).success).toBe(true);
    expect(request('entries', { pageSize: '30' }).success).toBe(false);
    expect(request('unknown').success).toBe(false);
  });

  it('rejects resource-inappropriate filters and sorts', () => {
    expect(request('entries', { status: 'POSTED', sort: 'occurredAt' }).success).toBe(true);
    expect(request('entries', { status: 'OPEN' }).success).toBe(false);
    expect(request('accounts', { type: 'EXPENSE', sort: 'code' }).success).toBe(true);
    expect(request('accounts', { type: 'SALE' }).success).toBe(false);
    expect(request('parties', { sort: 'email' }).success).toBe(false);
  });

  it('rejects invalid date ranges and caps search length', () => {
    expect(request('stock-movements', { from: '2026-05-02', to: '2026-05-01' }).success).toBe(false);
    expect(request('entries', { from: 'not-a-date' }).success).toBe(false);
    expect(request('entries', { q: 'x'.repeat(121) }).success).toBe(false);
  });

  it('returns pagination metadata for large and empty result sets', () => {
    expect(booksListPagination(3, 25, 61)).toEqual({ page: 3, pageSize: 25, total: 61, totalPages: 3 });
    expect(booksListPagination(1, 25, 0)).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  });

});
