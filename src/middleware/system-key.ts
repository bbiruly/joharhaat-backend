import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UserRole } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

/**
 * Shared-secret auth for machine callers — cron, schedulers, another service.
 *
 * This is the one place a static key belongs. A key shipped to a browser is
 * readable by anyone who opens devtools, so it protects nothing there; a key
 * held by a server the operator controls is a real credential. Browser traffic
 * keeps using the JWT.
 *
 * Composes in front of `authenticate`: with no `x-api-key` header this falls
 * straight through and the normal token chain runs, so a caller holding a
 * SYSTEM session still works. With a header present the key must be valid —
 * a wrong key fails here as a clear 401 rather than becoming a confusing 403
 * from the role gate below.
 */
function matches(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Constant-time compare, so the response timing cannot be used to guess the
  // key byte by byte. Lengths must agree first — timingSafeEqual throws if not.
  return a.length === b.length && timingSafeEqual(a, b);
}

export const optionalSystemKey: RequestHandler = (request, _response, next) => {
  const provided = request.header('x-api-key');
  if (!provided) return next();

  if (!env.SYSTEM_API_KEY)
    return next(new ApiError(503, 'Machine access is not configured.', 'SYSTEM_KEY_UNSET'));
  if (!matches(provided, env.SYSTEM_API_KEY))
    return next(new ApiError(401, 'The machine API key is invalid.', 'INVALID_SYSTEM_KEY'));

  request.auth = { userId: 'system', role: UserRole.SYSTEM };
  next();
};
