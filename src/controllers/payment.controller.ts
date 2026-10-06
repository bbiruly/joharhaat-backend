import type { RequestHandler } from 'express';
import { PaymentMethod } from '../generated/prisma/client.js';
import * as payment from '../services/payment.service.js';
import { ApiError } from '../utils/api-error.js';
import { verifyWebhookSignature } from '../services/razorpay.service.js';
import { integrations } from '../config/env.js';

export const createIntent: RequestHandler = async (req, res) => res.status(201).json({ data: await payment.createIntent(req.auth!.userId, req.body.orderId, req.body.method as PaymentMethod, String(req.headers['idempotency-key'])) });
export const verifyIntent: RequestHandler = async (req, res) => res.json({ data: await payment.verifyCheckout(req.auth!.userId, String(req.params.id), req.body) });
export const paymentState: RequestHandler = async (req, res) => res.json({ data: await payment.getPaymentState(req.auth!.userId, String(req.params.orderId)) });
export const webhook: RequestHandler = async (req, res) => { if (!integrations.razorpay) throw new ApiError(503, 'Online payments are not configured in this environment.', 'PAYMENT_PROVIDER_NOT_CONFIGURED'); const signature = String(req.headers['x-razorpay-signature'] ?? ''); if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature)) throw new ApiError(401, 'Webhook signature is invalid.', 'INVALID_WEBHOOK_SIGNATURE'); const eventId = String(req.headers['x-razorpay-event-id'] ?? `razorpay:${req.body?.payload?.payment?.entity?.id}:${req.body?.event}`); res.json({ data: await payment.handleRazorpayWebhook(eventId, req.body) }); };
