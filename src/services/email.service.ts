import { Resend } from 'resend';
import { env, integrations } from '../config/env.js';
import { prisma } from '../db/prisma.js';

type Template = 'password-reset' | 'order-paid' | 'payment-failed' | 'vendor-new-order';
type Payload = Record<string, unknown>;
const resend = new Resend(env.RESEND_API_KEY);
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]!);

export function renderEmail(template: Template, payload: Payload) {
  const name = escape(payload.name || 'Customer');
  if (template === 'password-reset') {
    const url = `${env.FRONTEND_BASE_URL.replace(/\/$/, '')}/account?mode=reset&resetToken=${encodeURIComponent(String(payload.token))}`;
    return { subject: 'Reset your JoharHaat password', html: `<p>Johar ${name},</p><p><a href="${url}">Reset your password</a>. This link expires in ${escape(payload.expiresMinutes)} minutes.</p>`, text: `Johar ${String(payload.name || 'Customer')}, reset your password: ${url}. This link expires in ${payload.expiresMinutes} minutes.` };
  }
  if (template === 'order-paid') return { subject: `Payment confirmed for ${escape(payload.orderNumber)}`, html: `<p>Johar ${name},</p><p>Your payment for order ${escape(payload.orderNumber)} is confirmed.</p>`, text: `Payment for order ${payload.orderNumber} is confirmed.` };
  if (template === 'payment-failed') return { subject: `Payment needs attention for ${escape(payload.orderNumber)}`, html: `<p>Johar ${name},</p><p>Your payment was not completed. You can safely retry from your order page.</p>`, text: `Payment for ${payload.orderNumber} was not completed. You can safely retry.` };
  return { subject: `New JoharHaat order ${escape(payload.orderNumber)}`, html: `<p>Johar ${name},</p><p>You have a new order ${escape(payload.orderNumber)}.</p>`, text: `You have a new JoharHaat order ${payload.orderNumber}.` };
}

export async function dispatchEmailOutbox(limit = 50) {
  if (!integrations.resend) return 0;
  await prisma.emailOutbox.updateMany({ where: { status: 'PROCESSING', updatedAt: { lte: new Date(Date.now() - 10 * 60_000) }, terminalAt: null }, data: { status: 'FAILED', lastError: 'Worker lease expired before completion.' } });
  const jobs = await prisma.emailOutbox.findMany({ where: { status: { in: ['PENDING','FAILED'] }, terminalAt: null, nextAttemptAt: { lte: new Date() }, attempts: { lt: 5 } }, take: limit, orderBy: { createdAt: 'asc' } });
  for (const job of jobs) {
    const claimed = await prisma.emailOutbox.updateMany({ where: { id: job.id, status: { in: ['PENDING','FAILED'] } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null } });
    if (!claimed.count) continue;
    try {
      const rendered = renderEmail(job.template as Template, job.payload as Payload);
      const result = await resend.emails.send({ from: env.EMAIL_FROM, to: job.recipient, replyTo: env.EMAIL_REPLY_TO, ...rendered }, { idempotencyKey: `email-outbox/${job.id}` });
      if (result.error || !result.data?.id) throw new Error(result.error?.message ?? 'Resend did not return a message id.');
      await prisma.emailOutbox.update({ where: { id: job.id }, data: { status: 'SENT', providerMessageId: result.data.id, processedAt: new Date() } });
    } catch (error) {
      const attempts = job.attempts + 1;
      await prisma.emailOutbox.update({ where: { id: job.id }, data: { status: 'FAILED', lastError: error instanceof Error ? error.message.slice(0,500) : 'Email delivery failed', nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** attempts) + Math.floor(Math.random() * 5000)), ...(attempts >= 5 ? { terminalAt: new Date() } : {}) } });
    }
  }
  return jobs.length;
}

export function verifyResendWebhook(payload: string, headers: { id: string; timestamp: string; signature: string }) {
  return resend.webhooks.verify({ payload, headers, webhookSecret: env.RESEND_WEBHOOK_SECRET });
}
