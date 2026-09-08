import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { pagination } from '../utils/pagination.js';
import { writeAudit } from '../utils/audit-log.js';
import { adminAccess } from './admin.service.js';

/**
 * Coupon administration.
 *
 * `Coupon` and `CouponRedemption` have been in the schema since the beginning
 * and checkout has always redeemed a code — `resolveCoupon` in
 * checkout.service checks the window, the minimum order value, the global
 * usage limit and the per-user limit. What never existed was any way to create
 * one. The feature was half-built in the customer's favour: they could redeem
 * codes nobody could issue.
 *
 * Gated on `marketing:manage`, the permission that already covers the growth
 * surfaces (cart recovery).
 */
const MANAGE_PERMISSION = 'marketing:manage' as const;

/**
 * `percent` is stored as a fraction — checkout computes `gmv.mul(percent)` —
 * but an operator types "10" for ten percent. The conversion lives here so no
 * caller has to remember which side of it they are on, and so a UI bug cannot
 * write 1000% into the column.
 */
const MAX_PERCENT = 90;
const toFraction = (percent: number) => new Prisma.Decimal(percent).dividedBy(100);
const toPercent = (fraction: Prisma.Decimal) => fraction.mul(100).toNumber();

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export interface CouponInput {
  code: string;
  percent: number;
  maxDiscount: number;
  minOrderValue: number;
  startsAt: string;
  expiresAt: string;
  usageLimit: number | null;
  perUserLimit: number;
  isActive: boolean;
}

/**
 * Validates a coupon as a whole rather than field by field.
 *
 * Pure, so the rules are unit-testable without a database. Every one of these
 * would otherwise produce a coupon that checkout silently refuses — the
 * operator would create it, see it listed as active, and never learn why no
 * customer could use it.
 */
export function assertCouponValid(input: CouponInput) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code))
    throw new ApiError(
      422,
      'Use 3–24 characters: letters, digits, hyphen or underscore.',
      'COUPON_CODE_INVALID',
    );

  if (!(input.percent > 0) || input.percent > MAX_PERCENT)
    throw new ApiError(
      422,
      `Discount must be between 1 and ${MAX_PERCENT} percent.`,
      'COUPON_PERCENT_INVALID',
    );

  if (!(input.maxDiscount > 0))
    throw new ApiError(422, 'Set a maximum discount above zero.', 'COUPON_CAP_INVALID');

  if (input.minOrderValue < 0)
    throw new ApiError(422, 'Minimum order value cannot be negative.', 'COUPON_MIN_INVALID');

  const startsAt = new Date(input.startsAt);
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()))
    throw new ApiError(422, 'Enter a valid start and end date.', 'COUPON_DATES_INVALID');
  if (expiresAt <= startsAt)
    throw new ApiError(422, 'The end date must be after the start date.', 'COUPON_DATES_INVALID');

  if (input.usageLimit !== null && (!Number.isInteger(input.usageLimit) || input.usageLimit < 1))
    throw new ApiError(
      422,
      'Total usage limit must be a whole number above zero, or left empty for unlimited.',
      'COUPON_LIMIT_INVALID',
    );

  if (!Number.isInteger(input.perUserLimit) || input.perUserLimit < 1)
    throw new ApiError(
      422,
      'Per-customer limit must be a whole number above zero.',
      'COUPON_LIMIT_INVALID',
    );

  return { code, startsAt, expiresAt };
}

/** Derived state, so the UI never has to recompute the checkout rules. */
export function couponState(coupon: {
  isActive: boolean;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  usedCount: number;
}) {
  if (!coupon.isActive) return 'DISABLED';
  const now = new Date();
  if (coupon.expiresAt <= now) return 'EXPIRED';
  if (coupon.startsAt > now) return 'SCHEDULED';
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return 'EXHAUSTED';
  return 'ACTIVE';
}

const shape = (coupon: {
  id: string;
  code: string;
  percent: Prisma.Decimal;
  maxDiscount: Prisma.Decimal;
  minOrderValue: Prisma.Decimal;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  perUserLimit: number;
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
  _count?: { redemptions: number };
}) => ({
  id: coupon.id,
  code: coupon.code,
  percent: toPercent(coupon.percent),
  maxDiscount: coupon.maxDiscount,
  minOrderValue: coupon.minOrderValue,
  startsAt: coupon.startsAt,
  expiresAt: coupon.expiresAt,
  usageLimit: coupon.usageLimit,
  perUserLimit: coupon.perUserLimit,
  usedCount: coupon.usedCount,
  isActive: coupon.isActive,
  createdAt: coupon.createdAt,
  redemptions: coupon._count?.redemptions ?? 0,
  state: couponState(coupon),
});

export async function coupons(
  userId: string,
  query: { page?: unknown; pageSize?: unknown; q?: unknown; state?: unknown } = {},
) {
  await adminAccess(userId, MANAGE_PERMISSION);

  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const search = asText(query.q).toUpperCase();
  const where: Prisma.CouponWhereInput = search ? { code: { contains: search } } : {};

  const [rows, total] = await prisma.$transaction([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { _count: { select: { redemptions: true } } },
    }),
    prisma.coupon.count({ where }),
  ]);

  const items = rows.map(shape);
  const state = asText(query.state).toUpperCase();
  // State is derived, not a column, so it filters after shaping. The page
  // count still reflects the unfiltered query, which the UI shows honestly.
  const visible = state ? items.filter((item) => item.state === state) : items;

  return {
    items: visible,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function createCoupon(userId: string, requestId: string | undefined, input: CouponInput) {
  await adminAccess(userId, MANAGE_PERMISSION);
  const { code, startsAt, expiresAt } = assertCouponValid(input);

  const existing = await prisma.coupon.findUnique({ where: { code }, select: { id: true } });
  if (existing)
    throw new ApiError(409, 'A coupon with that code already exists.', 'COUPON_CODE_TAKEN');

  const created = await prisma.coupon.create({
    data: {
      code,
      percent: toFraction(input.percent),
      maxDiscount: new Prisma.Decimal(input.maxDiscount),
      minOrderValue: new Prisma.Decimal(input.minOrderValue),
      startsAt,
      expiresAt,
      usageLimit: input.usageLimit,
      perUserLimit: input.perUserLimit,
      isActive: input.isActive,
    },
    include: { _count: { select: { redemptions: true } } },
  });

  await writeAudit(prisma, {
    event: 'COUPON_CREATED',
    actorId: userId,
    entityType: 'Coupon',
    entityId: created.id,
    requestId,
    permission: MANAGE_PERMISSION,
    nextState: { code, percent: input.percent, maxDiscount: input.maxDiscount, isActive: input.isActive },
  });

  return shape(created);
}

export async function updateCoupon(
  userId: string,
  id: string,
  requestId: string | undefined,
  input: CouponInput,
) {
  await adminAccess(userId, MANAGE_PERMISSION);
  const { code, startsAt, expiresAt } = assertCouponValid(input);

  const current = await prisma.coupon.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, 'Coupon was not found.', 'COUPON_NOT_FOUND');

  if (code !== current.code) {
    const clash = await prisma.coupon.findUnique({ where: { code }, select: { id: true } });
    if (clash)
      throw new ApiError(409, 'A coupon with that code already exists.', 'COUPON_CODE_TAKEN');
  }

  // usedCount is checkout's counter, never the operator's. Lowering the total
  // limit below what has already been redeemed would leave a coupon that reads
  // as available and is refused at checkout.
  if (input.usageLimit !== null && input.usageLimit < current.usedCount)
    throw new ApiError(
      422,
      `This coupon has already been used ${current.usedCount} times, so the limit cannot be lower.`,
      'COUPON_LIMIT_BELOW_USAGE',
    );

  const updated = await prisma.coupon.update({
    where: { id },
    data: {
      code,
      percent: toFraction(input.percent),
      maxDiscount: new Prisma.Decimal(input.maxDiscount),
      minOrderValue: new Prisma.Decimal(input.minOrderValue),
      startsAt,
      expiresAt,
      usageLimit: input.usageLimit,
      perUserLimit: input.perUserLimit,
      isActive: input.isActive,
    },
    include: { _count: { select: { redemptions: true } } },
  });

  await writeAudit(prisma, {
    event: 'COUPON_UPDATED',
    actorId: userId,
    entityType: 'Coupon',
    entityId: id,
    requestId,
    permission: MANAGE_PERMISSION,
    previousState: {
      code: current.code,
      percent: toPercent(current.percent),
      maxDiscount: current.maxDiscount.toString(),
      isActive: current.isActive,
    },
    nextState: {
      code,
      percent: input.percent,
      maxDiscount: input.maxDiscount,
      isActive: input.isActive,
    },
  });

  return shape(updated);
}

export async function deleteCoupon(userId: string, id: string, requestId?: string) {
  await adminAccess(userId, MANAGE_PERMISSION);

  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { _count: { select: { redemptions: true } } },
  });
  if (!coupon) throw new ApiError(404, 'Coupon was not found.', 'COUPON_NOT_FOUND');

  // CouponRedemption.couponId is onDelete: Restrict, and rightly so — a
  // redemption is part of an order's financial record. Deleting the coupon
  // would either fail at the database or orphan that history, so a used coupon
  // is disabled instead and the operator is told which one applies.
  if (coupon._count.redemptions > 0)
    throw new ApiError(
      422,
      `This coupon has been redeemed ${coupon._count.redemptions} times and is part of those orders. Disable it instead — that stops new redemptions and keeps the record.`,
      'COUPON_HAS_REDEMPTIONS',
    );

  await prisma.coupon.delete({ where: { id } });

  await writeAudit(prisma, {
    event: 'COUPON_DELETED',
    actorId: userId,
    entityType: 'Coupon',
    entityId: id,
    requestId,
    permission: MANAGE_PERMISSION,
    previousState: { code: coupon.code, percent: toPercent(coupon.percent) },
  });

  return { deleted: true };
}
