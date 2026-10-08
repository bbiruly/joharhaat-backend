import { describe, expect, it } from 'vitest';
import {
  buildPublicCatalogProductWhere,
  type PublicCatalogVariantFilter,
} from '../src/services/product-search.service.js';
import { productSearchQuerySchema } from '../src/schemas/product-search.schema.js';

describe('product search validation', () => {
  it('coerces pagination and price filters', () => expect(productSearchQuerySchema.parse({ page: '2', pageSize: '25', minPrice: '100' })).toMatchObject({ page: 2, pageSize: 25, minPrice: 100 }));
  it('rejects inverted price ranges', () => expect(() => productSearchQuerySchema.parse({ minPrice: '500', maxPrice: '100' })).toThrow());
  it('rejects unsupported districts', () => expect(() => productSearchQuerySchema.parse({ district: 'DELHI' })).toThrow());
});

describe('public catalog visibility', () => {
  const activeVariant: PublicCatalogVariantFilter = { isActive: true };

  it('includes published products with active zero-stock variants', () => {
    const where = buildPublicCatalogProductWhere(activeVariant);
    expect(where.isPublished).toBe(true);
    expect(where.variants).toEqual({ some: { isActive: true } });
  });

  it('continues excluding products without an active variant', () => {
    const where = buildPublicCatalogProductWhere(activeVariant);
    expect(where.variants).toEqual({ some: { isActive: true } });
  });

  it('continues excluding unpublished products and unverified vendors', () => {
    const where = buildPublicCatalogProductWhere(activeVariant);
    expect(where.isPublished).toBe(true);
    expect(where.vendor).toEqual({ verificationStatus: 'VERIFIED' });
  });
});
