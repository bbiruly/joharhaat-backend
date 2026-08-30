import type { RequestHandler } from 'express';
import type { CheckoutInput } from '../schemas/checkout.schema.js';
import { processCheckout } from '../services/checkout.service.js';
import { dispatchVendorSmsOutbox } from '../services/sms.service.js';

export const checkoutController: RequestHandler = async (request, response) => {
  const idempotencyKey = request.headers['idempotency-key'] as string;
  const result = await processCheckout(request.auth!.userId, idempotencyKey, request.body as CheckoutInput);
  if (result.outboxIds.length) void dispatchVendorSmsOutbox(result.outboxIds).catch((error) => request.log.error({ error }, 'SMS outbox dispatch failed'));
  response.status(result.replayed ? 200 : 201).json({ data: result.order, meta: { replayed: result.replayed } });
};
