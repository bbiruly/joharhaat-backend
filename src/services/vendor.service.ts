import { randomUUID } from 'node:crypto';
import { FulfillmentStatus, JharkhandDistrict, ModerationStatus, PayoutRequestStatus, Prisma, ProductLifecycleStatus, ReservationStatus, VerificationStatus } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { recalculateOrderCommissions } from './influencer-commission.service.js';
import { ApiError } from '../utils/api-error.js';
import { money } from '../utils/money.js';
import { objectStorage, publicMediaUrl } from './storage.service.js';

async function vendorFor(userId: string) { const vendor = await prisma.vendor.findUnique({ where: { ownerId: userId } }); if (!vendor || vendor.verificationStatus !== VerificationStatus.VERIFIED) throw new ApiError(403, 'A verified vendor account is required.', 'VENDOR_NOT_VERIFIED'); return vendor; }
export async function dashboard(userId: string) {
  const vendor = await vendorFor(userId);
  const [profile, products, orders, ledgers, payoutRequests, notifications] = await Promise.all([
    prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id }, include: { owner: { select: { name: true, mobile: true } } } }),
    prisma.product.findMany({ where: { vendorId: vendor.id }, include: { variants: true, category: true, media: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
    prisma.vendorOrder.findMany({ where: { vendorId: vendor.id }, include: { items: true, statusLogs: { orderBy: { createdAt: 'asc' } }, order: { select: { orderNumber: true, district: true, recipientState: true, postalCode: true, recipientName: true, recipientMobile: true, addressLine1: true, addressLine2: true, paymentStatus: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.walletLedger.findMany({ where: { vendorId: vendor.id }, include: { vendorOrder: { select: { id: true, gmv: true, adminCommission: true, netVendorPayout: true } }, payoutRequest: { select: { id: true, reference: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.payoutRequest.findMany({ where: { vendorId: vendor.id }, orderBy: { requestedAt: 'desc' } }),
    prisma.notificationOutbox.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const [reserved, approvedApplication] = await Promise.all([
    prisma.payoutRequest.aggregate({ where: { vendorId: vendor.id, status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.PROCESSING] } }, _sum: { amount: true } }),
    prisma.vendorApplication.findFirst({ where: { ownerUserId: userId, status: ModerationStatus.APPROVED }, select: { accountHolderName: true, bankLastFour: true, ifsc: true } }),
  ]);
  const walletBalance = profile.walletBalance;
  const reservedAmount = reserved._sum.amount ?? new Prisma.Decimal(0);
  const availableAmount = Prisma.Decimal.max(walletBalance.minus(reservedAmount), 0);
  const ledgerSummary = {
    credited: ledgers.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)),
    debited: ledgers.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)),
    escrowReleased: ledgers.filter((entry) => entry.type === 'ESCROW_RELEASE').reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)),
    transferred: ledgers.filter((entry) => entry.type === 'BANK_TRANSFER').reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)),
  };
  return {
    vendor: { ...profile, payoutDestination: approvedApplication ? { accountHolderName: approvedApplication.accountHolderName, bankLastFour: approvedApplication.bankLastFour, ifsc: approvedApplication.ifsc } : null },
    products, orders, ledgers, payoutRequests, notifications,
    wallet: { walletBalance, reservedAmount, availableAmount, ...ledgerSummary },
  };
}

export interface ProductInput {
  name: string; slug: string; description: string; artisanStory?: string; categoryId: string;
  district?: JharkhandDistrict; weeklyHaatId?: string; materials?: string; dimensions?: string;
  careInstructions?: string; dispatchEstimate?: string; returnPolicy?: string;
  submitForReview?: boolean;
  variants: { sku: string; label: string; price: number; stock: number }[];
  media?: { objectKey: string; url: string; mimeType: string; altText: string; sortOrder: number; isCover: boolean; width?: number; height?: number }[];
}

type ProductUpdateInput = Omit<ProductInput, 'variants' | 'media'> & {
  variants: (ProductInput['variants'][number] & { id?: string })[];
  media?: (NonNullable<ProductInput['media']>[number] & { id?: string })[];
};

export function productEditReviewState(status: ProductLifecycleStatus) {
  if (status === ProductLifecycleStatus.ARCHIVED || status === ProductLifecycleStatus.SUSPENDED)
    throw new ApiError(409, 'Archived or suspended products cannot be edited.', 'PRODUCT_NOT_EDITABLE');
  return {
    lifecycleStatus: ProductLifecycleStatus.PENDING_REVIEW,
    isPublished: false,
  };
}

export function assertVariantCanBeRemoved(references: { orderItems: number; cartItems: number; reservations: number }, sku: string) {
  if (references.orderItems || references.cartItems || references.reservations)
    throw new ApiError(409, `${sku} is in use and cannot be removed.`, 'VARIANT_IN_USE');
}

export interface ProductDraftPayload {
  name?: string;
  categoryId?: string;
  description?: string;
  artisanStory?: string;
  district?: string | null;
  weeklyHaatId?: string | null;
  materials?: string;
  dimensions?: string;
  careInstructions?: string;
  dispatchEstimate?: string;
  returnPolicy?: string;
  variants?: { sku?: string; label?: string; price?: number; stock?: number }[];
  media?: { objectKey: string; mimeType: string; altText: string; sortOrder: number; isCover: boolean; width?: number; height?: number }[];
}

export interface VendorProductDraftDto {
  id: string;
  payload: Omit<ProductDraftPayload, 'media'> & { media: (NonNullable<ProductDraftPayload['media']>[number] & { url: string })[] };
  createdAt: Date;
  updatedAt: Date;
}

const productInclude = { variants: true, category: true, weeklyHaat: true, media: { orderBy: { sortOrder: 'asc' as const } } };

export async function resolveProductPlacement(input: Pick<ProductInput, 'categoryId' | 'district' | 'weeklyHaatId'>) {
  const [category, weeklyHaat] = await Promise.all([
    prisma.category.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true } }),
    input.weeklyHaatId
      ? prisma.weeklyHaat.findFirst({ where: { id: input.weeklyHaatId, isEnabled: true }, select: { id: true, day: true } })
      : Promise.resolve(null),
  ]);
  if (!category) throw new ApiError(422, 'Select an active product category.', 'CATEGORY_UNAVAILABLE');
  if (input.weeklyHaatId && !weeklyHaat) throw new ApiError(422, 'Select an enabled weekly Haat.', 'HAAT_UNAVAILABLE');
  return {
    district: input.district ?? null,
    weeklyHaatId: weeklyHaat?.id ?? null,
    weeklyHaatDay: weeklyHaat?.day ?? null,
  };
}

export async function listProducts(userId: string) {
  const vendor = await vendorFor(userId);
  return prisma.product.findMany({ where: { vendorId: vendor.id }, include: productInclude, orderBy: { updatedAt: 'desc' } });
}

export async function productDetail(userId: string, id: string) {
  const vendor = await vendorFor(userId);
  const product = await prisma.product.findFirst({ where: { id, vendorId: vendor.id }, include: productInclude });
  if (!product) throw new ApiError(404, 'Product was not found.', 'PRODUCT_NOT_FOUND');
  return product;
}

function draftDto(row: { id: string; payload: Prisma.JsonValue; createdAt: Date; updatedAt: Date }): VendorProductDraftDto {
  const payload = row.payload as ProductDraftPayload;
  return {
    id: row.id,
    payload: {
      ...payload,
      media: payload.media?.map((item) => ({ ...item, url: publicMediaUrl(item.objectKey) })) ?? [],
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProductDrafts(userId: string) {
  const vendor = await vendorFor(userId);
  const rows = await prisma.vendorProductDraft.findMany({
    where: { vendorId: vendor.id },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(draftDto);
}

export async function productDraft(userId: string, id: string) {
  const vendor = await vendorFor(userId);
  const row = await prisma.vendorProductDraft.findFirst({ where: { id, vendorId: vendor.id } });
  if (!row) throw new ApiError(404, 'Product draft was not found.', 'PRODUCT_DRAFT_NOT_FOUND');
  return draftDto(row);
}

export async function saveProductDraft(userId: string, id: string | undefined, payload: ProductDraftPayload) {
  const vendor = await vendorFor(userId);
  // Re-confirm every saved key against the signed upload owner before it enters
  // a durable draft. The browser cannot attach another vendor's public object.
  for (const item of payload.media ?? []) await objectStorage.confirmUpload(item.objectKey, userId);
  const json = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
  if (!id) {
    const created = await prisma.vendorProductDraft.create({ data: { vendorId: vendor.id, payload: json } });
    return draftDto(created);
  }
  const existing = await prisma.vendorProductDraft.findFirst({ where: { id, vendorId: vendor.id }, select: { id: true } });
  if (!existing) throw new ApiError(404, 'Product draft was not found.', 'PRODUCT_DRAFT_NOT_FOUND');
  const updated = await prisma.vendorProductDraft.update({ where: { id }, data: { payload: json } });
  return draftDto(updated);
}

export async function discardProductDraft(userId: string, id: string) {
  const vendor = await vendorFor(userId);
  const result = await prisma.vendorProductDraft.deleteMany({ where: { id, vendorId: vendor.id } });
  if (!result.count) throw new ApiError(404, 'Product draft was not found.', 'PRODUCT_DRAFT_NOT_FOUND');
  return { deleted: true };
}

export function assertProductDraftComplete(payload: ProductDraftPayload) {
  if (!payload.name || payload.name.trim().length < 3 || payload.name.trim().length > 160)
    throw new ApiError(422, 'Product name must be between 3 and 160 characters.', 'PRODUCT_NAME_INVALID');
  if (!payload.categoryId)
    throw new ApiError(422, 'Select an active product category.', 'CATEGORY_UNAVAILABLE');
  if (!payload.description || payload.description.trim().length < 20 || payload.description.trim().length > 3000)
    throw new ApiError(422, 'Product description must be between 20 and 3000 characters.', 'PRODUCT_DESCRIPTION_INVALID');
  if (!payload.variants?.length)
    throw new ApiError(422, 'Add at least one complete price and inventory variant.', 'VARIANT_REQUIRED');
  if (!payload.media?.length)
    throw new ApiError(422, 'Add at least one product photo before submission.', 'PRODUCT_MEDIA_REQUIRED');
  const skus = new Set<string>();
  for (const item of payload.variants) {
    const sku = item.sku?.trim().toUpperCase() ?? '';
    if (sku.length < 3 || sku.length > 80 || !item.label?.trim() || item.label.trim().length > 60 ||
      !Number.isFinite(item.price) || item.price! <= 0 || item.price! > 1_000_000 ||
      !Number.isInteger(item.stock) || item.stock! < 0 || item.stock! > 1_000_000)
      throw new ApiError(422, 'Complete each variant label, SKU, price and stock value.', 'PRODUCT_VARIANT_INVALID');
    if (skus.has(sku)) throw new ApiError(422, 'Every variant SKU must be unique.', 'DUPLICATE_SKU');
    skus.add(sku);
  }
  if (payload.variants.length > 25)
    throw new ApiError(422, 'A product can have at most 25 variants.', 'PRODUCT_VARIANT_INVALID');
  for (const item of payload.media) {
    if (!item.objectKey.startsWith('public/product/') || item.altText.trim().length < 3 || item.altText.length > 200)
      throw new ApiError(422, 'Every photo needs a valid upload and description.', 'PRODUCT_MEDIA_INVALID');
  }
}

export async function submitProductDraft(userId: string, id: string) {
  const vendor = await vendorFor(userId);
  const draft = await prisma.vendorProductDraft.findFirst({ where: { id, vendorId: vendor.id } });
  if (!draft) {
    // A retry after a successful response was lost should return the product
    // created from this draft rather than creating a duplicate listing.
    const submitted = await prisma.product.findFirst({ where: { vendorId: vendor.id, slug: { endsWith: `-draft-${id}` } }, include: productInclude });
    if (submitted) return submitted;
    throw new ApiError(404, 'Product draft was not found.', 'PRODUCT_DRAFT_NOT_FOUND');
  }
  const payload = draft.payload as ProductDraftPayload;
  assertProductDraftComplete(payload);
  for (const item of payload.media ?? []) await objectStorage.confirmUpload(item.objectKey, userId);
  const input: ProductInput = {
    name: payload.name!.trim(),
    slug: `${payload.name!.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-draft-${id}`,
    categoryId: payload.categoryId!,
    description: payload.description!.trim(),
    ...(payload.artisanStory?.trim() ? { artisanStory: payload.artisanStory.trim() } : {}),
    ...(payload.district ? { district: payload.district as JharkhandDistrict } : {}),
    ...(payload.weeklyHaatId ? { weeklyHaatId: payload.weeklyHaatId } : {}),
    ...(payload.materials?.trim() ? { materials: payload.materials.trim() } : {}),
    ...(payload.dimensions?.trim() ? { dimensions: payload.dimensions.trim() } : {}),
    ...(payload.careInstructions?.trim() ? { careInstructions: payload.careInstructions.trim() } : {}),
    ...(payload.dispatchEstimate?.trim() ? { dispatchEstimate: payload.dispatchEstimate.trim() } : {}),
    ...(payload.returnPolicy?.trim() ? { returnPolicy: payload.returnPolicy.trim() } : {}),
    variants: (payload.variants ?? []).map((item) => ({ sku: item.sku!.trim(), label: item.label!.trim(), price: item.price!, stock: item.stock! })),
    media: (payload.media ?? []).map((item) => ({ ...item, url: publicMediaUrl(item.objectKey), mimeType: item.mimeType })),
    submitForReview: true,
  };
  const placement = await resolveProductPlacement(input);
  const duplicate = await prisma.product.findFirst({ where: { vendorId: vendor.id, name: { equals: input.name, mode: 'insensitive' }, lifecycleStatus: { not: ProductLifecycleStatus.ARCHIVED } } });
  if (duplicate) throw new ApiError(409, 'A product with this name already exists. Edit the existing listing instead.', 'DUPLICATE_PRODUCT');
  const minPrice = Math.min(...input.variants.map((item) => item.price));
  try {
    return await prisma.$transaction(async (tx) => {
      const stillOwned = await tx.vendorProductDraft.findFirst({ where: { id, vendorId: vendor.id }, select: { id: true } });
      if (!stillOwned) throw new ApiError(404, 'Product draft was not found.', 'PRODUCT_DRAFT_NOT_FOUND');
      const created = await tx.product.create({ data: {
        vendorId: vendor.id,
        categoryId: input.categoryId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        artisanStory: input.artisanStory ?? null,
        district: placement.district,
        weeklyHaatId: placement.weeklyHaatId,
        weeklyHaatDay: placement.weeklyHaatDay,
        minPrice,
        isPublished: false,
        lifecycleStatus: ProductLifecycleStatus.PENDING_REVIEW,
        submittedAt: new Date(),
        materials: input.materials ?? null,
        dimensions: input.dimensions ?? null,
        careInstructions: input.careInstructions ?? null,
        dispatchEstimate: input.dispatchEstimate ?? null,
        returnPolicy: input.returnPolicy ?? null,
        variants: { create: input.variants.map((item) => ({ ...item, sku: item.sku.toUpperCase(), lowStock: item.stock < env.LOW_STOCK_THRESHOLD })) },
        media: { create: input.media! },
      }, include: productInclude });
      await tx.vendorProductDraft.delete({ where: { id } });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const submitted = await prisma.product.findFirst({ where: { vendorId: vendor.id, slug: { endsWith: `-draft-${id}` } }, include: productInclude });
      if (submitted) return submitted;
    }
    throw error;
  }
}

export async function createProduct(userId: string, input: ProductInput) {
  const vendor = await vendorFor(userId);
  if (!input.variants.length) throw new ApiError(422, 'At least one variant is required.', 'VARIANT_REQUIRED');
  if (new Set(input.variants.map((item) => item.sku.toUpperCase())).size !== input.variants.length) throw new ApiError(422, 'Every variant SKU must be unique.', 'DUPLICATE_SKU');
  const duplicate = await prisma.product.findFirst({ where: { vendorId: vendor.id, name: { equals: input.name, mode: 'insensitive' }, lifecycleStatus: { not: ProductLifecycleStatus.ARCHIVED } } });
  if (duplicate) throw new ApiError(409, 'A product with this name already exists. Edit or duplicate the existing listing.', 'DUPLICATE_PRODUCT');
  const placement = await resolveProductPlacement(input);
  const minPrice = Math.min(...input.variants.map((item) => item.price));
  const lifecycleStatus = input.submitForReview ? ProductLifecycleStatus.PENDING_REVIEW : ProductLifecycleStatus.DRAFT;
  const media = input.media?.map((item) => ({ ...item, url: publicMediaUrl(item.objectKey) }));
  return prisma.product.create({ data: { vendorId: vendor.id, categoryId: input.categoryId, name: input.name, slug: input.slug, description: input.description, artisanStory: input.artisanStory ?? null, district: placement.district, weeklyHaatId: placement.weeklyHaatId, weeklyHaatDay: placement.weeklyHaatDay, minPrice, isPublished: false, lifecycleStatus, submittedAt: input.submitForReview ? new Date() : null, materials: input.materials ?? null, dimensions: input.dimensions ?? null, careInstructions: input.careInstructions ?? null, dispatchEstimate: input.dispatchEstimate ?? null, returnPolicy: input.returnPolicy ?? null, variants: { create: input.variants.map((item) => ({ ...item, sku: item.sku.toUpperCase(), lowStock: item.stock < env.LOW_STOCK_THRESHOLD })) }, ...(media?.length ? { media: { create: media } } : {}) }, include: productInclude });
}

export async function updateProduct(userId: string, id: string, input: ProductUpdateInput) {
  const vendor = await vendorFor(userId);
  const current = await prisma.product.findFirst({
    where: { id, vendorId: vendor.id },
    include: productInclude,
  });
  if (!current) throw new ApiError(404, 'Product was not found.', 'PRODUCT_NOT_FOUND');
  const reviewState = productEditReviewState(current.lifecycleStatus);
  if (!input.variants.length) throw new ApiError(422, 'At least one variant is required.', 'VARIANT_REQUIRED');
  const mediaInput = input.media ?? [];
  if (!mediaInput.length) throw new ApiError(422, 'At least one product photo is required.', 'PRODUCT_INCOMPLETE');
  const skus = input.variants.map((item) => item.sku.trim().toUpperCase());
  if (new Set(skus).size !== skus.length) throw new ApiError(422, 'Every variant SKU must be unique.', 'DUPLICATE_SKU');

  const duplicate = await prisma.product.findFirst({
    where: { vendorId: vendor.id, id: { not: id }, name: { equals: input.name, mode: 'insensitive' }, lifecycleStatus: { not: ProductLifecycleStatus.ARCHIVED } },
    select: { id: true },
  });
  if (duplicate) throw new ApiError(409, 'A product with this name already exists.', 'DUPLICATE_PRODUCT');
  const placement = await resolveProductPlacement(input);
  for (const media of mediaInput) await objectStorage.confirmUpload(media.objectKey, userId);

  const existingVariants = new Map(current.variants.map((variant) => [variant.id, variant]));
  const existingMedia = new Map(current.media.map((media) => [media.id, media]));
  const submittedVariantIds = new Set<string>();
  for (const variant of input.variants) {
    const existing = variant.id
      ? existingVariants.get(variant.id)
      : current.variants.find((item) => item.sku === variant.sku.trim().toUpperCase());
    if (variant.id && !existing) throw new ApiError(404, 'Variant was not found for this product.', 'VARIANT_NOT_FOUND');
    if (existing) submittedVariantIds.add(existing.id);
  }
  const submittedMediaIds = new Set<string>();
  for (const media of mediaInput) {
    if (media.id && !existingMedia.has(media.id)) throw new ApiError(404, 'Photo was not found for this product.', 'PRODUCT_MEDIA_NOT_FOUND');
    if (media.id) submittedMediaIds.add(media.id);
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    for (const variant of current.variants.filter((item) => !submittedVariantIds.has(item.id))) {
      const [orderItems, cartItems, reservations] = await Promise.all([
        tx.orderItem.count({ where: { variantId: variant.id } }),
        tx.cartItem.count({ where: { variantId: variant.id } }),
        tx.inventoryReservation.count({ where: { variantId: variant.id, status: ReservationStatus.ACTIVE } }),
      ]);
      assertVariantCanBeRemoved({ orderItems, cartItems, reservations }, variant.sku);
      await tx.productVariant.delete({ where: { id: variant.id } });
    }

    for (const variant of input.variants) {
      const existing = variant.id ? existingVariants.get(variant.id) : current.variants.find((item) => item.sku === variant.sku);
      const data = {
        sku: variant.sku.trim().toUpperCase(),
        label: variant.label.trim(),
        price: new Prisma.Decimal(variant.price),
        stock: variant.stock,
        lowStock: variant.stock < env.LOW_STOCK_THRESHOLD,
        isActive: true,
        version: { increment: 1 },
      };
      if (existing) {
        submittedVariantIds.add(existing.id);
        await tx.productVariant.update({ where: { id: existing.id }, data });
      } else {
        await tx.productVariant.create({ data: { ...data, productId: id, version: 0 } });
      }
    }

    await tx.productMedia.deleteMany({ where: { productId: id, id: { notIn: [...submittedMediaIds] } } });
    for (const media of mediaInput) {
      const data = {
        objectKey: media.objectKey,
        url: publicMediaUrl(media.objectKey),
        mimeType: media.mimeType,
        altText: media.altText.trim(),
        sortOrder: media.sortOrder,
        isCover: media.isCover,
        width: media.width ?? null,
        height: media.height ?? null,
      };
      if (media.id) await tx.productMedia.update({ where: { id: media.id }, data });
      else await tx.productMedia.create({ data: { ...data, productId: id } });
    }

    return tx.product.update({
      where: { id },
      data: {
        name: input.name.trim(),
        description: input.description.trim(),
        artisanStory: input.artisanStory?.trim() || null,
        categoryId: input.categoryId,
        district: placement.district,
        weeklyHaatId: placement.weeklyHaatId,
        weeklyHaatDay: placement.weeklyHaatDay,
        materials: input.materials?.trim() || null,
        dimensions: input.dimensions?.trim() || null,
        careInstructions: input.careInstructions?.trim() || null,
        dispatchEstimate: input.dispatchEstimate?.trim() || null,
        returnPolicy: input.returnPolicy?.trim() || null,
        minPrice: Math.min(...input.variants.map((item) => item.price)),
        ...reviewState,
        submittedAt: now,
        reviewedAt: null,
        reviewerId: null,
        moderationReason: null,
      },
      include: productInclude,
    });
  });
}

export async function submitProduct(userId: string, id: string) {
  const product = await productDetail(userId, id);
  if (product.lifecycleStatus !== ProductLifecycleStatus.DRAFT && product.lifecycleStatus !== ProductLifecycleStatus.REJECTED) throw new ApiError(409, 'Only draft or rejected products can be submitted.', 'PRODUCT_NOT_SUBMITTABLE');
  if (!product.variants.length || !product.media.length) throw new ApiError(422, 'At least one variant and one product photo are required.', 'PRODUCT_INCOMPLETE');
  return prisma.product.update({ where: { id }, data: { lifecycleStatus: ProductLifecycleStatus.PENDING_REVIEW, submittedAt: new Date(), moderationReason: null, isPublished: false }, include: productInclude });
}

export async function archiveProduct(userId: string, id: string) {
  const product = await productDetail(userId, id);
  if (product.lifecycleStatus === ProductLifecycleStatus.ARCHIVED) return product;
  return prisma.product.update({ where: { id }, data: { lifecycleStatus: ProductLifecycleStatus.ARCHIVED, isPublished: false }, include: productInclude });
}

export async function updateStock(userId: string, variantId: string, stock: number, expectedVersion?: number) {
  const vendor = await vendorFor(userId);
  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, product: { vendorId: vendor.id } } });
  if (!variant) throw new ApiError(404, 'Variant was not found.', 'VARIANT_NOT_FOUND');
  if (expectedVersion !== undefined && variant.version !== expectedVersion) throw new ApiError(409, 'Stock changed in another session. Refresh and try again.', 'STOCK_VERSION_CONFLICT', { currentStock: variant.stock, currentVersion: variant.version });
  return prisma.productVariant.update({ where: { id: variantId }, data: { stock, lowStock: stock < env.LOW_STOCK_THRESHOLD, version: { increment: 1 } } });
}
const transitions: Record<FulfillmentStatus, FulfillmentStatus[]> = { PENDING: [FulfillmentStatus.PACKED, FulfillmentStatus.CANCELLED], PACKED: [FulfillmentStatus.SHIPPED, FulfillmentStatus.CANCELLED], SHIPPED: [FulfillmentStatus.DELIVERED, FulfillmentStatus.RTO], DELIVERED: [], RTO: [], CANCELLED: [] };
export function assertVendorOrderTransition(input: { current: FulfillmentStatus; next: FulfillmentStatus; paymentStatus: string; carrierName?: string; carrierTrackingId?: string }) {
  if (!transitions[input.current].includes(input.next)) throw new ApiError(409, `Cannot move order from ${input.current} to ${input.next}.`, 'INVALID_ORDER_TRANSITION');
  if (input.next === FulfillmentStatus.PACKED && !['PAID', 'AUTHORIZED'].includes(input.paymentStatus)) throw new ApiError(409, 'A paid order is required before packing.', 'ORDER_PAYMENT_REQUIRED');
  if (input.next === FulfillmentStatus.SHIPPED && (!input.carrierName?.trim() || !input.carrierTrackingId?.trim())) throw new ApiError(422, 'Enter the carrier and tracking reference before marking an order shipped.', 'SHIPMENT_DETAILS_REQUIRED');
}
export async function transitionOrder(userId: string, id: string, status: FulfillmentStatus, shipment: { carrierName?: string; carrierTrackingId?: string } = {}) {
  const vendor = await vendorFor(userId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM vendor_orders WHERE id = ${id} AND vendor_id = ${vendor.id} FOR UPDATE`);
    const order = await tx.vendorOrder.findFirst({ where: { id, vendorId: vendor.id }, include: { order: { select: { paymentStatus: true } } } });
    if (!order) throw new ApiError(404, 'Vendor order was not found.', 'VENDOR_ORDER_NOT_FOUND');
    assertVendorOrderTransition({ current: order.status, next: status, paymentStatus: order.order.paymentStatus, ...shipment });
    const updated = await tx.vendorOrder.update({ where: { id }, data: { status, ...(status === FulfillmentStatus.DELIVERED ? { deliveredAt: new Date() } : {}), ...(status === FulfillmentStatus.SHIPPED ? { carrierName: shipment.carrierName!.trim(), carrierTrackingId: shipment.carrierTrackingId!.trim() } : {}), statusLogs: { create: { status, actorUserId: userId, note: status === FulfillmentStatus.SHIPPED ? `Carrier: ${shipment.carrierName!.trim()}; tracking: ${shipment.carrierTrackingId!.trim()}` : 'Updated by vendor.' } } }, include: { items: true, statusLogs: true } });
    await recalculateOrderCommissions(tx, order.orderId);
    return updated;
  });
}
export async function shippingLabel(userId: string, id: string) { const vendor = await vendorFor(userId); const order = await prisma.vendorOrder.findFirst({ where: { id, vendorId: vendor.id }, include: { items: true, order: true } }); if (!order) throw new ApiError(404, 'Vendor order was not found.', 'VENDOR_ORDER_NOT_FOUND'); return { trackingId: order.trackingId, carrierName: order.carrierName, carrierTrackingId: order.carrierTrackingId, vendor: vendor.businessName, recipientName: order.order.recipientName, recipientMobile: order.order.recipientMobile, addressLine1: order.order.addressLine1, addressLine2: order.order.addressLine2, district: order.order.district, state: order.order.recipientState, postalCode: order.order.postalCode, items: order.items }; }
export async function requestPayout(userId: string) {
  const vendor = await vendorFor(userId);
  const approvedDestination = await prisma.vendorApplication.findFirst({ where: { ownerUserId: userId, status: ModerationStatus.APPROVED }, select: { id: true } });
  if (!approvedDestination) throw new ApiError(422, 'An approved payout destination is required.', 'PAYOUT_DESTINATION_REQUIRED');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM vendors WHERE id = ${vendor.id} FOR UPDATE`);
    const existing = await tx.payoutRequest.findFirst({ where: { vendorId: vendor.id, status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.PROCESSING] } }, orderBy: { requestedAt: 'desc' } });
    if (existing) return existing;
    const reserved = await tx.payoutRequest.aggregate({ where: { vendorId: vendor.id, status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.PROCESSING] } }, _sum: { amount: true } });
    const balance = (await tx.vendor.findUniqueOrThrow({ where: { id: vendor.id } })).walletBalance;
    const available = money(balance.minus(reserved._sum.amount ?? new Prisma.Decimal(0)));
    if (available.lessThanOrEqualTo(0)) throw new ApiError(422, 'No available wallet balance.', 'NO_PAYOUT_BALANCE');
    return tx.payoutRequest.create({ data: { vendorId: vendor.id, amount: available, reference: `PAY-${randomUUID()}` } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function submitApplication(userId: string, input: any) {
  const existing = await prisma.vendorApplication.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { documents: true } });
  if (existing) {
    if (existing.ownerUserId !== userId) throw new ApiError(409, 'This application key belongs to another account.', 'APPLICATION_KEY_CONFLICT');
    return existing;
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.email || !user.passwordHash || !user.isActive) throw new ApiError(403, 'Create and verify your JoharHaat account before applying.', 'APPLICANT_ACCOUNT_REQUIRED');
  if (user.email.toLowerCase() !== String(input.email).toLowerCase() || user.mobile !== input.mobile) throw new ApiError(422, 'Application email and mobile must match your signed-in account.', 'APPLICANT_IDENTITY_MISMATCH');
  const active = await prisma.vendorApplication.findFirst({ where: { ownerUserId: userId, status: { in: [ModerationStatus.PENDING, ModerationStatus.HOLD, ModerationStatus.APPROVED] } }, include: { documents: true } });
  if (active) return active;
  const registeredMsme = await prisma.vendorApplication.findUnique({ where: { msmeNumber: input.msmeNumber }, include: { documents: true } });
  if (registeredMsme) {
    if (registeredMsme.ownerUserId === userId) return registeredMsme;
    throw new ApiError(409, 'This MSME/Udyam number is already linked to another application.', 'MSME_ALREADY_REGISTERED');
  }
  const { msmeCertificate, ownerName: _ownerName, email: _email, mobile: _mobile, ...data } = input;
  return prisma.vendorApplication.create({ data: { ...data, ownerUserId: userId, ownerName: user.name, email: user.email, mobile: user.mobile, status: ModerationStatus.PENDING, documents: { create: [{ category: 'MSME', objectKey: msmeCertificate.objectKey, fileName: msmeCertificate.fileName, mimeType: msmeCertificate.mimeType, size: msmeCertificate.size }] } }, include: { documents: true } });
}
