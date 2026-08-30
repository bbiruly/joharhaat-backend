import { describe, expect, it } from 'vitest';
import { productSearchQuerySchema } from '../src/schemas/product-search.schema.js';

describe('product search validation', () => {
  it('coerces pagination and price filters', () => expect(productSearchQuerySchema.parse({ page: '2', pageSize: '25', minPrice: '100' })).toMatchObject({ page: 2, pageSize: 25, minPrice: 100 }));
  it('rejects inverted price ranges', () => expect(() => productSearchQuerySchema.parse({ minPrice: '500', maxPrice: '100' })).toThrow());
  it('rejects unsupported districts', () => expect(() => productSearchQuerySchema.parse({ district: 'DELHI' })).toThrow());
});
