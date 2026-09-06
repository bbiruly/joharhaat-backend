import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Guards the scale property rather than the arithmetic — the numbers are
 * verified against the previous implementation by a live comparison, but
 * nothing stops someone reintroducing an unbounded read later.
 *
 * The rule: admin dashboard analytics must never pull a row per order into the
 * API process. Response size should track the number of months and districts,
 * not the size of the orders table.
 */
/**
 * Comments are stripped before every check — these files document what the old
 * unbounded implementation did, and a doc comment describing `findMany` must
 * not read as a call to it.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const analyticsSource = stripComments(readFileSync('src/services/admin-analytics.service.ts', 'utf8'));
const adminSource = stripComments(readFileSync('src/services/admin.service.ts', 'utf8'));

describe('dashboard analytics stay aggregated in the database', () => {
  it('the analytics module never calls findMany', () => {
    expect(analyticsSource).not.toContain('findMany');
  });

  it('every aggregate is scoped to a time window', () => {
    // Each raw query must filter on created_at, or it would scan the whole table.
    const queries = analyticsSource.split('Prisma.sql`').slice(1);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      const body = query.slice(0, query.indexOf('`'));
      expect(body, 'a raw analytics query has no time filter').toMatch(/created_at >=/);
    }
  });

  it('overview and analytics no longer load orders into memory', () => {
    const overview = adminSource.slice(
      adminSource.indexOf('export async function overview'),
      adminSource.indexOf('export async function adminOrders'),
    );
    expect(overview).not.toContain('prisma.order.findMany');
    expect(overview).toContain('orderTotals');
    expect(overview).toContain('consignmentTotals');

    const analytics = adminSource.slice(adminSource.indexOf('export async function analytics(userId'));
    const body = analytics.slice(0, analytics.indexOf('\n}'));
    expect(body).not.toContain('prisma.order.findMany');
    expect(body).not.toContain('prisma.cart.findMany');
    expect(body).toContain('monthlySeries');
  });

  it('does not report a customer acquisition cost it cannot compute', () => {
    // It used to divide a hardcoded 25,000 of "marketing spend" by the new
    // customer count. There is no spend anywhere in the schema.
    expect(adminSource).not.toContain('customerAcquisitionCost');
    expect(adminSource).not.toContain('25000');
  });
});
