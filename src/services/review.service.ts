import { FulfillmentStatus, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { pagination } from '../utils/pagination.js';

/**
 * Product reviews.
 *
 * Phase 5 deleted a hardcoded `rating: 4.9`, `reviews: 124` and three invented
 * "Verified buyer" testimonials from the storefront. This is the real thing,
 * and the rule that makes it real is `assertCanReview`: a review must be
 * attached to a DELIVERED order that actually contained the product. Nothing
 * else can create one, so "Verified buyer" is a fact about the row rather than
 * a label printed next to it.
 */
export const MIN_RATING = 1;
export const MAX_RATING = 5;
const MAX_BODY = 2000;
const MAX_PHOTOS = 5;

export interface ReviewInput {
  rating: number;
  body?: string | undefined;
  media?: { objectKey: string; url: string; altText: string }[] | undefined;
}

/** Pure shape rules, so they can be tested without a database or an order. */
export function assertReviewInput(input: ReviewInput) {
  if (!Number.isInteger(input.rating) || input.rating < MIN_RATING || input.rating > MAX_RATING)
    throw new ApiError(422, 'Choose a rating from 1 to 5 stars.', 'REVIEW_RATING_INVALID');

  const body = input.body?.trim() ?? '';
  if (body.length > MAX_BODY)
    throw new ApiError(422, `Keep the review under ${MAX_BODY} characters.`, 'REVIEW_BODY_TOO_LONG');

  const media = input.media ?? [];
  if (media.length > MAX_PHOTOS)
    throw new ApiError(422, `You can add up to ${MAX_PHOTOS} photos.`, 'REVIEW_TOO_MANY_PHOTOS');
  for (const item of media)
    if (!item.objectKey || !item.url)
      throw new ApiError(422, 'A photo failed to upload. Remove it and try again.', 'REVIEW_MEDIA_INVALID');

  return { body: body || null, media };
}

/**
 * The entitlement check: has this customer received this product on this order?
 *
 * Delivery is per vendor order, not per order, so a multi-vendor basket only
 * entitles a review for the parts that actually arrived.
 */
export async function assertCanReview(userId: string, productId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId },
    select: {
      id: true,
      vendorOrders: {
        select: {
          status: true,
          items: { select: { variant: { select: { productId: true } } } },
        },
      },
    },
  });
  if (!order)
    throw new ApiError(404, 'That order was not found on your account.', 'ORDER_NOT_FOUND');

  const delivered = order.vendorOrders.some(
    (vendorOrder) =>
      vendorOrder.status === FulfillmentStatus.DELIVERED &&
      vendorOrder.items.some((item) => item.variant.productId === productId),
  );
  if (!delivered)
    throw new ApiError(
      422,
      'You can review a product once it has been delivered to you.',
      'REVIEW_NOT_DELIVERED',
    );

  return order.id;
}

/** Averages exclude hidden rows, so hiding a review moves the score honestly. */
export async function ratingFor(productId: string) {
  const [aggregate, breakdown] = await Promise.all([
    prisma.review.aggregate({
      where: { productId, isHidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.review.groupBy({
      by: ['rating'],
      where: { productId, isHidden: false },
      _count: { _all: true },
    }),
  ]);

  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of breakdown) counts[row.rating] = row._count._all;

  return {
    // null, not 0, when nothing has been reviewed — a product with no reviews
    // has no rating, and showing 0 would read as a terrible one.
    average: aggregate._avg.rating === null ? null : Number(aggregate._avg.rating.toFixed(2)),
    count: aggregate._count._all,
    breakdown: counts,
  };
}

const publicSelect = {
  id: true,
  rating: true,
  body: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
  media: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, altText: true } },
} satisfies Prisma.ReviewSelect;

export async function listForProduct(
  productId: string,
  query: { page?: unknown; pageSize?: unknown; rating?: unknown } = {},
) {
  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const rating = Number(query.rating);
  const where: Prisma.ReviewWhereInput = {
    productId,
    isHidden: false,
    ...(Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING ? { rating } : {}),
  };

  const [rows, total, summary] = await Promise.all([
    prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select: publicSelect }),
    prisma.review.count({ where }),
    ratingFor(productId),
  ]);

  return {
    // Every row is a verified purchase by construction, so the flag is a fact
    // about how the row got here rather than something stored and trusted.
    items: rows.map((row) => ({ ...row, verifiedPurchase: true })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary,
  };
}

/** What the customer may still review, so the UI can offer it on an order. */
export async function reviewableProducts(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId },
    select: {
      vendorOrders: {
        where: { status: FulfillmentStatus.DELIVERED },
        select: {
          items: {
            select: {
              variant: {
                select: { product: { select: { id: true, name: true, slug: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!order) throw new ApiError(404, 'That order was not found on your account.', 'ORDER_NOT_FOUND');

  const delivered = new Map(
    order.vendorOrders
      .flatMap((vendorOrder) => vendorOrder.items)
      .map((item) => [item.variant.product.id, item.variant.product]),
  );

  const existing = await prisma.review.findMany({
    where: { userId, orderId, productId: { in: [...delivered.keys()] } },
    select: { productId: true, id: true, rating: true },
  });
  const reviewed = new Map(existing.map((row) => [row.productId, row]));

  return [...delivered.values()].map((product) => ({
    product,
    review: reviewed.get(product.id) ?? null,
  }));
}

export async function createReview(
  userId: string,
  productId: string,
  orderId: string,
  input: ReviewInput,
) {
  const { body, media } = assertReviewInput(input);
  await assertCanReview(userId, productId, orderId);

  const existing = await prisma.review.findUnique({
    where: { productId_userId_orderId: { productId, userId, orderId } },
    select: { id: true },
  });
  if (existing)
    throw new ApiError(
      409,
      'You have already reviewed this product for this order.',
      'REVIEW_ALREADY_EXISTS',
    );

  return prisma.review.create({
    data: {
      productId,
      userId,
      orderId,
      rating: input.rating,
      body,
      media: { create: media.map((item, index) => ({ ...item, sortOrder: index })) },
    },
    select: publicSelect,
  });
}

export async function updateReview(userId: string, id: string, input: ReviewInput) {
  const { body, media } = assertReviewInput(input);

  const review = await prisma.review.findFirst({
    where: { id, userId },
    select: { id: true, isHidden: true },
  });
  if (!review) throw new ApiError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
  // Letting the author edit a hidden review would be a way to launder it back
  // into view without a moderator ever seeing the new text.
  if (review.isHidden)
    throw new ApiError(
      422,
      'This review has been hidden by moderation and cannot be edited.',
      'REVIEW_HIDDEN',
    );

  return prisma.$transaction(async (tx) => {
    await tx.reviewMedia.deleteMany({ where: { reviewId: id } });
    return tx.review.update({
      where: { id },
      data: {
        rating: input.rating,
        body,
        media: { create: media.map((item, index) => ({ ...item, sortOrder: index })) },
      },
      select: publicSelect,
    });
  });
}

export async function deleteReview(userId: string, id: string) {
  const review = await prisma.review.findFirst({ where: { id, userId }, select: { id: true } });
  if (!review) throw new ApiError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
  await prisma.review.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Reporting is what makes publish-immediately safe: anyone signed in can flag a
 * review, and the count is what surfaces it in the moderation queue. The unique
 * constraint on (reviewId, reporterId) means one account cannot inflate it.
 */
export async function reportReview(userId: string, id: string, reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 5)
    throw new ApiError(422, 'Say briefly what is wrong with this review.', 'REPORT_REASON_REQUIRED');

  const review = await prisma.review.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!review) throw new ApiError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
  if (review.userId === userId)
    throw new ApiError(422, 'You cannot report your own review.', 'REVIEW_SELF_REPORT');

  const already = await prisma.reviewReport.findUnique({
    where: { reviewId_reporterId: { reviewId: id, reporterId: userId } },
    select: { id: true },
  });
  if (already) return { reported: true, alreadyReported: true };

  await prisma.$transaction([
    prisma.reviewReport.create({ data: { reviewId: id, reporterId: userId, reason: trimmed } }),
    prisma.review.update({ where: { id }, data: { reportCount: { increment: 1 } } }),
  ]);

  return { reported: true, alreadyReported: false };
}
