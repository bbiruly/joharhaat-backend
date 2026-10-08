import 'dotenv/config';
import { z } from 'zod';
const disabled = {
  RAZORPAY_KEY_ID: 'razorpay-not-configured', RAZORPAY_KEY_SECRET: 'razorpay-secret-not-configured', RAZORPAY_WEBHOOK_SECRET: 'razorpay-webhook-not-configured',
  AWS_REGION: 'ap-south-1', AWS_S3_BUCKET: 's3-not-configured', AWS_CLOUDFRONT_DOMAIN: 'cdn-not-configured',
  RESEND_API_KEY: 'resend-not-configured', RESEND_WEBHOOK_SECRET: 'resend-webhook-not-configured', EMAIL_FROM: 'JoharHaat <noreply@example.invalid>', EMAIL_REPLY_TO: 'support@example.invalid', FRONTEND_BASE_URL: 'http://localhost:3000',
} as const;
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'), PORT: z.coerce.number().int().min(1).max(65535).default(4000), DATABASE_URL: z.string().min(1), DIRECT_URL: z.string().min(1), JWT_SECRET: z.string().min(32), JWT_ISSUER: z.string().default('joharhaat-api'), JWT_AUDIENCE: z.string().default('joharhaat-web'), ACCESS_TOKEN_TTL: z.string().default('15m'), REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30), PASSWORD_RESET_MINUTES: z.coerce.number().int().positive().default(30), COOKIE_SECURE: z.string().default('false').transform((value) => value === 'true'), CORS_ORIGINS: z.string().default('http://localhost:3000'), ADMIN_COMMISSION_RATE: z.coerce.number().min(0).max(1).default(0.1), CGST_RATE: z.coerce.number().min(0).max(1).default(0.025), SGST_RATE: z.coerce.number().min(0).max(1).default(0.025), LOW_STOCK_THRESHOLD: z.coerce.number().int().positive().default(5), DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(20), MAX_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(100), SMS_PROVIDER: z.enum(['mock']).default('mock'), SMS_FROM: z.string().default('JOHARHAAT'), SYSTEM_API_KEY: z.string().min(32).optional(), ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(), LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PAYMENT_PROVIDER: z.enum(['razorpay']).default('razorpay'), RAZORPAY_KEY_ID: z.string().min(1).default(disabled.RAZORPAY_KEY_ID), RAZORPAY_KEY_SECRET: z.string().min(8).default(disabled.RAZORPAY_KEY_SECRET), RAZORPAY_WEBHOOK_SECRET: z.string().min(8).default(disabled.RAZORPAY_WEBHOOK_SECRET),
  AWS_REGION: z.string().min(1).default(disabled.AWS_REGION), AWS_ACCESS_KEY_ID: z.string().min(1).optional(), AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(), AWS_S3_BUCKET: z.string().min(3).default(disabled.AWS_S3_BUCKET), AWS_CLOUDFRONT_DOMAIN: z.string().min(1).default(disabled.AWS_CLOUDFRONT_DOMAIN),
  RESEND_API_KEY: z.string().min(1).default(disabled.RESEND_API_KEY), RESEND_WEBHOOK_SECRET: z.string().min(1).default(disabled.RESEND_WEBHOOK_SECRET), EMAIL_FROM: z.string().min(3).default(disabled.EMAIL_FROM), EMAIL_REPLY_TO: z.string().email().default(disabled.EMAIL_REPLY_TO), FRONTEND_BASE_URL: z.string().url().default(disabled.FRONTEND_BASE_URL),
}).superRefine((value, context) => {
  if (Boolean(value.AWS_ACCESS_KEY_ID) !== Boolean(value.AWS_SECRET_ACCESS_KEY)) context.addIssue({ code: 'custom', path: ['AWS_SECRET_ACCESS_KEY'], message: 'must be set together with AWS_ACCESS_KEY_ID' });
  if (value.NODE_ENV !== 'production') return;
  for (const [key, fallback] of Object.entries(disabled)) if (value[key as keyof typeof value] === fallback) context.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
});
export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(`Invalid environment configuration: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return result.data;
}
export const env = parseEnvironment(process.env);
export const integrations = { razorpay: env.RAZORPAY_KEY_ID !== disabled.RAZORPAY_KEY_ID, storage: env.AWS_S3_BUCKET !== disabled.AWS_S3_BUCKET && env.AWS_CLOUDFRONT_DOMAIN !== disabled.AWS_CLOUDFRONT_DOMAIN, resend: env.RESEND_API_KEY !== disabled.RESEND_API_KEY } as const;
