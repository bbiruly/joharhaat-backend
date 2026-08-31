import type { RequestHandler } from 'express';
import { PaymentIntentStatus, PaymentMethod } from '../generated/prisma/client.js';
import * as payment from '../services/payment.service.js';
import { ApiError } from '../utils/api-error.js';

export const createIntent: RequestHandler = async (req, res) => res.status(201).json({ data: await payment.createIntent(req.auth!.userId, req.body.orderId, req.body.method as PaymentMethod, String(req.headers['idempotency-key'])) });
export const confirmIntent: RequestHandler = async (req, res) => res.json({ data: await payment.transitionIntent(req.auth!.userId, String(req.params.id), req.body.outcome === 'success' ? PaymentIntentStatus.SUCCEEDED : req.body.outcome === 'failure' ? PaymentIntentStatus.FAILED : PaymentIntentStatus.CANCELLED) });
export const webhook: RequestHandler = async (req, res) => { const signature = String(req.headers['x-mock-signature'] ?? ''); const payload = JSON.stringify(req.body); if (!payment.verifyWebhook(payload, signature)) throw new ApiError(401, 'Webhook signature is invalid.', 'INVALID_WEBHOOK_SIGNATURE'); res.json({ data: await payment.transitionIntent(req.body.userId, req.body.intentId, req.body.status, req.body.eventKey) }); };
