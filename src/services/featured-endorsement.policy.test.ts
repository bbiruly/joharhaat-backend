import { describe, expect, it } from 'vitest';
import { assertEndorsementMediaKeys, assertFeaturedEndorsementCanPublish, sortPublicEndorsements, toPublicEndorsement } from './featured-endorsement.policy.js';

describe('featured endorsement policy', () => {
  it('requires identity and media consent confirmation to publish', () => {
    expect(() => assertFeaturedEndorsementCanPublish({ identityConfirmed: false, consentConfirmed: true, imageUrl: '/image.jpg', imageAltText: 'Portrait', videoUrl: null })).toThrow('identity and media consent');
    expect(() => assertFeaturedEndorsementCanPublish({ identityConfirmed: true, consentConfirmed: true, imageUrl: '/image.jpg', imageAltText: 'Portrait', videoUrl: null })).not.toThrow();
  });

  it('requires at least one media asset and alt text for an image', () => {
    expect(() => assertEndorsementMediaKeys({ imageObjectKey: null, imageAltText: null, videoObjectKey: null }, false)).not.toThrow();
    expect(() => assertEndorsementMediaKeys({ imageObjectKey: null, imageAltText: null, videoObjectKey: null })).toThrow('image or video');
    expect(() => assertEndorsementMediaKeys({ imageObjectKey: 'public/endorsement/photo.jpg', imageAltText: null, videoObjectKey: null })).toThrow('alternative text');
    expect(() => assertEndorsementMediaKeys({ imageObjectKey: null, imageAltText: null, videoObjectKey: 'public/endorsement/clip.mp4' })).not.toThrow();
    expect(() => assertEndorsementMediaKeys({ imageObjectKey: 'public/endorsement/photo.jpg', imageAltText: 'Official portrait', videoObjectKey: 'public/endorsement/clip.mp4' })).not.toThrow();
  });

  it('only returns public safe fields for published endorsements', () => {
    const record = { id: 'e1', type: 'GOVERNMENT_OFFICIAL', displayName: 'Name', role: 'Officer', organization: 'Department', quote: 'Feedback', imageUrl: '/image.jpg', imageAltText: 'Portrait', videoUrl: null, displayOrder: 1, status: 'PUBLISHED', imageObjectKey: 'secret-key', confirmedById: 'admin-1' };
    expect(toPublicEndorsement(record)).toEqual({ id: 'e1', type: 'GOVERNMENT_OFFICIAL', displayName: 'Name', role: 'Officer', organization: 'Department', quote: 'Feedback', imageUrl: '/image.jpg', imageAltText: 'Portrait', videoUrl: null, displayOrder: 1 });
    expect(toPublicEndorsement({ ...record, status: 'DRAFT' })).toBeNull();
  });

  it('sorts published records by display order then creation time', () => {
    const earlier = new Date('2026-01-01T00:00:00Z');
    const later = new Date('2026-01-02T00:00:00Z');
    expect(sortPublicEndorsements([{ id: 'later', displayOrder: 1, createdAt: later }, { id: 'first', displayOrder: 0, createdAt: later }, { id: 'second', displayOrder: 1, createdAt: earlier }]).map((item) => item.id)).toEqual(['first', 'second', 'later']);
  });
});
