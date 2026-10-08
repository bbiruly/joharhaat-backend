import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { verifyResendWebhook } from '../services/email.service.js';
import { integrations } from '../config/env.js';

export const resendWebhook: RequestHandler = async (req, res) => {
  if (!integrations.resend) throw new ApiError(503, 'Email delivery is not configured in this environment.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  if (!req.rawBody) throw new ApiError(400, 'Webhook body is missing.', 'INVALID_WEBHOOK');
  let event: any;
  try {
    event = await verifyResendWebhook(req.rawBody.toString('utf8'), { id: String(req.headers['svix-id'] ?? ''), timestamp: String(req.headers['svix-timestamp'] ?? ''), signature: String(req.headers['svix-signature'] ?? '') });
  } catch { throw new ApiError(401, 'Webhook signature is invalid.', 'INVALID_WEBHOOK_SIGNATURE'); }
  const messageId = event?.data?.email_id;
  if (messageId && ['email.bounced','email.complained'].includes(event.type)) await prisma.emailOutbox.updateMany({ where: { providerMessageId: messageId }, data: { status: 'FAILED', terminalAt: new Date(), lastError: event.type } });
  res.json({ data: { accepted: true } });
};
