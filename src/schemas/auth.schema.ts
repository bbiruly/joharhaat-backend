import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const mobileSchema = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.');
export const passwordSchema = z.string().min(10).max(128).regex(/[A-Z]/, 'Password requires an uppercase letter.').regex(/[a-z]/, 'Password requires a lowercase letter.').regex(/\d/, 'Password requires a number.');
export const registerSchema = z.object({ name: z.string().trim().min(2).max(100), email: emailSchema, mobile: mobileSchema, password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(32).max(256), password: passwordSchema });
