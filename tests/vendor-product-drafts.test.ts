import { describe, expect, it } from 'vitest';
import { assertProductDraftComplete } from '../src/services/vendor.service.js';
import { ApiError } from '../src/utils/api-error.js';

const complete = {
  name: 'Everyday cleanser',
  categoryId: 'admin-category',
  description: 'A gentle everyday cleanser made for regular use at home.',
  variants: [{ sku: 'CLEAN-100', label: '100 g pack', price: 120, stock: 0 }],
  media: [{ objectKey: 'public/product/cleanser.jpg', mimeType: 'image/jpeg', altText: 'Cleanser pack', sortOrder: 0, isCover: true }],
};

describe('vendor product draft submission validation', () => {
  it('allows universal products to submit without artisan story or geographic placement', () => {
    expect(() => assertProductDraftComplete(complete)).not.toThrow();
  });

  it('keeps partial draft data saveable while refusing incomplete final listings', () => {
    expect(() => assertProductDraftComplete({ name: 'New product' })).toThrowError(ApiError);
  });

  it('requires at least one variant and photo at submission', () => {
    expect(() => assertProductDraftComplete({ ...complete, variants: [] })).toThrowError(ApiError);
    expect(() => assertProductDraftComplete({ ...complete, media: [] })).toThrowError(ApiError);
  });

  it('rejects duplicate variant SKUs', () => {
    expect(() => assertProductDraftComplete({
      ...complete,
      variants: [...complete.variants, { ...complete.variants[0], sku: 'clean-100' }],
    })).toThrowError(ApiError);
  });
});
