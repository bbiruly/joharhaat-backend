import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';

export function rupeesToPaise(value: string | number): number {
  const [whole, fraction = ''] = String(value).split('.');
  const paise = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new Error('Payment amount is invalid.');
  return paise;
}

export function createPaymentSignature(orderId: string, paymentId: string, secret = env.RAZORPAY_KEY_SECRET) {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret = env.RAZORPAY_KEY_SECRET) {
  const expected = Buffer.from(createPaymentSignature(orderId, paymentId, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function verifyWebhookSignature(body: Buffer, signature: string) {
  const expected = Buffer.from(createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex'), 'hex');
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const razorpay = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
