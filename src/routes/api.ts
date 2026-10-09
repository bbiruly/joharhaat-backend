import { Router, text } from 'express';
import type { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { checkoutController, checkoutOffersController, checkoutQuoteController } from '../controllers/checkout.controller.js';
import * as authController from '../controllers/auth.controller.js';
import * as customerController from '../controllers/customer.controller.js';
import * as catalogController from '../controllers/catalog.controller.js';
import * as reviewController from '../controllers/review.controller.js';
import * as paymentController from '../controllers/payment.controller.js';
import * as vendorController from '../controllers/vendor.controller.js';
import * as adminController from '../controllers/admin.controller.js';
import * as productAnalyticsController from '../controllers/product-analytics.controller.js';
import * as advancedAnalyticsController from '../controllers/advanced-analytics.controller.js';
import { payoutController } from '../controllers/payout.controller.js';
import { productSearchController } from '../controllers/product.controller.js';
import { JharkhandDistrict, UserRole, WeeklyHaatDay } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { optionalSystemKey } from '../middleware/system-key.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { checkoutBodySchema, checkoutHeadersSchema, checkoutQuoteBodySchema } from '../schemas/checkout.schema.js';
import { payoutParamsSchema } from '../schemas/payout.schema.js';
import { productSearchQuerySchema } from '../schemas/product-search.schema.js';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '../schemas/auth.schema.js';
import { addressSchema, cartItemSchema, idParams, profileSchema, quantitySchema } from '../schemas/customer.schema.js';
import { asyncHandler } from '../utils/async-handler.js';
import { resendWebhook } from '../controllers/webhook.controller.js';
import * as deliveryController from '../controllers/delivery.controller.js';

export const apiRouter: ExpressRouter = Router();
const deliveryCsvText = text({ type: ['text/csv', 'text/plain'], limit: '25mb' });
const searchLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });

/**
 * Credential endpoints are the highest-value target on the API — brute force,
 * credential stuffing and reset-token fishing all land here. Keyed per IP.
 */
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } } });
/** Blanket ceiling for every authenticated write path. */
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again.' } } });
const productVariantInput = z.object({ sku: z.string().trim().min(3).max(80), label: z.string().trim().min(1).max(60), price: z.number().positive().max(1_000_000), stock: z.number().int().nonnegative().max(1_000_000) });
const productMediaInput = z.object({ objectKey: z.string().startsWith('public/product/'), url: z.string().url(), mimeType: z.enum(['image/jpeg','image/png','image/webp']), altText: z.string().trim().min(3).max(200), sortOrder: z.number().int().nonnegative(), isCover: z.boolean(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() });
const productInput = z.object({ name: z.string().trim().min(3).max(160), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().min(20).max(3000), artisanStory: z.string().trim().min(40).max(3000).optional(), categoryId: z.string().min(1), district: z.enum(JharkhandDistrict).optional(), weeklyHaatId: z.string().min(1).optional(), materials: z.string().trim().max(500).optional(), dimensions: z.string().trim().max(200).optional(), careInstructions: z.string().trim().max(1000).optional(), dispatchEstimate: z.string().trim().max(160).optional(), returnPolicy: z.string().trim().max(1000).optional(), submitForReview: z.boolean().optional(), variants: z.array(productVariantInput).min(1).max(25), media: z.array(productMediaInput).max(8).optional() }).strict();
const productUpdateInput = productInput.extend({
  variants: z.array(productVariantInput.extend({ id: z.string().min(1).optional() })).min(1).max(25),
  media: z.array(productMediaInput.extend({ id: z.string().min(1).optional() })).max(8).optional(),
});
const productDraftPayload = z.object({
  name: z.string().max(160).optional(),
  categoryId: z.string().max(100).optional(),
  description: z.string().max(3000).optional(),
  artisanStory: z.string().max(3000).optional(),
  district: z.enum(JharkhandDistrict).nullable().optional(),
  weeklyHaatId: z.string().max(100).nullable().optional(),
  materials: z.string().max(500).optional(),
  dimensions: z.string().max(200).optional(),
  careInstructions: z.string().max(1000).optional(),
  dispatchEstimate: z.string().max(160).optional(),
  returnPolicy: z.string().max(1000).optional(),
  variants: z.array(z.object({
    sku: z.string().max(80).optional(),
    label: z.string().max(60).optional(),
    price: z.number().min(0).max(1_000_000).optional(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
  }).strict()).max(25).optional(),
  media: z.array(z.object({
    objectKey: z.string().startsWith('public/product/'),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    altText: z.string().trim().min(3).max(200),
    sortOrder: z.number().int().nonnegative(),
    isCover: z.boolean(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }).strict()).max(8).optional(),
}).strict();
const categoryInput = z.object({ name: z.string().trim().min(2).max(100), nameHi: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(240).optional(), descriptionHi: z.string().trim().max(240).optional(), displayOrder: z.number().int().min(0).max(10_000), isFeatured: z.boolean() }).strict();
const applicationInput = z.object({ idempotencyKey: z.string().min(8).max(128), ownerName: z.string().trim().min(2).max(100), collectiveName: z.string().trim().min(2).max(160), email: z.string().email(), mobile: z.string().regex(/^[6-9]\d{9}$/), district: z.enum(JharkhandDistrict), category: z.string().min(2).max(80), msmeNumber: z.string().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/), phoneVerified: z.literal(true), aadhaarVerified: z.literal(true), accountHolderName: z.string().min(2).max(100), bankLastFour: z.string().regex(/^\d{4}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), verificationReference: z.string().max(160).optional(), story: z.string().min(80).max(1500), msmeCertificate: z.object({ objectKey: z.string().startsWith('private/msme/'), fileName: z.string().min(1).max(120), mimeType: z.enum(['application/pdf','image/jpeg','image/png']), size: z.number().int().positive().max(5_000_000) }) });

/**
 * Haat input. saveHaat used to receive `any` and spread it straight into
 * prisma.weeklyHaat.create/update, so a caller could set any column on the
 * table — isLive included. The whitelist is the fix; the shape is also what
 * the admin UI already sends.
 */
const haatInput = z.object({
  name: z.string().trim().min(2).max(120),
  district: z.enum(JharkhandDistrict),
  day: z.enum(WeeklyHaatDay),
  /** 24-hour HH:MM. Compared as strings by saveHaat, so zero-padding matters. */
  opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  isEnabled: z.boolean().optional(),
});

apiRouter.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
apiRouter.get('/health/ready', asyncHandler(async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.json({ status: 'ready', database: 'connected' });
}));

apiRouter.get('/products/search', searchLimiter, validate(z.object({ query: productSearchQuerySchema })), asyncHandler(productSearchController));
apiRouter.get('/categories', asyncHandler(catalogController.categories));
apiRouter.get('/districts', asyncHandler(catalogController.districts));
apiRouter.get('/haats', asyncHandler(catalogController.haats));
apiRouter.get('/homepage-video', asyncHandler(catalogController.homepageVideo));
apiRouter.get('/featured-endorsements', asyncHandler(catalogController.featuredEndorsements));
apiRouter.get('/products/:id', validate(z.object({ params: idParams })), asyncHandler(catalogController.product));

/* -------------------------------------------------------------- reviews ---
 * Reading is public. Writing requires a DELIVERED order that contained the
 * product — review.service.assertCanReview is the gate, not the role, which is
 * what makes "Verified buyer" a fact rather than a label. Reporting is open to
 * any signed-in account so publish-immediately stays safe.
 * ------------------------------------------------------------------------- */
const reviewMedia = z.array(z.object({objectKey:z.string().min(1),url:z.string().url(),altText:z.string().max(200)})).max(5).optional();
const reviewBody = z.object({rating:z.number().int().min(1).max(5),body:z.string().max(2000).optional(),media:reviewMedia});
apiRouter.get('/products/:id/reviews', validate(z.object({ params: idParams })), asyncHandler(reviewController.listForProduct));
apiRouter.get('/products/:id/rating', validate(z.object({ params: idParams })), asyncHandler(reviewController.ratingFor));
apiRouter.get('/orders/:id/reviewable', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams })), asyncHandler(reviewController.reviewable));
apiRouter.post('/reviews/uploads/presign', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('review') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.post('/reviews', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({body:reviewBody.extend({productId:z.string().min(1),orderId:z.string().min(1)})})), asyncHandler(reviewController.create));
apiRouter.put('/reviews/:id', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({params:idParams,body:reviewBody})), asyncHandler(reviewController.update));
apiRouter.delete('/reviews/:id', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({params:idParams})), asyncHandler(reviewController.remove));
// Any signed-in account may report, including a vendor who sees an abusive
// review on their own product — that is the main person who will notice.
apiRouter.post('/reviews/:id/report', authenticate, validate(z.object({params:idParams,body:z.object({reason:z.string().min(5).max(500)})})), asyncHandler(reviewController.report));
apiRouter.post('/analytics/product-events', searchLimiter, validate(z.object({body:z.object({eventKey:z.string().uuid(),type:z.enum(['IMPRESSION','VIEW','SEARCH_CLICK','WISHLIST_ADD','WISHLIST_REMOVE','ADD_TO_CART','REMOVE_FROM_CART','CHECKOUT_STARTED']),productId:z.string().min(1),variantId:z.string().min(1).optional(),sessionId:z.string().min(8).max(100),district:z.enum(JharkhandDistrict).optional(),source:z.string().max(80).optional(),searchQuery:z.string().max(160).optional(),device:z.enum(['mobile','tablet','desktop']).optional(),quantity:z.number().int().positive().max(100).optional(),price:z.number().positive().optional()})})), asyncHandler(productAnalyticsController.ingest));

apiRouter.post('/auth/register', authLimiter, validate(z.object({ body: registerSchema })), asyncHandler(authController.registerController));
apiRouter.post('/auth/login', authLimiter, validate(z.object({ body: loginSchema })), asyncHandler(authController.loginController));
apiRouter.post('/auth/refresh', asyncHandler(authController.refreshController));
apiRouter.post('/auth/logout', asyncHandler(authController.logoutController));
apiRouter.post('/auth/revoke-all', authenticate, asyncHandler(authController.revokeAllController));
apiRouter.post('/auth/forgot-password', authLimiter, validate(z.object({ body: forgotPasswordSchema })), asyncHandler(authController.forgotPasswordController));
apiRouter.post('/auth/reset-password', authLimiter, validate(z.object({ body: resetPasswordSchema })), asyncHandler(authController.resetPasswordController));

apiRouter.get('/me', authenticate, asyncHandler(customerController.me));
apiRouter.patch('/me', authenticate, validate(z.object({ body: profileSchema })), asyncHandler(customerController.updateMe));
apiRouter.get('/addresses', authenticate, asyncHandler(customerController.addresses));
apiRouter.post('/addresses', authenticate, validate(z.object({ body: addressSchema })), asyncHandler(customerController.createAddress));
apiRouter.put('/addresses/:id', authenticate, validate(z.object({ params: idParams, body: addressSchema })), asyncHandler(customerController.updateAddress));
apiRouter.delete('/addresses/:id', authenticate, validate(z.object({ params: idParams })), asyncHandler(customerController.deleteAddress));
apiRouter.post('/addresses/:id/default', authenticate, validate(z.object({ params: idParams })), asyncHandler(customerController.defaultAddress));
apiRouter.get('/delivery/pincodes/:postalCode', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: z.object({ postalCode: z.string().regex(/^\d{6}$/) }) })), asyncHandler(deliveryController.lookupPincode));
apiRouter.get('/cart', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(customerController.cart));
apiRouter.post('/cart/items', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: cartItemSchema })), asyncHandler(customerController.addCartItem));
apiRouter.patch('/cart/items/:id', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams, body: quantitySchema })), asyncHandler(customerController.updateCartItem));
apiRouter.delete('/cart/items/:id', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams })), asyncHandler(customerController.removeCartItem));
apiRouter.delete('/cart/items', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(customerController.clearCart));
apiRouter.get('/wishlist', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(customerController.wishlist));
apiRouter.post('/wishlist/:id/toggle', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams })), asyncHandler(customerController.toggleWishlist));
apiRouter.get('/orders', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(customerController.orders));
apiRouter.get('/orders/:id', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams })), asyncHandler(customerController.order));

apiRouter.post('/checkout/quote', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: checkoutQuoteBodySchema })), asyncHandler(checkoutQuoteController));
apiRouter.get('/admin/delivery/settings', authenticate, authorize(UserRole.ADMIN), asyncHandler(deliveryController.settings));
apiRouter.put('/admin/delivery/settings', authenticate, authorize(UserRole.ADMIN), validate(z.object({ body: z.object({ isPinPricingEnabled: z.boolean(), freeDeliveryThreshold: z.number().finite().min(0).max(1_000_000) }) })), asyncHandler(deliveryController.updateSettings));
apiRouter.get('/admin/delivery/pincodes', authenticate, authorize(UserRole.ADMIN), validate(z.object({ query: z.object({ q: z.string().max(120).optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(100).optional(), serviceable: z.enum(['true', 'false']).optional() }) })), asyncHandler(deliveryController.pincodes));
apiRouter.put('/admin/delivery/pincodes/:postalCode', authenticate, authorize(UserRole.ADMIN), validate(z.object({ params: z.object({ postalCode: z.string().regex(/^\d{6}$/) }), body: z.object({ isServiceable: z.boolean(), deliveryFee: z.number().finite().min(0).max(100_000) }) })), asyncHandler(deliveryController.updatePincode));
apiRouter.post('/admin/delivery/pincodes/preview', authenticate, authorize(UserRole.ADMIN), deliveryCsvText, asyncHandler(deliveryController.previewPincodes));
apiRouter.post('/admin/delivery/pincodes/import', authenticate, authorize(UserRole.ADMIN), deliveryCsvText, asyncHandler(deliveryController.importPincodes));
apiRouter.get('/admin/delivery/pincodes/export.csv', authenticate, authorize(UserRole.ADMIN), asyncHandler(deliveryController.exportPincodes));
apiRouter.get('/admin/delivery/pincodes/template.csv', authenticate, authorize(UserRole.ADMIN), asyncHandler(deliveryController.template));
apiRouter.get('/checkout/offers', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(checkoutOffersController));
apiRouter.post('/checkout', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: checkoutBodySchema, headers: checkoutHeadersSchema.passthrough() })), asyncHandler(checkoutController));
apiRouter.post('/payments/intents', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ headers: checkoutHeadersSchema.passthrough(), body: z.object({ orderId: z.string().min(1), method: z.literal('UPI') }) })), asyncHandler(paymentController.createIntent));
apiRouter.post('/payments/intents/:id/verify', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams, body: z.object({ razorpayOrderId:z.string().min(1),razorpayPaymentId:z.string().min(1),razorpaySignature:z.string().min(1) }) })), asyncHandler(paymentController.verifyIntent));
apiRouter.get('/payments/orders/:orderId/state', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({params:z.object({orderId:z.string().min(1)})})), asyncHandler(paymentController.paymentState));
apiRouter.post('/payments/razorpay/webhook', asyncHandler(paymentController.webhook));
apiRouter.post('/webhooks/resend', asyncHandler(resendWebhook));

apiRouter.post('/uploads/presign', authenticate, validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('msme') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.post('/uploads/confirm', authenticate, validate(z.object({ body: z.object({ objectKey: z.string().min(1) }) })), asyncHandler(vendorController.confirmUpload));
// Any signed-in account may apply. The role is NOT a meaningful gate here:
// vendor.service.submitApplication already requires the caller to have a
// password-protected active account and to match the application's email and
// mobile. Restricting to CUSTOMER only meant an admin (or an existing vendor
// re-checking status) got an opaque 403 "You do not have permission".
apiRouter.post('/vendor-applications', authenticate, writeLimiter, validate(z.object({ body: applicationInput })), asyncHandler(vendorController.submitApplication));
apiRouter.get('/vendor/dashboard', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.dashboard));
apiRouter.post('/vendor/uploads/presign', authenticate, authorize(UserRole.VENDOR), validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('product') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.get('/vendor/products', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.products));
apiRouter.get('/vendor/product-drafts', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.productDrafts));
apiRouter.post('/vendor/product-drafts', authenticate, authorize(UserRole.VENDOR), writeLimiter, validate(z.object({ body: z.object({ payload: productDraftPayload }) })), asyncHandler(vendorController.saveProductDraft));
apiRouter.get('/vendor/product-drafts/:id', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.productDraft));
apiRouter.put('/vendor/product-drafts/:id', authenticate, authorize(UserRole.VENDOR), writeLimiter, validate(z.object({ params: idParams, body: z.object({ payload: productDraftPayload }) })), asyncHandler(vendorController.saveProductDraft));
apiRouter.delete('/vendor/product-drafts/:id', authenticate, authorize(UserRole.VENDOR), writeLimiter, validate(z.object({ params: idParams })), asyncHandler(vendorController.discardProductDraft));
apiRouter.post('/vendor/product-drafts/:id/submit', authenticate, authorize(UserRole.VENDOR), writeLimiter, validate(z.object({ params: idParams })), asyncHandler(vendorController.submitProductDraft));
apiRouter.get('/vendor/products/:id', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.product));
apiRouter.put('/vendor/products/:id', authenticate, authorize(UserRole.VENDOR), writeLimiter, validate(z.object({ params: idParams, body: productUpdateInput })), asyncHandler(vendorController.updateProduct));
apiRouter.post('/vendor/products', authenticate, authorize(UserRole.VENDOR), validate(z.object({ body: productInput })), asyncHandler(vendorController.createProduct));
apiRouter.post('/vendor/products/:id/submit', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.submitProduct));
apiRouter.post('/vendor/products/:id/archive', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.archiveProduct));
apiRouter.patch('/vendor/variants/:id/stock', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams, body: z.object({ stock: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative().optional() }) })), asyncHandler(vendorController.updateStock));
apiRouter.post('/vendor/orders/:id/status', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams, body: z.object({ status: z.enum(['PACKED','SHIPPED','DELIVERED','RTO','CANCELLED']), carrierName: z.string().trim().min(1).max(100).optional(), carrierTrackingId: z.string().trim().min(1).max(120).optional() }) })), asyncHandler(vendorController.transitionOrder));
apiRouter.get('/vendor/orders/:id/shipping-label', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.shippingLabel));
apiRouter.post('/vendor/payout-requests', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.requestPayout));

apiRouter.get('/admin/analytics', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.analytics));
apiRouter.get('/admin/access', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.access));
apiRouter.get('/admin/homepage-video', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.homepageVideo));
apiRouter.post('/admin/homepage-video/uploads/presign', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ body: z.object({ fileName: z.string().min(1).max(200), mimeType: z.enum(['video/mp4', 'video/webm']), size: z.number().int().positive() }) })), asyncHandler(adminController.presignHomepageVideo));
apiRouter.put('/admin/homepage-video', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ body: z.object({ objectKey: z.string().min(1).nullable().optional(), enabled: z.boolean() }) })), asyncHandler(adminController.updateHomepageVideo));
const endorsementInput = z.object({ type: z.enum(['CELEBRITY', 'GOVERNMENT_OFFICIAL']), displayName: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(160), organization: z.string().trim().max(160).nullable().optional(), quote: z.string().trim().min(1).max(1200), imageObjectKey: z.string().startsWith('public/endorsement/').nullable(), imageAltText: z.string().trim().max(200).nullable(), videoObjectKey: z.string().startsWith('public/endorsement/').nullable(), displayOrder: z.number().int().min(0).max(100000) }).strict();
apiRouter.get('/admin/endorsements', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.endorsements));
apiRouter.post('/admin/endorsements', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ body: endorsementInput })), asyncHandler(adminController.createEndorsement));
apiRouter.put('/admin/endorsements/:id', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams, body: endorsementInput })), asyncHandler(adminController.updateEndorsement));
apiRouter.post('/admin/endorsements/:id/publish', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams, body: z.object({ identityConfirmed: z.literal(true), consentConfirmed: z.literal(true) }).strict() })), asyncHandler(adminController.publishEndorsement));
apiRouter.post('/admin/endorsements/:id/unpublish', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams })), asyncHandler(adminController.unpublishEndorsement));
apiRouter.post('/admin/endorsements/:id/archive', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams })), asyncHandler(adminController.archiveEndorsement));
apiRouter.post('/admin/endorsements/uploads/presign', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ body: z.object({ fileName: z.string().min(1).max(200), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']), size: z.number().int().positive(), category: z.literal('endorsement') }).strict() })), asyncHandler(adminController.presignEndorsementUpload));
apiRouter.get('/admin/overview', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.overview));
apiRouter.get('/admin/product-analytics', authenticate, authorize(UserRole.ADMIN), asyncHandler(productAnalyticsController.list));
apiRouter.get('/admin/product-analytics/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(productAnalyticsController.detail));
apiRouter.get('/admin/search-insights', authenticate, authorize(UserRole.ADMIN), asyncHandler(advancedAnalyticsController.search));
apiRouter.get('/admin/inventory-intelligence', authenticate, authorize(UserRole.ADMIN), asyncHandler(advancedAnalyticsController.inventory));
apiRouter.get('/admin/district-analytics', authenticate, authorize(UserRole.ADMIN), asyncHandler(advancedAnalyticsController.districts));
apiRouter.get('/admin/product-analytics-export.csv', authenticate, authorize(UserRole.ADMIN), asyncHandler(advancedAnalyticsController.csv));
apiRouter.post('/system/analytics/aggregate', optionalSystemKey, authenticate, authorize(UserRole.SYSTEM), asyncHandler(advancedAnalyticsController.aggregate));
apiRouter.get('/admin/orders', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.orders));
apiRouter.post('/admin/orders/:id/correct-status', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({status:z.enum(['PENDING','PACKED','SHIPPED','DELIVERED','RTO','CANCELLED']),reason:z.string().trim().min(5).max(1000)})})), asyncHandler(adminController.correctOrderStatus));
apiRouter.get('/admin/payouts', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.payouts));
apiRouter.post('/admin/payouts/requests/:id/process', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams, body: z.object({}).optional() })), asyncHandler(adminController.processPayoutRequest));
apiRouter.post('/admin/payouts/requests/:id/complete', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams, body: z.object({ settlementReference: z.string().trim().min(4).max(64) }) })), asyncHandler(adminController.completePayoutRequest));
apiRouter.post('/admin/payouts/requests/:id/reject', authenticate, authorize(UserRole.ADMIN), writeLimiter, validate(z.object({ params: idParams, body: z.object({ reason: z.string().trim().min(5).max(500) }) })), asyncHandler(adminController.rejectPayoutRequest));

// The audit trail is an access-control surface, not a report: the rows carry
// previousState/nextState snapshots of team and customer records. The service
// gates it on team:manage, which by default only SUPER_ADMIN holds.
apiRouter.get('/admin/audit-log', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.auditLog));
// Coupons. `percent` crosses the wire as a human percentage (10 = 10%); the
// service converts to the fraction checkout multiplies by, so a UI bug cannot
// write 1000% into the column. Every field is re-validated in admin-coupon.
const couponBody = z.object({code:z.string().min(3).max(24),percent:z.number().positive().max(90),maxDiscount:z.number().positive(),minOrderValue:z.number().min(0),startsAt:z.string(),expiresAt:z.string(),usageLimit:z.number().int().positive().nullable(),perUserLimit:z.number().int().positive(),isActive:z.boolean(),showInCheckoutOffers:z.boolean().default(false),influencerId:z.string().nullable().optional(),commissionRate:z.number().min(0).max(50).nullable().optional()});
apiRouter.get('/admin/reviews', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.reviews));
apiRouter.get('/admin/reviews/counts', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.reviewCounts));
apiRouter.post('/admin/reviews/:id/hide', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({hidden:z.boolean(),reason:z.string().max(500).optional()})})), asyncHandler(adminController.setReviewHidden));
apiRouter.post('/admin/reviews/:id/dismiss-reports', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.dismissReviewReports));
apiRouter.get('/admin/coupons', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.coupons));
apiRouter.post('/admin/coupons', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:couponBody})), asyncHandler(adminController.createCoupon));
apiRouter.put('/admin/coupons/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:couponBody})), asyncHandler(adminController.updateCoupon));
apiRouter.delete('/admin/coupons/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.deleteCoupon));
const influencerBody = z.object({id:z.string().optional(),name:z.string().trim().min(1).max(120),email:z.string().email().nullable().optional(),mobile:z.string().trim().max(32).nullable().optional(),defaultRate:z.number().min(0).max(50),isActive:z.boolean()});
apiRouter.get('/admin/influencers', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.influencers));
apiRouter.post('/admin/influencers', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:influencerBody.omit({id:true})})), asyncHandler(adminController.createInfluencer));
apiRouter.put('/admin/influencers/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:influencerBody.omit({id:true})})), asyncHandler(adminController.updateInfluencer));
apiRouter.get('/admin/influencer-commissions', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.influencerCommissions));
apiRouter.post('/admin/influencer-commissions/:vendorOrderId/refunds', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:z.object({vendorOrderId:z.string().min(1)}),body:z.object({amount:z.number().positive(),requestKey:z.string().trim().min(1).max(120)})})), asyncHandler(adminController.recordInfluencerRefund));
apiRouter.post('/admin/influencer-commissions/settlements', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:z.object({influencerId:z.string().min(1),amount:z.number().positive(),reference:z.string().trim().min(1).max(120),requestKey:z.string().trim().min(1).max(120)})})), asyncHandler(adminController.settleInfluencerCommission));
apiRouter.get('/admin/audit-log/filters', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.auditFilters));
apiRouter.get('/admin/customers', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.customers));
apiRouter.get('/admin/customers/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.customer));
apiRouter.post('/admin/customers/:id/revoke-sessions', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.revokeCustomerSessions));
apiRouter.get('/admin/transactions', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.transactions));
apiRouter.get('/admin/transactions/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.transaction));
apiRouter.get('/admin/notifications', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.notifications));
apiRouter.post('/admin/notifications/read-all', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.markAllNotifications));
apiRouter.post('/admin/notifications/:id/read', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.markNotification));
apiRouter.get('/admin/team', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.team));
apiRouter.get('/admin/permissions', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.permissionMatrix));
apiRouter.put('/admin/permissions', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:z.object({role:z.enum(['OPERATIONS','FINANCE','MARKETING','MODERATOR']),permissions:z.array(z.enum(['analytics:read','analytics:export','orders:manage','payouts:manage','marketing:manage','moderation:manage','haats:manage','shipping:manage','team:manage'])).max(9)})})), asyncHandler(adminController.setRolePermissions));
// SUPER_ADMIN is absent from both team schemas on purpose: it can never be
// disabled or demoted through the API, so one granted here would be permanent.
// admin.service refuses it again — this is the outer of the two gates.
apiRouter.post('/admin/team', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:z.object({email:z.string().email(),role:z.enum(['OPERATIONS','FINANCE','MARKETING','MODERATOR'])})})), asyncHandler(adminController.createTeamMember));
apiRouter.delete('/admin/team/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.removeTeamMember));
apiRouter.patch('/admin/team/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({role:z.enum(['OPERATIONS','FINANCE','MARKETING','MODERATOR']).optional(),isActive:z.boolean().optional()})})), asyncHandler(adminController.updateTeamMember));
apiRouter.get('/admin/haats', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.haats));
apiRouter.get('/admin/categories', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.categories));
apiRouter.post('/admin/categories', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:categoryInput})), asyncHandler(adminController.createCategory));
apiRouter.put('/admin/categories/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:categoryInput})), asyncHandler(adminController.updateCategory));
apiRouter.patch('/admin/categories/:id/active', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({isActive:z.boolean()})})), asyncHandler(adminController.setCategoryActive));
apiRouter.delete('/admin/categories/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.deleteCategory));
apiRouter.post('/admin/haats', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:haatInput})), asyncHandler(adminController.saveHaat));
apiRouter.put('/admin/haats/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:haatInput})), asyncHandler(adminController.saveHaat));
apiRouter.patch('/admin/haats/:id/toggle', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({enabled:z.boolean()})})), asyncHandler(adminController.toggleHaat));
apiRouter.post('/admin/haats/:id/live', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({liveUntil:z.iso.datetime()})})), asyncHandler(adminController.liveHaat));
apiRouter.get('/admin/abandoned-carts', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.abandonedCarts));
apiRouter.post('/admin/abandoned-carts/:id/reminder-opened', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.reminderOpened));
apiRouter.get('/admin/vendor-applications', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.applications));
apiRouter.get('/admin/vendor-applications/:applicationId/documents/:documentId/download', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:z.object({applicationId:z.string().min(1),documentId:z.string().min(1)})})), asyncHandler(adminController.applicationDocument));
apiRouter.post('/admin/vendor-applications/:id/moderate', authenticate, authorize(UserRole.ADMIN), validate(z.object({ params: idParams, body: z.object({ status: z.enum(['APPROVED','REJECTED','HOLD']), reason: z.string().trim().max(1000).optional() }) })), asyncHandler(adminController.moderate));
apiRouter.get('/admin/products/moderation', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.productsForModeration));
apiRouter.get('/admin/tax-products', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.taxProducts));
apiRouter.put('/admin/products/:id/tax', authenticate, authorize(UserRole.ADMIN), validate(z.object({ params: idParams, body: z.object({ hsnCode: z.string().trim().regex(/^\d{4,8}$/), gstRate: z.coerce.number().finite().min(0).max(100) }) })), asyncHandler(adminController.updateProductTax));
apiRouter.post('/admin/products/:id/moderate', authenticate, authorize(UserRole.ADMIN), validate(z.object({ params: idParams, body: z.object({ decision: z.enum(['APPROVE','REJECT','SUSPEND']), reason: z.string().trim().max(1000).optional() }) })), asyncHandler(adminController.moderateProduct));
apiRouter.post('/payouts/escrow/:vendorOrderId/release', authenticate, authorize(UserRole.ADMIN, UserRole.SYSTEM), validate(z.object({ params: payoutParamsSchema })), asyncHandler(payoutController));
