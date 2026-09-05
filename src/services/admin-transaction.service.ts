import { PaymentIntentStatus, PaymentMethod, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { pagination } from '../utils/pagination.js';
import { adminAccessAny, type AdminPermission } from './admin.service.js';

/**
 * Read-only customer payment views.
 *
 * A "transaction" here is a PaymentIntent. The schema creates one intent per
 * attempt (each with its own idempotencyKey), so a retried payment appears as
 * several intents against a single Order, and `Order.paymentStatus` is the
 * rolled-up result. Each status transition writes a PaymentEvent, which forms
 * the per-attempt timeline.
 *
 * WalletLedger is deliberately NOT part of this — that is vendor payout and
 * escrow money, already served by /admin/payouts.
 */

/** FINANCE reconciles payments; OPERATIONS answers "my payment failed" tickets. */
const VIEW_PERMISSIONS: AdminPermission[] = ['payouts:manage', 'orders:manage'];

const SORT_FIELDS = ['createdAt', 'amount', 'status'] as const;
type SortField = (typeof SORT_FIELDS)[number];

export interface TransactionQuery {
  page?: unknown;
  pageSize?: unknown;
  q?: unknown;
  status?: unknown;
  method?: unknown;
  from?: unknown;
  to?: unknown;
  sort?: unknown;
  direction?: unknown;
}

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const asEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => {
  const candidate = asText(value).toUpperCase() as T;
  return allowed.includes(candidate) ? candidate : undefined;
};

const asDate = (value: unknown) => {
  const text = asText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

function buildWhere(query: TransactionQuery): Prisma.PaymentIntentWhereInput {
  const search = asText(query.q);
  const status = asEnum(query.status, Object.values(PaymentIntentStatus));
  const method = asEnum(query.method, Object.values(PaymentMethod));
  const from = asDate(query.from);
  const to = asDate(query.to);

  return {
    ...(status ? { status } : {}),
    ...(method ? { method } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    // providerRef is searchable for reconciliation but never returned in the list.
    ...(search
      ? {
          OR: [
            { providerRef: { contains: search, mode: 'insensitive' } },
            { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
            { order: { customer: { name: { contains: search, mode: 'insensitive' } } } },
            { order: { customer: { mobile: { contains: search } } } },
          ],
        }
      : {}),
  };
}

function buildSort(query: TransactionQuery) {
  const requested = asText(query.sort) as SortField;
  const sort: SortField = SORT_FIELDS.includes(requested) ? requested : 'createdAt';
  const direction: Prisma.SortOrder = asText(query.direction).toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { sort, direction };
}

/**
 * PaymentEvent.payload is provider-controlled JSON. Only a known-safe scalar is
 * surfaced; the raw object never reaches the browser.
 */
function eventSource(payload: Prisma.JsonValue): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const source = (payload as Record<string, unknown>).source;
    if (typeof source === 'string') return source;
  }
  return null;
}

export async function transactions(userId: string, query: TransactionQuery = {}) {
  await adminAccessAny(userId, VIEW_PERMISSIONS);

  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const where = buildWhere(query);
  const { sort, direction } = buildSort(query);

  const [rows, total] = await prisma.$transaction([
    prisma.paymentIntent.findMany({
      where,
      skip,
      take,
      orderBy: { [sort]: direction },
      select: {
        id: true,
        orderId: true,
        method: true,
        status: true,
        amount: true,
        failureCode: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { events: true } },
        order: {
          select: {
            orderNumber: true,
            paymentStatus: true,
            totalPayable: true,
            district: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.paymentIntent.count({ where }),
  ]);

  // Kept outside the $transaction array: groupBy loses its result typing when
  // batched, and it needs an explicit orderBy.
  const summary = await prisma.paymentIntent.groupBy({
    by: ['status'],
    where,
    orderBy: { status: 'asc' },
    _count: { _all: true },
    _sum: { amount: true },
  });

  // Attempt ordinals need every sibling intent on the page's orders, not just
  // the rows in the page — attempt 3 of 4 must still read as "3 of 4".
  const orderIds = [...new Set(rows.map((row) => row.orderId))];
  const siblings = orderIds.length
    ? await prisma.paymentIntent.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, orderId: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const attemptNumbers = new Map<string, number>();
  const attemptTotals = new Map<string, number>();
  for (const sibling of siblings) {
    const next = (attemptTotals.get(sibling.orderId) ?? 0) + 1;
    attemptTotals.set(sibling.orderId, next);
    attemptNumbers.set(sibling.id, next);
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.order.orderNumber,
      orderPaymentStatus: row.order.paymentStatus,
      orderTotal: row.order.totalPayable,
      district: row.order.district,
      customer: row.order.customer,
      method: row.method,
      status: row.status,
      amount: row.amount,
      failureCode: row.failureCode,
      attemptNumber: attemptNumbers.get(row.id) ?? 1,
      totalAttempts: attemptTotals.get(row.orderId) ?? 1,
      eventCount: row._count.events,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort,
    direction,
    /** Status breakdown for the current filter, not the whole table. */
    summary: summary.map((group) => ({
      status: group.status,
      count: group._count._all,
      amount: group._sum.amount ?? new Prisma.Decimal(0),
    })),
  };
}

export async function transaction(userId: string, id: string) {
  await adminAccessAny(userId, VIEW_PERMISSIONS);

  const intent = await prisma.paymentIntent.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      method: true,
      status: true,
      amount: true,
      failureCode: true,
      providerRef: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          gmv: true,
          discount: true,
          cgst: true,
          sgst: true,
          courierCharge: true,
          totalPayable: true,
          paymentStatus: true,
          couponCode: true,
          district: true,
          recipientName: true,
          createdAt: true,
          customer: { select: { id: true, name: true, email: true, mobile: true } },
          vendorOrders: {
            select: {
              id: true,
              status: true,
              payoutStatus: true,
              vendor: { select: { businessName: true } },
            },
          },
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, payload: true, createdAt: true },
      },
      reservations: {
        select: {
          id: true,
          status: true,
          quantity: true,
          expiresAt: true,
          createdAt: true,
          variant: {
            select: {
              id: true,
              sku: true,
              label: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!intent) throw new ApiError(404, 'Payment attempt was not found.', 'TRANSACTION_NOT_FOUND');

  const attempts = await prisma.paymentIntent.findMany({
    where: { orderId: intent.orderId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, method: true, amount: true, failureCode: true, createdAt: true },
  });

  return {
    intent: {
      id: intent.id,
      orderId: intent.orderId,
      method: intent.method,
      status: intent.status,
      amount: intent.amount,
      failureCode: intent.failureCode,
      providerRef: intent.providerRef,
      expiresAt: intent.expiresAt,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
    order: intent.order,
    events: intent.events.map((event) => ({
      id: event.id,
      status: event.status,
      source: eventSource(event.payload),
      createdAt: event.createdAt,
    })),
    reservations: intent.reservations,
    attempts: attempts.map((attempt, index) => ({
      ...attempt,
      attemptNumber: index + 1,
      isCurrent: attempt.id === intent.id,
    })),
  };
}
