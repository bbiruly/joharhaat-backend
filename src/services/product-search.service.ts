import { Prisma, VerificationStatus } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import type { ProductSearchInput } from '../schemas/product-search.schema.js';
import { pagination } from '../utils/pagination.js';

export async function searchProducts(input: ProductSearchInput) {
  const { page, pageSize, skip } = pagination(input.page, Math.min(input.pageSize, env.MAX_PAGE_SIZE));
  const price: Prisma.DecimalFilter | undefined = input.minPrice !== undefined || input.maxPrice !== undefined ? {
    ...(input.minPrice !== undefined ? { gte: input.minPrice } : {}),
    ...(input.maxPrice !== undefined ? { lte: input.maxPrice } : {}),
  } : undefined;
  const matchingVariant: Prisma.ProductVariantWhereInput = { isActive: true, stock: { gt: 0 }, ...(price ? { price } : {}) };
  const text = input.q ? {
    OR: [
      { name: { contains: input.q, mode: Prisma.QueryMode.insensitive } },
      { description: { contains: input.q, mode: Prisma.QueryMode.insensitive } },
      { artisanStory: { contains: input.q, mode: Prisma.QueryMode.insensitive } },
      { vendor: { businessName: { contains: input.q, mode: Prisma.QueryMode.insensitive } } },
      { vendor: { shgGroupName: { contains: input.q, mode: Prisma.QueryMode.insensitive } } },
      { category: { name: { contains: input.q, mode: Prisma.QueryMode.insensitive } } },
    ],
  } satisfies Prisma.ProductWhereInput : {};
  const where: Prisma.ProductWhereInput = {
    isPublished: true,
    vendor: { verificationStatus: VerificationStatus.VERIFIED },
    variants: { some: matchingVariant },
    ...(input.category ? { category: { slug: input.category, isActive: true } } : {}),
    ...(input.district ? { district: input.district } : {}),
    ...(input.haatDay ? { weeklyHaatDay: input.haatDay } : {}),
    ...text,
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput = input.sort === 'price_asc' ? { minPrice: 'asc' }
    : input.sort === 'price_desc' ? { minPrice: 'desc' }
      : { createdAt: 'desc' };
  const [totalItems, items] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        vendor: { select: { id: true, businessName: true, shgGroupName: true, district: true } },
        weeklyHaat: { select: { id: true, name: true, day: true, isLive: true } },
        variants: { where: matchingVariant, orderBy: { price: 'asc' } },
      },
    }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return { items, page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}
