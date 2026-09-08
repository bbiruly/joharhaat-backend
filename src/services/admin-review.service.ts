import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { pagination } from '../utils/pagination.js';
import { writeAudit } from '../utils/audit-log.js';
import { adminAccess } from './admin.service.js';

/**
 * Review moderation.
 *
 * Reviews publish immediately — a pre-approval queue does not survive lakhs of
 * orders a day, and it delays the honest majority to catch the rare abuse. What
 * makes that safe is this: any signed-in customer can report a review, the
 * report count surfaces it here, and a moderator hides it.
 *
 * Hiding never deletes. The row stays with the reason and the moderator on it,
 * so a decision can be reviewed later and a product's average changes for a
 * recorded reason rather than silently.
 */
const MODERATE_PERMISSION = 'moderation:manage' as const;

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const adminSelect = {
  id: true,
  rating: true,
  body: true,
  isHidden: true,
  hiddenReason: true,
  hiddenAt: true,
  reportCount: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  product: { select: { id: true, name: true, slug: true } },
  hiddenBy: { select: { id: true, name: true } },
  media: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, altText: true } },
  reports: {
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      reporter: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ReviewSelect;

export async function reviews(
  userId: string,
  query: { page?: unknown; pageSize?: unknown; status?: unknown; q?: unknown } = {},
) {
  await adminAccess(userId, MODERATE_PERMISSION);

  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const status = asText(query.status).toLowerCase();
  const search = asText(query.q);

  const where: Prisma.ReviewWhereInput = {
    ...(status === 'reported' ? { reportCount: { gt: 0 }, isHidden: false } : {}),
    ...(status === 'hidden' ? { isHidden: true } : {}),
    ...(status === 'visible' ? { isHidden: false } : {}),
    ...(search
      ? {
          OR: [
            { body: { contains: search, mode: 'insensitive' } },
            { product: { name: { contains: search, mode: 'insensitive' } } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      // Most-reported first: the queue should open on what needs a decision.
      orderBy: [{ reportCount: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      select: adminSelect,
    }),
    prisma.review.count({ where }),
  ]);

  return {
    items: rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Counts for the queue tabs, so a moderator sees the workload at a glance. */
export async function reviewCounts(userId: string) {
  await adminAccess(userId, MODERATE_PERMISSION);
  const [reported, hidden, visible] = await Promise.all([
    prisma.review.count({ where: { reportCount: { gt: 0 }, isHidden: false } }),
    prisma.review.count({ where: { isHidden: true } }),
    prisma.review.count({ where: { isHidden: false } }),
  ]);
  return { reported, hidden, visible };
}

export async function setReviewHidden(
  userId: string,
  id: string,
  hidden: boolean,
  reason: string | undefined,
  requestId?: string,
) {
  await adminAccess(userId, MODERATE_PERMISSION);

  const review = await prisma.review.findUnique({
    where: { id },
    select: { id: true, isHidden: true, rating: true, productId: true, reportCount: true },
  });
  if (!review) throw new ApiError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');

  const note = reason?.trim() ?? '';
  // A hidden review changes a public rating. The reason is what makes that
  // decision reviewable later, so it is required rather than optional.
  if (hidden && note.length < 5)
    throw new ApiError(
      422,
      'Give a reason before hiding a review — it is recorded against the decision.',
      'REASON_REQUIRED',
    );

  const updated = await prisma.review.update({
    where: { id },
    data: hidden
      ? { isHidden: true, hiddenReason: note, hiddenById: userId, hiddenAt: new Date() }
      : { isHidden: false, hiddenReason: null, hiddenById: null, hiddenAt: null },
    select: adminSelect,
  });

  await writeAudit(prisma, {
    event: hidden ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
    actorId: userId,
    entityType: 'Review',
    entityId: id,
    requestId,
    permission: MODERATE_PERMISSION,
    previousState: { isHidden: review.isHidden, reportCount: review.reportCount },
    nextState: { isHidden: hidden, reason: hidden ? note : null },
  });

  return updated;
}

/**
 * Clears the reports on a review the moderator has judged acceptable, so it
 * leaves the queue without being hidden. The reports themselves are deleted —
 * they exist only to raise the flag, and keeping them would keep re-raising it.
 */
export async function dismissReports(userId: string, id: string, requestId?: string) {
  await adminAccess(userId, MODERATE_PERMISSION);

  const review = await prisma.review.findUnique({
    where: { id },
    select: { id: true, reportCount: true },
  });
  if (!review) throw new ApiError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');

  await prisma.$transaction([
    prisma.reviewReport.deleteMany({ where: { reviewId: id } }),
    prisma.review.update({ where: { id }, data: { reportCount: 0 } }),
  ]);

  await writeAudit(prisma, {
    event: 'REVIEW_REPORTS_DISMISSED',
    actorId: userId,
    entityType: 'Review',
    entityId: id,
    requestId,
    permission: MODERATE_PERMISSION,
    previousState: { reportCount: review.reportCount },
    nextState: { reportCount: 0 },
  });

  return { dismissed: true };
}
