import { JharkhandDistrict, Prisma, UserRole } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { pagination } from '../utils/pagination.js';
import { adminAccess } from './admin.service.js';

/**
 * Customer directory for order support.
 *
 * Gated on `orders:manage`: OPERATIONS already reads customer name, mobile and
 * email through /admin/orders and /admin/abandoned-carts, so this exposes no
 * new class of data to them. It is deliberately NOT under `analytics:read`,
 * which would newly hand personal data to FINANCE and MARKETING.
 */
const VIEW_PERMISSION = 'orders:manage' as const;

/**
 * The only User projection this module returns. passwordHash, auth sessions and
 * reset tokens are never selected, so they cannot leak through a later edit.
 */
const customerSelect = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const SORT_FIELDS = ['createdAt', 'name', 'orderCount'] as const;
type SortField = (typeof SORT_FIELDS)[number];

export interface CustomerQuery {
  page?: unknown;
  pageSize?: unknown;
  q?: unknown;
  district?: unknown;
  active?: unknown;
  sort?: unknown;
  direction?: unknown;
}

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Full numbers are detail-only; the list is the wider-access surface. */
const maskMobile = (mobile: string) => mobile.replace(/.(?=.{4})/g, '•');

function buildWhere(query: CustomerQuery): Prisma.UserWhereInput {
  const search = asText(query.q);
  const districtText = asText(query.district).toUpperCase();
  const district = (Object.values(JharkhandDistrict) as string[]).includes(districtText)
    ? (districtText as JharkhandDistrict)
    : undefined;
  const active = asText(query.active);

  return {
    role: UserRole.CUSTOMER,
    ...(active === 'true' ? { isActive: true } : {}),
    ...(active === 'false' ? { isActive: false } : {}),
    // District comes from where the customer actually had orders delivered.
    ...(district ? { orders: { some: { district } } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search } },
          ],
        }
      : {}),
  };
}

export async function customers(userId: string, query: CustomerQuery = {}) {
  await adminAccess(userId, VIEW_PERMISSION);

  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const where = buildWhere(query);

  const requested = asText(query.sort) as SortField;
  const sort: SortField = SORT_FIELDS.includes(requested) ? requested : 'createdAt';
  const direction: Prisma.SortOrder = asText(query.direction).toLowerCase() === 'asc' ? 'asc' : 'desc';
  // Prisma can order by a relation count but not by a summed relation field, so
  // totalSpent and lastOrderAt are display-only for now — see the response's
  // `sortableFields`.
  const orderBy: Prisma.UserOrderByWithRelationInput =
    sort === 'orderCount' ? { orders: { _count: direction } } : { [sort]: direction };

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take,
      select: { ...customerSelect, _count: { select: { orders: true, wishlist: true } } },
    }),
    prisma.user.count({ where }),
  ]);

  const ids = rows.map((row) => row.id);
  const [spend, defaultAddresses] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({
          by: ['customerId'],
          where: { customerId: { in: ids } },
          _sum: { totalPayable: true },
          _max: { createdAt: true },
        }),
        prisma.address.findMany({
          where: { userId: { in: ids }, isDefault: true },
          select: { userId: true, district: true },
        }),
      ])
    : [[], []];

  const spendByCustomer = new Map(spend.map((group) => [group.customerId, group]));
  const districtByCustomer = new Map(defaultAddresses.map((address) => [address.userId, address.district]));

  return {
    items: rows.map((row) => {
      const totals = spendByCustomer.get(row.id);
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        mobile: maskMobile(row.mobile),
        isActive: row.isActive,
        createdAt: row.createdAt,
        district: districtByCustomer.get(row.id) ?? null,
        orderCount: row._count.orders,
        wishlistCount: row._count.wishlist,
        totalSpent: totals?._sum.totalPayable ?? new Prisma.Decimal(0),
        lastOrderAt: totals?._max.createdAt ?? null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort,
    direction,
    /** Tells the UI which columns may offer a sort control. */
    sortableFields: SORT_FIELDS,
  };
}

export async function customer(userId: string, id: string) {
  await adminAccess(userId, VIEW_PERMISSION);

  const record = await prisma.user.findFirst({
    where: { id, role: UserRole.CUSTOMER },
    select: {
      ...customerSelect,
      addresses: {
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          label: true,
          fullName: true,
          mobile: true,
          line1: true,
          line2: true,
          landmark: true,
          district: true,
          state: true,
          postalCode: true,
          isDefault: true,
        },
      },
      orders: {
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          totalPayable: true,
          paymentStatus: true,
          district: true,
          couponCode: true,
          createdAt: true,
          vendorOrders: { select: { id: true, status: true } },
          paymentIntents: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, method: true },
          },
        },
      },
      couponUses: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          discountAmount: true,
          createdAt: true,
          coupon: { select: { code: true } },
          order: { select: { id: true, orderNumber: true } },
        },
      },
      _count: { select: { orders: true, wishlist: true, addresses: true } },
    },
  });

  if (!record) throw new ApiError(404, 'Customer was not found.', 'CUSTOMER_NOT_FOUND');

  const [lifetime, openCart] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId: id },
      _sum: { totalPayable: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      _count: { _all: true },
    }),
    prisma.cart.findFirst({
      where: { customerId: id, abandonmentStatus: { in: ['ACTIVE', 'ABANDONED', 'REMINDER_SENT'] } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        abandonmentStatus: true,
        abandonedAt: true,
        lastReminderAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            quantity: true,
            variant: {
              select: {
                id: true,
                label: true,
                price: true,
                product: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const orderCount = lifetime._count._all;
  const totalSpent = lifetime._sum.totalPayable ?? new Prisma.Decimal(0);

  return {
    customer: {
      id: record.id,
      name: record.name,
      email: record.email,
      mobile: record.mobile,
      isActive: record.isActive,
      createdAt: record.createdAt,
    },
    addresses: record.addresses,
    orders: record.orders,
    couponRedemptions: record.couponUses,
    openCart,
    counts: record._count,
    lifetime: {
      orderCount,
      totalSpent,
      averageOrderValue: orderCount ? totalSpent.div(orderCount) : new Prisma.Decimal(0),
      firstOrderAt: lifetime._min.createdAt,
      lastOrderAt: lifetime._max.createdAt,
    },
  };
}

/**
 * Support action: revoke every live session for a customer.
 *
 * Wraps the same AuthSession update the self-service `revokeAll` performs. It
 * changes no money and no order state, and is written to AdminAuditLog.
 */
export async function revokeCustomerSessions(
  userId: string,
  requestId: string | undefined,
  id: string,
) {
  await adminAccess(userId, VIEW_PERMISSION);

  const target = await prisma.user.findFirst({
    where: { id, role: UserRole.CUSTOMER },
    select: { id: true },
  });
  if (!target) throw new ApiError(404, 'Customer was not found.', 'CUSTOMER_NOT_FOUND');

  const result = await prisma.authSession.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await prisma.adminAuditLog.create({
    data: {
      actorId: userId,
      action: 'CUSTOMER_SESSIONS_REVOKED',
      entityType: 'User',
      entityId: id,
      requestId: requestId ?? null,
      permission: VIEW_PERMISSION,
      metadata: { revoked: result.count },
    },
  });

  return { revoked: result.count };
}
