import { describe, expect, it } from 'vitest';
import { ProductLifecycleStatus } from '../generated/prisma/client.js';
import { assertVariantCanBeRemoved, productEditReviewState } from './vendor.service.js';

describe('vendor product edits', () => {
  it('sends edited live products back to review and hides their changed listing', () => {
    expect(productEditReviewState(ProductLifecycleStatus.APPROVED)).toEqual({
      lifecycleStatus: ProductLifecycleStatus.PENDING_REVIEW,
      isPublished: false,
    });
  });

  it.each([ProductLifecycleStatus.ARCHIVED, ProductLifecycleStatus.SUSPENDED])(
    'blocks editing %s products', (status) => {
      expect(() => productEditReviewState(status)).toThrow('Archived or suspended products cannot be edited.');
    },
  );

  it('prevents removing a variant referenced by orders, carts or reservations', () => {
    expect(() => assertVariantCanBeRemoved({ orderItems: 1, cartItems: 0, reservations: 0 }, 'SOAP-1')).toThrow('SOAP-1 is in use');
    expect(() => assertVariantCanBeRemoved({ orderItems: 0, cartItems: 0, reservations: 0 }, 'SOAP-1')).not.toThrow();
  });
});
