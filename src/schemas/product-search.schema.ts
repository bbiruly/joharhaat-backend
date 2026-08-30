import { JharkhandDistrict, WeeklyHaatDay } from '../generated/prisma/client.js';
import { z } from 'zod';

const optionalMoney = z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.coerce.number().finite().min(0).optional());

export const productSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  minPrice: optionalMoney,
  maxPrice: optionalMoney,
  district: z.enum(JharkhandDistrict).optional(),
  haatDay: z.enum(WeeklyHaatDay).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(20),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).default('relevance'),
}).superRefine((value, context) => {
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    context.addIssue({ code: 'custom', path: ['maxPrice'], message: 'maxPrice must be greater than or equal to minPrice.' });
  }
});

export type ProductSearchInput = z.infer<typeof productSearchQuerySchema>;
