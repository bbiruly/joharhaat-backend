import { describe, expect, it } from 'vitest';
import type { RequestHandler } from 'express';
import { apiRouter } from '../src/routes/api.js';
import { ApiError } from '../src/utils/api-error.js';

/**
 * Regression cover for "creating a new vendor account fails with ... You do not
 * have permission to perform this action".
 *
 * POST /vendor-applications used to carry `authorize(UserRole.CUSTOMER)`, so a
 * signed-in ADMIN or VENDOR was rejected with a bare 403. The identity checks
 * that actually matter live in vendor.service.submitApplication, not in the
 * role gate.
 *
 * This runs the route's own middleware chain (minus `authenticate`, which needs
 * a real signed token) against a VENDOR request and asserts nothing answers
 * with FORBIDDEN. /cart is the control: it is legitimately customer-only, so it
 * must still reject — which proves the assertion can actually detect a gate.
 */
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { name: string; handle: RequestHandler }[] } };

function postRoute(path: string) {
  const layer = (apiRouter.stack as unknown as Layer[]).find(
    (item) => item.route?.path === path && item.route.methods.post,
  );
  if (!layer?.route) throw new Error(`POST ${path} is not registered`);
  return layer.route;
}

function getRoute(path: string) {
  const layer = (apiRouter.stack as unknown as Layer[]).find(
    (item) => item.route?.path === path && item.route.methods.get,
  );
  if (!layer?.route) throw new Error(`GET ${path} is not registered`);
  return layer.route;
}

/** Runs every handler after `authenticate` and collects the first error raised. */
async function firstError(
  stack: { name: string; handle: RequestHandler }[],
  role: 'CUSTOMER' | 'VENDOR' | 'ADMIN',
) {
  const request = { auth: { userId: 'user_1', role }, body: {}, params: {}, query: {}, header: () => undefined };
  const response = { status: () => response, json: () => response };
  for (const item of stack) {
    if (item.name === 'authenticate') continue;
    let captured: unknown;
    await new Promise<void>((resolve) => {
      const next = (error?: unknown) => {
        captured = error;
        resolve();
      };
      try {
        const result = item.handle(request as never, response as never, next as never);
        if (result instanceof Promise) void result.then(() => resolve()).catch((error) => next(error));
        else if (item.handle.length < 3) resolve();
      } catch (error) {
        next(error);
      }
    });
    if (captured) return captured;
  }
  return undefined;
}

const isForbidden = (error: unknown) =>
  error instanceof ApiError && error.statusCode === 403 && error.code === 'FORBIDDEN';

describe('POST /vendor-applications role gating', () => {
  it('is registered and still requires authentication', () => {
    const route = postRoute('/vendor-applications');
    expect(route.stack[0]?.name).toBe('authenticate');
  });

  it('does not reject a VENDOR with FORBIDDEN', async () => {
    const error = await firstError(postRoute('/vendor-applications').stack, 'VENDOR');
    expect(isForbidden(error)).toBe(false);
  });

  it('does not reject an ADMIN with FORBIDDEN', async () => {
    const error = await firstError(postRoute('/vendor-applications').stack, 'ADMIN');
    expect(isForbidden(error)).toBe(false);
  });

  it('control: GET /cart is still customer-only', async () => {
    const error = await firstError(getRoute('/cart').stack, 'VENDOR');
    expect(isForbidden(error)).toBe(true);
  });
});
