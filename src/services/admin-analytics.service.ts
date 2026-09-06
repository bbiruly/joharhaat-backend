import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';

/**
 * Order analytics computed in the database rather than in Node.
 *
 * The previous implementation loaded every order in the window —
 * `findMany({ where: { createdAt: { gte: since } }, include: { vendorOrders: {
 * include: { vendor: true } } } })` — and reduced it in JavaScript. That is
 * O(orders) rows over the wire and O(orders) memory in the API process, so at
 * a lakh orders a day a twelve-month dashboard would try to materialise tens of
 * millions of rows and take the process down.
 *
 * Every function here returns at most one row per month or per district, so the
 * cost of a dashboard is bounded by the size of the answer, not the size of the
 * table. Sums stay in Postgres numeric and are cast to text so the JSON wire
 * format matches what Prisma.Decimal used to produce.
 */

const asMoney = (value: string | null) => new Prisma.Decimal(value ?? '0');

export interface MonthlyPoint {
  month: string;
  gmv: Prisma.Decimal;
  revenue: Prisma.Decimal;
  orders: number;
}

/**
 * GMV and order count per calendar month.
 *
 * Kept separate from the commission query on purpose: an order has many vendor
 * orders, so joining them and summing `orders.gmv` in the same pass would
 * multiply GMV by the number of vendors on each order.
 */
export async function monthlySeries(since: Date): Promise<MonthlyPoint[]> {
  const [orderRows, commissionRows] = await Promise.all([
    prisma.$queryRaw<{ month: string; gmv: string | null; orders: bigint }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
             SUM(gmv)::text AS gmv,
             COUNT(*) AS orders
      FROM orders
      WHERE created_at >= ${since}
      GROUP BY 1
      ORDER BY 1
    `),
    prisma.$queryRaw<{ month: string; revenue: string | null }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', o.created_at), 'YYYY-MM') AS month,
             SUM(vo.admin_commission)::text AS revenue
      FROM vendor_orders vo
      JOIN orders o ON o.id = vo.order_id
      WHERE o.created_at >= ${since}
      GROUP BY 1
    `),
  ]);

  const revenueByMonth = new Map(commissionRows.map((row) => [row.month, row.revenue]));
  return orderRows.map((row) => ({
    month: row.month,
    gmv: asMoney(row.gmv),
    revenue: asMoney(revenueByMonth.get(row.month) ?? '0'),
    orders: Number(row.orders),
  }));
}

export interface HaatPoint {
  name: string;
  district: string;
  gmv: Prisma.Decimal;
  orders: number;
}

/** Consignment value and count per vendor district. */
export async function haatPerformance(since: Date): Promise<HaatPoint[]> {
  const rows = await prisma.$queryRaw<
    { district: string; gmv: string | null; orders: bigint }[]
  >(Prisma.sql`
    SELECT v.district::text AS district,
           SUM(vo.gmv)::text AS gmv,
           COUNT(*) AS orders
    FROM vendor_orders vo
    JOIN vendors v ON v.id = vo.vendor_id
    JOIN orders o ON o.id = vo.order_id
    WHERE o.created_at >= ${since}
    GROUP BY v.district
    ORDER BY 2 DESC
  `);
  return rows.map((row) => ({
    name: `${row.district.replaceAll('_', ' ')} Haat`,
    district: row.district,
    gmv: asMoney(row.gmv),
    orders: Number(row.orders),
  }));
}

export interface OrderTotals {
  gmv: Prisma.Decimal;
  orders: number;
  averageOrderValue: Prisma.Decimal;
  failedPayments: number;
}

/** Order-side totals for a window, in one pass. */
export async function orderTotals(since: Date): Promise<OrderTotals> {
  const [row] = await prisma.$queryRaw<
    { gmv: string | null; orders: bigint; failed: bigint }[]
  >(Prisma.sql`
    SELECT SUM(gmv)::text AS gmv,
           COUNT(*) AS orders,
           COUNT(*) FILTER (WHERE payment_status = 'FAILED') AS failed
    FROM orders
    WHERE created_at >= ${since}
  `);
  const orders = Number(row?.orders ?? 0);
  const gmv = asMoney(row?.gmv ?? null);
  return {
    gmv,
    orders,
    averageOrderValue: orders ? gmv.div(orders) : new Prisma.Decimal(0),
    failedPayments: Number(row?.failed ?? 0),
  };
}

export interface ConsignmentTotals {
  commission: Prisma.Decimal;
  payoutLiability: Prisma.Decimal;
  total: number;
  delivered: number;
  rto: number;
  delayed: number;
  deliverySuccessRate: number;
}

/**
 * Consignment-side totals for a window.
 *
 * `delayed` is a consignment still PENDING more than a day after it was
 * created — the same definition the dashboard's attention counter used, moved
 * into SQL so it no longer needs every row in memory to compute.
 */
export async function consignmentTotals(
  since: Date,
  now: Date,
): Promise<ConsignmentTotals> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [row] = await prisma.$queryRaw<
    {
      commission: string | null;
      liability: string | null;
      total: bigint;
      delivered: bigint;
      rto: bigint;
      delayed: bigint;
    }[]
  >(Prisma.sql`
    SELECT SUM(vo.admin_commission)::text AS commission,
           SUM(vo.net_vendor_payout) FILTER (WHERE vo.payout_status <> 'RELEASED')::text AS liability,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE vo.status = 'DELIVERED') AS delivered,
           COUNT(*) FILTER (WHERE vo.status = 'RTO') AS rto,
           COUNT(*) FILTER (WHERE vo.status = 'PENDING' AND vo.created_at < ${dayAgo}) AS delayed
    FROM vendor_orders vo
    JOIN orders o ON o.id = vo.order_id
    WHERE o.created_at >= ${since}
  `);
  const total = Number(row?.total ?? 0);
  const delivered = Number(row?.delivered ?? 0);
  return {
    commission: asMoney(row?.commission ?? null),
    payoutLiability: asMoney(row?.liability ?? null),
    total,
    delivered,
    rto: Number(row?.rto ?? 0),
    delayed: Number(row?.delayed ?? 0),
    deliverySuccessRate: total ? (delivered / total) * 100 : 0,
  };
}

/**
 * Share of carts in the window that were abandoned.
 *
 * Counted in the database — the previous version pulled every cart row back
 * just to measure the length of two arrays.
 */
export async function cartAbandonmentRate(since: Date): Promise<number> {
  const [row] = await prisma.$queryRaw<{ total: bigint; abandoned: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE abandonment_status IN ('ABANDONED', 'REMINDER_SENT')) AS abandoned
    FROM carts
    WHERE created_at >= ${since}
  `);
  const total = Number(row?.total ?? 0);
  return total ? (Number(row?.abandoned ?? 0) / total) * 100 : 0;
}
