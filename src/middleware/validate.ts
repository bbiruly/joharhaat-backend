import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../utils/api-error.js';
export const validate = (schema: ZodType): RequestHandler => (request, _response, next) => { const result = schema.safeParse({ body: request.body, params: request.params, query: request.query, headers: request.headers }); if (!result.success) return next(new ApiError(400, 'Request validation failed.', 'VALIDATION_ERROR', result.error.flatten())); const value = result.data as { body?: unknown; params?: unknown; query?: unknown }; if (value.body !== undefined) request.body = value.body; if (value.params !== undefined) Object.assign(request.params, value.params); if (value.query !== undefined) Object.assign(request.query, value.query); next(); };
