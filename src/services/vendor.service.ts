import { randomUUID } from 'node:crypto';
import { FulfillmentStatus, JharkhandDistrict, ModerationStatus, PayoutRequestStatus, ProductLifecycleStatus, VerificationStatus, WeeklyHaatDay } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { money } from '../utils/money.js';

async function vendorFor(userId: string) { const vendor = await prisma.vendor.findUnique({ where: { ownerId: userId } }); if (!vendor || vendor.verificationStatus !== VerificationStatus.VERIFIED) throw new ApiError(403, 'A verified vendor account is required.', 'VENDOR_NOT_VERIFIED'); return vendor; }
export async function dashboard(userId: string) {
  const vendor = await vendorFor(userId);
  const [profile, products, orders, ledgers, payoutRequests, notifications] = await Promise.all([
    prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id }, include: { owner: { select: { name: true, mobile: true } } } }),
    prisma.product.findMany({ where: { vendorId: vendor.id }, include: { variants: true, category: true, media: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
    prisma.vendorOrder.findMany({ where: { vendorId: vendor.id }, include: { items: true, statusLogs: { orderBy: { createdAt: 'asc' } }, order: { select: { district: true, postalCode: true, recipientName: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.walletLedger.findMany({ where: { vendorId: vendor.id }, include: { vendorOrder: { select: { gmv: true, adminCommission: true, netVendorPayout: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.payoutRequest.findMany({ where: { vendorId: vendor.id }, orderBy: { requestedAt: 'desc' } }),
    prisma.notificationOutbox.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return { vendor: profile, products, orders, ledgers, payoutRequests, notifications };
}

export interface ProductInput {
  name: string; slug: string; description: string; artisanStory?: string; categoryId: string;
  district: JharkhandDistrict; weeklyHaatDay: WeeklyHaatDay; materials?: string; dimensions?: string;
  careInstructions?: string; dispatchEstimate?: string; returnPolicy?: string;
  submitForReview?: boolean;
  variants: { sku: string; label: string; price: number; stock: number }[];
  media?: { objectKey: string; url: string; mimeType: string; altText: string; sortOrder: number; isCover: boolean; width?: number; height?: number }[];
}

const productInclude = { variants: true, category: true, media: { orderBy: { sortOrder: 'asc' as const } } };

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

export async function createProduct(userId: string, input: ProductInput) {
  const vendor = await vendorFor(userId);
  if (!input.variants.length) throw new ApiError(422, 'At least one variant is required.', 'VARIANT_REQUIRED');
  if (new Set(input.variants.map((item) => item.sku.toUpperCase())).size !== input.variants.length) throw new ApiError(422, 'Every variant SKU must be unique.', 'DUPLICATE_SKU');
  const duplicate = await prisma.product.findFirst({ where: { vendorId: vendor.id, name: { equals: input.name, mode: 'insensitive' }, lifecycleStatus: { not: ProductLifecycleStatus.ARCHIVED } } });
  if (duplicate) throw new ApiError(409, 'A product with this name already exists. Edit or duplicate the existing listing.', 'DUPLICATE_PRODUCT');
  const minPrice = Math.min(...input.variants.map((item) => item.price));
  const lifecycleStatus = input.submitForReview ? ProductLifecycleStatus.PENDING_REVIEW : ProductLifecycleStatus.DRAFT;
  return prisma.product.create({ data: { vendorId: vendor.id, categoryId: input.categoryId, name: input.name, slug: input.slug, description: input.description, artisanStory: input.artisanStory ?? null, district: input.district, weeklyHaatDay: input.weeklyHaatDay, minPrice, isPublished: false, lifecycleStatus, submittedAt: input.submitForReview ? new Date() : null, materials: input.materials ?? null, dimensions: input.dimensions ?? null, careInstructions: input.careInstructions ?? null, dispatchEstimate: input.dispatchEstimate ?? null, returnPolicy: input.returnPolicy ?? null, variants: { create: input.variants.map((item) => ({ ...item, sku: item.sku.toUpperCase(), lowStock: item.stock < env.LOW_STOCK_THRESHOLD })) }, ...(input.media?.length ? { media: { create: input.media } } : {}) }, include: productInclude });
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
export async function transitionOrder(userId: string, id: string, status: FulfillmentStatus) { const vendor = await vendorFor(userId); const order = await prisma.vendorOrder.findFirst({ where: { id, vendorId: vendor.id } }); if (!order) throw new ApiError(404, 'Vendor order was not found.', 'VENDOR_ORDER_NOT_FOUND'); if (!transitions[order.status].includes(status)) throw new ApiError(409, `Cannot move order from ${order.status} to ${status}.`, 'INVALID_ORDER_TRANSITION'); return prisma.vendorOrder.update({ where: { id }, data: { status, ...(status === FulfillmentStatus.DELIVERED ? { deliveredAt: new Date() } : {}), statusLogs: { create: { status, actorUserId: userId, note: 'Updated by vendor.' } } }, include: { items: true, statusLogs: true } }); }
export async function shippingLabel(userId: string, id: string) { const vendor = await vendorFor(userId); const order = await prisma.vendorOrder.findFirst({ where: { id, vendorId: vendor.id }, include: { items: true, order: true } }); if (!order) throw new ApiError(404, 'Vendor order was not found.', 'VENDOR_ORDER_NOT_FOUND'); return { trackingId: order.trackingId, vendor: vendor.businessName, recipientName: order.order.recipientName, recipientMobile: order.order.recipientMobile, addressLine1: order.order.addressLine1, district: order.order.district, postalCode: order.order.postalCode, items: order.items }; }
export async function requestPayout(userId: string) { const vendor = await vendorFor(userId); const pending = await prisma.payoutRequest.findFirst({ where: { vendorId: vendor.id, status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.PROCESSING] } } }); if (pending) return pending; if (vendor.walletBalance.lessThanOrEqualTo(0)) throw new ApiError(422, 'No available wallet balance.', 'NO_PAYOUT_BALANCE'); return prisma.payoutRequest.create({ data: { vendorId: vendor.id, amount: money(vendor.walletBalance), reference: `PAY-${randomUUID()}` } }); }
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
