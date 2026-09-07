import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { checkoutController, checkoutQuoteController } from '../controllers/checkout.controller.js';
import * as authController from '../controllers/auth.controller.js';
import * as customerController from '../controllers/customer.controller.js';
import * as catalogController from '../controllers/catalog.controller.js';
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

export const apiRouter: ExpressRouter = Router();
const searchLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });

/**
 * Credential endpoints are the highest-value target on the API — brute force,
 * credential stuffing and reset-token fishing all land here. Keyed per IP.
 */
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } } });
/** Blanket ceiling for every authenticated write path. */
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again.' } } });
const productInput = z.object({ name: z.string().trim().min(3).max(160), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().min(20).max(3000), artisanStory: z.string().trim().min(40).max(3000).optional(), categoryId: z.string().min(1), district: z.enum(JharkhandDistrict), weeklyHaatDay: z.enum(WeeklyHaatDay), materials: z.string().trim().max(500).optional(), dimensions: z.string().trim().max(200).optional(), careInstructions: z.string().trim().max(1000).optional(), dispatchEstimate: z.string().trim().max(160).optional(), returnPolicy: z.string().trim().max(1000).optional(), submitForReview: z.boolean().optional(), variants: z.array(z.object({ sku: z.string().trim().min(3).max(80), label: z.string().trim().min(1).max(60), price: z.number().positive().max(1_000_000), stock: z.number().int().nonnegative().max(1_000_000) })).min(1).max(25), media: z.array(z.object({ objectKey: z.string().startsWith('product/'), url: z.string().url(), mimeType: z.enum(['image/jpeg','image/png','image/webp']), altText: z.string().trim().min(3).max(200), sortOrder: z.number().int().nonnegative(), isCover: z.boolean(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })).max(8).optional() });
const applicationInput = z.object({ idempotencyKey: z.string().min(8).max(128), ownerName: z.string().trim().min(2).max(100), collectiveName: z.string().trim().min(2).max(160), email: z.string().email(), mobile: z.string().regex(/^[6-9]\d{9}$/), district: z.enum(JharkhandDistrict), category: z.string().min(2).max(80), msmeNumber: z.string().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/), phoneVerified: z.literal(true), aadhaarVerified: z.literal(true), accountHolderName: z.string().min(2).max(100), bankLastFour: z.string().regex(/^\d{4}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), verificationReference: z.string().max(160).optional(), story: z.string().min(80).max(1500), msmeCertificate: z.object({ objectKey: z.string().startsWith('msme/'), fileName: z.string().min(1).max(120), mimeType: z.enum(['application/pdf','image/jpeg','image/png']), size: z.number().int().positive().max(5_000_000) }) });

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
apiRouter.get('/products/:id', validate(z.object({ params: idParams })), asyncHandler(catalogController.product));
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
apiRouter.post('/checkout', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: checkoutBodySchema, headers: checkoutHeadersSchema.passthrough() })), asyncHandler(checkoutController));
apiRouter.post('/payments/intents', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ headers: checkoutHeadersSchema.passthrough(), body: z.object({ orderId: z.string().min(1), method: z.enum(['UPI','CARD','COD']) }) })), asyncHandler(paymentController.createIntent));
apiRouter.post('/payments/intents/:id/confirm', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams, body: z.object({ outcome: z.enum(['success','failure','cancel']) }) })), asyncHandler(paymentController.confirmIntent));
apiRouter.get('/payments/orders/:orderId/state', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({params:z.object({orderId:z.string().min(1)})})), asyncHandler(paymentController.paymentState));
apiRouter.post('/payments/mock-webhook', validate(z.object({body:z.object({userId:z.string().min(1),intentId:z.string().min(1),status:z.enum(['CREATED','PROCESSING','SUCCEEDED','FAILED','CANCELLED','EXPIRED']),eventKey:z.string().min(1).max(200).optional()})})), asyncHandler(paymentController.webhook));

apiRouter.post('/uploads/presign', validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('msme') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.post('/uploads/confirm', validate(z.object({ body: z.object({ objectKey: z.string().min(1) }) })), asyncHandler(vendorController.confirmUpload));
// Any signed-in account may apply. The role is NOT a meaningful gate here:
// vendor.service.submitApplication already requires the caller to have a
// password-protected active account and to match the application's email and
// mobile. Restricting to CUSTOMER only meant an admin (or an existing vendor
// re-checking status) got an opaque 403 "You do not have permission".
apiRouter.post('/vendor-applications', authenticate, writeLimiter, validate(z.object({ body: applicationInput })), asyncHandler(vendorController.submitApplication));
apiRouter.get('/vendor/dashboard', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.dashboard));
apiRouter.post('/vendor/uploads/presign', authenticate, authorize(UserRole.VENDOR), validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('product') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.get('/vendor/products', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.products));
apiRouter.get('/vendor/products/:id', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.product));
apiRouter.post('/vendor/products', authenticate, authorize(UserRole.VENDOR), validate(z.object({ body: productInput })), asyncHandler(vendorController.createProduct));
apiRouter.post('/vendor/products/:id/submit', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.submitProduct));
apiRouter.post('/vendor/products/:id/archive', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.archiveProduct));
apiRouter.patch('/vendor/variants/:id/stock', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams, body: z.object({ stock: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative().optional() }) })), asyncHandler(vendorController.updateStock));
apiRouter.post('/vendor/orders/:id/status', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams, body: z.object({ status: z.enum(['PACKED','SHIPPED','DELIVERED','RTO','CANCELLED']) }) })), asyncHandler(vendorController.transitionOrder));
apiRouter.get('/vendor/orders/:id/shipping-label', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.shippingLabel));
apiRouter.post('/vendor/payout-requests', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.requestPayout));

apiRouter.get('/admin/analytics', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.analytics));
apiRouter.get('/admin/access', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.access));
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

// The audit trail is an access-control surface, not a report: the rows carry
// previousState/nextState snapshots of team and customer records. The service
// gates it on team:manage, which by default only SUPER_ADMIN holds.
apiRouter.get('/admin/audit-log', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.auditLog));
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
apiRouter.put('/admin/permissions', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:z.object({role:z.enum(['OPERATIONS','FINANCE','MARKETING','MODERATOR']),permissions:z.array(z.enum(['analytics:read','analytics:export','orders:manage','payouts:manage','marketing:manage','moderation:manage','haats:manage','team:manage'])).max(8)})})), asyncHandler(adminController.setRolePermissions));
// SUPER_ADMIN is absent from both team schemas on purpose: it can never be
// disabled or demoted through the API, so one granted here would be permanent.
// admin.service refuses it again — this is the outer of the two gates.
apiRouter.post('/admin/team', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:z.object({email:z.string().email(),role:z.enum(['OPERATIONS','FINANCE','MARKETING','MODERATOR'])})})), asyncHandler(adminController.createTeamMember));
apiRouter.delete('/admin/team/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.removeTeamMember));
apiRouter.patch('/admin/team/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({role:z.enum(['OPERATIONS','FINANCE','MARKETING','MODERATOR']).optional(),isActive:z.boolean().optional()})})), asyncHandler(adminController.updateTeamMember));
apiRouter.get('/admin/haats', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.haats));
apiRouter.post('/admin/haats', authenticate, authorize(UserRole.ADMIN), validate(z.object({body:haatInput})), asyncHandler(adminController.saveHaat));
apiRouter.put('/admin/haats/:id', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:haatInput})), asyncHandler(adminController.saveHaat));
apiRouter.patch('/admin/haats/:id/toggle', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({enabled:z.boolean()})})), asyncHandler(adminController.toggleHaat));
apiRouter.post('/admin/haats/:id/live', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams,body:z.object({liveUntil:z.iso.datetime()})})), asyncHandler(adminController.liveHaat));
apiRouter.get('/admin/abandoned-carts', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.abandonedCarts));
apiRouter.post('/admin/abandoned-carts/:id/reminder-opened', authenticate, authorize(UserRole.ADMIN), validate(z.object({params:idParams})), asyncHandler(adminController.reminderOpened));
apiRouter.get('/admin/vendor-applications', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.applications));
apiRouter.post('/admin/vendor-applications/:id/moderate', authenticate, authorize(UserRole.ADMIN), validate(z.object({ params: idParams, body: z.object({ status: z.enum(['APPROVED','REJECTED','HOLD']), reason: z.string().trim().max(1000).optional() }) })), asyncHandler(adminController.moderate));
apiRouter.get('/admin/products/moderation', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.productsForModeration));
apiRouter.post('/admin/products/:id/moderate', authenticate, authorize(UserRole.ADMIN), validate(z.object({ params: idParams, body: z.object({ decision: z.enum(['APPROVE','REJECT','SUSPEND']), reason: z.string().trim().max(1000).optional() }) })), asyncHandler(adminController.moderateProduct));
apiRouter.post('/payouts/escrow/:vendorOrderId/release', authenticate, authorize(UserRole.ADMIN, UserRole.SYSTEM), validate(z.object({ params: payoutParamsSchema })), asyncHandler(payoutController));
