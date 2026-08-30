import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { checkoutController } from '../controllers/checkout.controller.js';
import { payoutController } from '../controllers/payout.controller.js';
import { productSearchController } from '../controllers/product.controller.js';
import { UserRole } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { checkoutBodySchema, checkoutHeadersSchema } from '../schemas/checkout.schema.js';
import { payoutParamsSchema } from '../schemas/payout.schema.js';
import { productSearchQuerySchema } from '../schemas/product-search.schema.js';
import { asyncHandler } from '../utils/async-handler.js';

export const apiRouter: ExpressRouter = Router();
const searchLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });

apiRouter.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
apiRouter.get('/health/ready', asyncHandler(async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.json({ status: 'ready', database: 'connected' });
}));

apiRouter.get('/products/search', searchLimiter, validate(z.object({ query: productSearchQuerySchema })), asyncHandler(productSearchController));
apiRouter.post('/checkout', authenticate, authorize(UserRole.CUSTOMER), validate(z.object({ body: checkoutBodySchema, headers: checkoutHeadersSchema.passthrough() })), asyncHandler(checkoutController));
apiRouter.post('/payouts/escrow/:vendorOrderId/release', authenticate, authorize(UserRole.ADMIN, UserRole.SYSTEM), validate(z.object({ params: payoutParamsSchema })), asyncHandler(payoutController));
