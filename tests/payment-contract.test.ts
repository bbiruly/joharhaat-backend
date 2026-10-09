import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('Razorpay UPI checkout contract', () => {
  const routes = read('../src/routes/api.ts');
  const paymentService = read('../src/services/payment.service.ts');

  it('accepts only UPI intents and exposes verification instead of client outcome confirmation', () => {
    expect(routes).toContain("body: z.object({ orderId: z.string().min(1), method: z.literal('UPI') })");
    expect(routes).toContain("'/payments/intents/:id/verify'");
    expect(routes).not.toContain("'/payments/intents/:id/confirm'");
    expect(paymentService).toContain('if (method !== PaymentMethod.UPI)');
  });

  it('returns only the public Razorpay key and the server-created payment order details', () => {
    const checkoutIntent = paymentService.slice(paymentService.indexOf('function checkoutIntent'), paymentService.indexOf('export async function transitionIntent'));
    expect(checkoutIntent).toContain('razorpayOrderId: intent.providerOrderId');
    expect(checkoutIntent).toContain('razorpayKeyId: env.RAZORPAY_KEY_ID');
    expect(checkoutIntent).toContain("currency: 'INR'");
    expect(checkoutIntent).toContain('amountPaise: rupeesToPaise');
    expect(checkoutIntent).not.toContain('RAZORPAY_KEY_SECRET');
  });

  it('checks provider order, amount, currency and provider status before marking an intent paid', () => {
    const verification = paymentService.slice(paymentService.indexOf('export async function verifyCheckout'), paymentService.indexOf('export async function handleRazorpayWebhook'));
    expect(verification).toContain('intent.providerOrderId !== input.razorpayOrderId');
    expect(verification).toContain('Number(providerPayment.amount) !== rupeesToPaise');
    expect(verification).toContain("providerPayment.currency !== 'INR'");
    expect(verification).toContain("providerPayment.status !== 'captured'");
    expect(verification).toContain('verifyPaymentSignature');
  });

  it('expires stale payment attempts before creating a retry', () => {
    expect(paymentService).toContain('expiresAt: { lte: new Date() }');
    expect(paymentService).toContain('PaymentIntentStatus.EXPIRED');
  });
});
