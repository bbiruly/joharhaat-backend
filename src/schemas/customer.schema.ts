import { JharkhandDistrict } from '../generated/prisma/client.js';
import { z } from 'zod';
import { emailSchema, mobileSchema } from './auth.schema.js';

export const profileSchema = z.object({ name: z.string().trim().min(2).max(100), email: emailSchema, mobile: mobileSchema });
export const addressSchema = z.object({ label: z.string().trim().min(1).max(30), fullName: z.string().trim().min(2).max(100), mobile: mobileSchema, line1: z.string().trim().min(5).max(200), line2: z.string().trim().max(200).optional(), landmark: z.string().trim().max(120).optional(), district: z.enum(JharkhandDistrict), postalCode: z.string().regex(/^\d{6}$/), isDefault: z.boolean().default(false) });
export const cartItemSchema = z.object({ variantId: z.string().min(1), quantity: z.coerce.number().int().min(1).max(100) });
export const quantitySchema = z.object({ quantity: z.coerce.number().int().min(1).max(100) });
export const idParams = z.object({ id: z.string().min(1) });
