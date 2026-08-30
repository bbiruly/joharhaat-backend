import { jwtVerify } from 'jose';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
const claimsSchema = z.object({ sub: z.string().min(1), role: z.enum(['CUSTOMER', 'VENDOR', 'ADMIN', 'SYSTEM']) });
const secret = new TextEncoder().encode(env.JWT_SECRET);
export const authenticate: RequestHandler = async (request, _response, next) => { try { const authorization = request.header('authorization'); if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'A Bearer access token is required.', 'AUTH_REQUIRED'); const token = authorization.slice(7); const verified = await jwtVerify(token, secret, { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE }); const claims = claimsSchema.parse(verified.payload); request.auth = { userId: claims.sub, role: claims.role }; next(); } catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'The access token is invalid or expired.', 'INVALID_TOKEN')); } };
