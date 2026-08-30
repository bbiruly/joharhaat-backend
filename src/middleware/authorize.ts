import type { RequestHandler } from 'express';
import type { UserRole } from '../generated/prisma/client.js';
import { ApiError } from '../utils/api-error.js';
export const authorize = (...roles: UserRole[]): RequestHandler => (request, _response, next) => { if (!request.auth) return next(new ApiError(401, 'Authentication is required.', 'AUTH_REQUIRED')); if (!roles.includes(request.auth.role)) return next(new ApiError(403, 'You do not have permission to perform this action.', 'FORBIDDEN')); next(); };
