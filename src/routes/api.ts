import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { checkoutController } from '../controllers/checkout.controller.js';
import * as authController from '../controllers/auth.controller.js';
import * as customerController from '../controllers/customer.controller.js';
import * as catalogController from '../controllers/catalog.controller.js';
import * as paymentController from '../controllers/payment.controller.js';
import * as vendorController from '../controllers/vendor.controller.js';
import * as adminController from '../controllers/admin.controller.js';
import { payoutController } from '../controllers/payout.controller.js';
import { productSearchController } from '../controllers/product.controller.js';
import { JharkhandDistrict, UserRole, WeeklyHaatDay } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { checkoutBodySchema, checkoutHeadersSchema } from '../schemas/checkout.schema.js';
import { payoutParamsSchema } from '../schemas/payout.schema.js';
import { productSearchQuerySchema } from '../schemas/product-search.schema.js';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '../schemas/auth.schema.js';
import { addressSchema, cartItemSchema, idParams, profileSchema, quantitySchema } from '../schemas/customer.schema.js';
import { asyncHandler } from '../utils/async-handler.js';

export const apiRouter: ExpressRouter = Router();
const searchLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const productInput = z.object({ name: z.string().trim().min(3).max(160), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().min(20).max(3000), artisanStory: z.string().trim().min(40).max(3000).optional(), categoryId: z.string().min(1), district: z.enum(JharkhandDistrict), weeklyHaatDay: z.enum(WeeklyHaatDay), variants: z.array(z.object({ sku: z.string().trim().min(3).max(80), label: z.string().trim().min(1).max(60), price: z.number().positive().max(1_000_000), stock: z.number().int().nonnegative().max(1_000_000) })).min(1).max(25) });
const applicationInput = z.object({ idempotencyKey: z.string().min(8).max(128), ownerName: z.string().trim().min(2).max(100), collectiveName: z.string().trim().min(2).max(160), email: z.string().email(), mobile: z.string().regex(/^[6-9]\d{9}$/), district: z.enum(JharkhandDistrict), category: z.string().min(2).max(80), msmeNumber: z.string().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/), phoneVerified: z.literal(true), aadhaarVerified: z.literal(true), accountHolderName: z.string().min(2).max(100), bankLastFour: z.string().regex(/^\d{4}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), verificationReference: z.string().max(160).optional(), story: z.string().min(80).max(1500), msmeCertificate: z.object({ objectKey: z.string().startsWith('msme/'), fileName: z.string().min(1).max(120), mimeType: z.enum(['application/pdf','image/jpeg','image/png']), size: z.number().int().positive().max(5_000_000) }) });

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

apiRouter.post('/auth/register', validate(z.object({ body: registerSchema })), asyncHandler(authController.registerController));
apiRouter.post('/auth/login', validate(z.object({ body: loginSchema })), asyncHandler(authController.loginController));
apiRouter.post('/auth/refresh', asyncHandler(authController.refreshController));
apiRouter.post('/auth/logout', asyncHandler(authController.logoutController));
apiRouter.post('/auth/revoke-all', authenticate, asyncHandler(authController.revokeAllController));
apiRouter.post('/auth/forgot-password', validate(z.object({ body: forgotPasswordSchema })), asyncHandler(authController.forgotPasswordController));
apiRouter.post('/auth/reset-password', validate(z.object({ body: resetPasswordSchema })), asyncHandler(authController.resetPasswordController));

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
apiRouter.get('/wishlist', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(customerController.wishlist));
apiRouter.post('/wishlist/:id/toggle', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams })), asyncHandler(customerController.toggleWishlist));
apiRouter.get('/orders', authenticate, authorize(UserRole.CUSTOMER), asyncHandler(customerController.orders));
apiRouter.get('/orders/:id', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams })), asyncHandler(customerController.order));

apiRouter.post('/checkout', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: checkoutBodySchema, headers: checkoutHeadersSchema.passthrough() })), asyncHandler(checkoutController));
apiRouter.post('/payments/intents', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ headers: checkoutHeadersSchema.passthrough(), body: z.object({ orderId: z.string().min(1), method: z.enum(['UPI','CARD','COD']) }) })), asyncHandler(paymentController.createIntent));
apiRouter.post('/payments/intents/:id/confirm', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ params: idParams, body: z.object({ outcome: z.enum(['success','failure','cancel']) }) })), asyncHandler(paymentController.confirmIntent));
apiRouter.post('/payments/mock-webhook', asyncHandler(paymentController.webhook));

apiRouter.post('/uploads/presign', validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('msme') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.post('/uploads/confirm', validate(z.object({ body: z.object({ objectKey: z.string().min(1) }) })), asyncHandler(vendorController.confirmUpload));
apiRouter.post('/vendor-applications', validate(z.object({ body: applicationInput })), asyncHandler(vendorController.submitApplication));
apiRouter.get('/vendor/dashboard', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.dashboard));
apiRouter.post('/vendor/uploads/presign', authenticate, authorize(UserRole.VENDOR), validate(z.object({ body: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive(), category: z.literal('product') }) })), asyncHandler(vendorController.presignUpload));
apiRouter.post('/vendor/products', authenticate, authorize(UserRole.VENDOR), validate(z.object({ body: productInput })), asyncHandler(vendorController.createProduct));
apiRouter.patch('/vendor/variants/:id/stock', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams, body: z.object({ stock: z.number().int().nonnegative() }) })), asyncHandler(vendorController.updateStock));
apiRouter.post('/vendor/orders/:id/status', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams, body: z.object({ status: z.enum(['PACKED','SHIPPED','DELIVERED','RTO','CANCELLED']) }) })), asyncHandler(vendorController.transitionOrder));
apiRouter.get('/vendor/orders/:id/shipping-label', authenticate, authorize(UserRole.VENDOR), validate(z.object({ params: idParams })), asyncHandler(vendorController.shippingLabel));
apiRouter.post('/vendor/payout-requests', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorController.requestPayout));

apiRouter.get('/admin/analytics', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.analytics));
apiRouter.get('/admin/haats', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.haats));
apiRouter.post('/admin/haats', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.saveHaat));
apiRouter.put('/admin/haats/:id', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.saveHaat));
apiRouter.patch('/admin/haats/:id/toggle', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.toggleHaat));
apiRouter.post('/admin/haats/:id/live', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.liveHaat));
apiRouter.get('/admin/abandoned-carts', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.abandonedCarts));
apiRouter.post('/admin/abandoned-carts/:id/reminder-opened', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.reminderOpened));
apiRouter.get('/admin/vendor-applications', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.applications));
apiRouter.post('/admin/vendor-applications/:id/moderate', authenticate, authorize(UserRole.ADMIN), asyncHandler(adminController.moderate));
apiRouter.post('/payouts/escrow/:vendorOrderId/release', authenticate, authorize(UserRole.ADMIN, UserRole.SYSTEM), validate(z.object({ params: payoutParamsSchema })), asyncHandler(payoutController));
