import { z } from 'zod';

export const payoutParamsSchema = z.object({
  vendorOrderId: z.string().trim().min(1),
});
