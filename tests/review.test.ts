import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertReviewInput, MAX_RATING, MIN_RATING } from '../src/services/review.service.js';
import { ApiError } from '../src/utils/api-error.js';

const codeOf = (input: Parameters<typeof assertReviewInput>[0]) => {
  try {
    assertReviewInput(input);
    return null;
  } catch (error) {
    return (error as ApiError).code;
  }
};

describe('review input', () => {
  it('accepts a rating with no text — a star alone is a review', () => {
    const result = assertReviewInput({ rating: 5 });
    expect(result.body).toBeNull();
    expect(result.media).toEqual([]);
  });

  it('rejects anything outside 1–5, including fractions', () => {
    for (const rating of [0, 6, -1, 2.5, Number.NaN])
      expect(codeOf({ rating }), String(rating)).toBe('REVIEW_RATING_INVALID');
    expect(codeOf({ rating: MIN_RATING })).toBeNull();
    expect(codeOf({ rating: MAX_RATING })).toBeNull();
  });

  it('trims the body and treats whitespace as no text', () => {
    expect(assertReviewInput({ rating: 4, body: '   ' }).body).toBeNull();
    expect(assertReviewInput({ rating: 4, body: '  lovely  ' }).body).toBe('lovely');
  });

  it('caps the body length', () =>
    expect(codeOf({ rating: 4, body: 'x'.repeat(2001) })).toBe('REVIEW_BODY_TOO_LONG'));

  it('caps the number of photos and rejects a half-uploaded one', () => {
    const photo = { objectKey: 'k', url: 'https://cdn.test/a.jpg', altText: 'a' };
    expect(codeOf({ rating: 4, media: Array.from({ length: 6 }, () => photo) })).toBe(
      'REVIEW_TOO_MANY_PHOTOS',
    );
    expect(codeOf({ rating: 4, media: [{ objectKey: '', url: '', altText: 'a' }] })).toBe(
      'REVIEW_MEDIA_INVALID',
    );
  });
});

/**
 * The entitlement rule is the whole point of the feature, so these assert the
 * shape of the code that enforces it rather than only its inputs. Phase 5
 * removed fabricated "Verified buyer" testimonials; the guarantee that replaces
 * them is that a review cannot exist without a delivered order behind it.
 */
const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/services/${name}`, import.meta.url)), 'utf8');

describe('verified-purchase gate', () => {
  const text = source('review.service.ts');

  it('requires a DELIVERED vendor order containing the product', () => {
    expect(text).toContain('FulfillmentStatus.DELIVERED');
    // Delivery is per vendor order: a multi-vendor basket must not entitle a
    // review for the half that has not arrived.
    expect(text).toContain('vendorOrder.items.some');
    expect(text).toContain('REVIEW_NOT_DELIVERED');
  });

  it('scopes the order lookup to the requesting customer', () =>
    expect(text).toContain('customerId: userId'));

  it('calls the gate before writing a review', () => {
    const create = text.slice(text.indexOf('export async function createReview'));
    const gate = create.indexOf('assertCanReview');
    const write = create.indexOf('prisma.review.create');
    expect(gate).toBeGreaterThan(-1);
    expect(gate, 'the entitlement check must run before the insert').toBeLessThan(write);
  });

  it('never trusts a client-supplied verified flag', () => {
    // `verifiedPurchase` is derived at read time from the fact that the row
    // exists at all. It must not be a column or an input field.
    expect(text).toContain('verifiedPurchase: true');
    // Exactly once, as a literal. Anything else would mean it is being read
    // from a column or copied off the request.
    expect(text.match(/verifiedPurchase/g)).toHaveLength(1);
    expect(text).not.toContain('input.verifiedPurchase');
  });

  it('excludes hidden reviews from the public average', () => {
    const rating = text.slice(text.indexOf('export async function ratingFor'));
    expect(rating).toContain('isHidden: false');
    // A product with no reviews has no rating; 0 would read as a terrible one.
    expect(rating).toContain('=== null ? null');
  });
});

describe('review moderation', () => {
  const text = source('admin-review.service.ts');

  it('hides rather than deletes, and records who and why', () => {
    expect(text).toContain('isHidden: true');
    expect(text).toContain('hiddenById: userId');
    expect(text).not.toContain('review.delete(');
    expect(text).not.toContain('review.deleteMany');
    // Dismissing reports does delete the reports — they exist only to raise the
    // flag, and keeping them would keep re-raising it. The review stays.
    expect(text).toContain('reviewReport.deleteMany');
  });

  it('requires a reason before hiding', () => expect(text).toContain('REASON_REQUIRED'));

  it('gates moderation on moderation:manage', () =>
    expect(text).toContain("const MODERATE_PERMISSION = 'moderation:manage' as const"));
});
