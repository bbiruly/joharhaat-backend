import { z } from 'zod';

export const checkoutHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8).max(128),
});

export const checkoutBodySchema = z.object({
  cartId: z.string().trim().min(1),
  deliveryAddressId: z.string().trim().min(1),
  courierCharge: z.coerce.number().finite().min(0).max(100_000).default(0),
  discountAmount: z.coerce.number().finite().min(0).max(1_000_000).default(0),
  items: z.array(z.object({
    variantId: z.string().trim().min(1),
    quantity: z.coerce.number().int().positive().max(1_000),
  })).min(1).max(100),
}).superRefine((value, context) => {
  const ids = value.items.map((item) => item.variantId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Each variant may appear only once.' });
  }
});

export type CheckoutInput = z.infer<typeof checkoutBodySchema>;
