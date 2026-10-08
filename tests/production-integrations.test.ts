import { describe, expect, it } from 'vitest';
import { createPaymentSignature, rupeesToPaise, verifyPaymentSignature } from '../src/services/razorpay.service.js';
import { objectKeyFor, validateUpload } from '../src/services/storage.service.js';
import { renderEmail } from '../src/services/email.service.js';
import { parseEnvironment } from '../src/config/env.js';

const baseEnv = { DATABASE_URL: 'postgresql://test:test@localhost/test', DIRECT_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'a-test-secret-that-is-at-least-32-characters' };

describe('integration environment', () => {
  it('boots development without production provider credentials', () => {
    const configured = parseEnvironment({ ...baseEnv, NODE_ENV: 'development' });
    expect(configured.AWS_S3_BUCKET).toBe('s3-not-configured');
    expect(configured.AWS_CLOUDFRONT_DOMAIN).toBe('cdn-not-configured');
  });

  it('uses only the AWS asset variable names used by JoharXP', () => {
    const configured = parseEnvironment({
      ...baseEnv,
      AWS_S3_BUCKET: 'assets-bucket',
      AWS_CLOUDFRONT_DOMAIN: 'cdn.example.com',
      S3_BUCKET: 'stale-bucket',
      CLOUDFRONT_BASE_URL: 'https://stale.example.com',
    });
    expect(configured.AWS_S3_BUCKET).toBe('assets-bucket');
    expect(configured.AWS_CLOUDFRONT_DOMAIN).toBe('cdn.example.com');
    expect(configured).not.toHaveProperty('S3_BUCKET');
    expect(configured).not.toHaveProperty('CLOUDFRONT_BASE_URL');
  });

  it('requires static AWS access key credentials as a pair', () => {
    expect(() => parseEnvironment({ ...baseEnv, AWS_ACCESS_KEY_ID: 'configured' })).toThrow('AWS_SECRET_ACCESS_KEY: must be set together');
  });

  it('requires every provider credential in production', () => {
    expect(() => parseEnvironment({ ...baseEnv, NODE_ENV: 'production' })).toThrow('RAZORPAY_KEY_ID: is required in production');
  });
});

describe('Razorpay primitives', () => {
  it('converts decimal rupees to integer paise without float drift', () => {
    expect(rupeesToPaise('123.45')).toBe(12345);
  });

  it('accepts only an authentic checkout signature', () => {
    const signature = createPaymentSignature('order_1', 'pay_1', 'secret');
    expect(verifyPaymentSignature('order_1', 'pay_1', signature, 'secret')).toBe(true);
    expect(verifyPaymentSignature('order_1', 'pay_2', signature, 'secret')).toBe(false);
  });
});

describe('S3 upload policy', () => {
  it('keeps KYC private and media under public prefixes', () => {
    expect(objectKeyFor('msme', 'certificate.pdf')).toMatch(/^private\/msme\/[a-f0-9-]+\.pdf$/);
    expect(objectKeyFor('product', 'photo.webp')).toMatch(/^public\/product\/[a-f0-9-]+\.webp$/);
  });

  it('rejects PDFs for review media', () => {
    expect(() => validateUpload({ category: 'review', mimeType: 'application/pdf', size: 100 })).toThrow();
  });
});

describe('email templates', () => {
  it('escapes customer data and creates a password reset link', () => {
    const email = renderEmail('password-reset', { token: 'abc', expiresMinutes: 30, name: '<Admin>' });
    expect(email.html).toContain('&lt;Admin&gt;');
    expect(email.html).toContain('resetToken=abc');
    expect(email.text).toContain('30 minutes');
  });
});
