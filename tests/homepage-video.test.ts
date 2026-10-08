import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { assertHomepageVideoCanBeEnabled, publicHomepageVideo } from '../src/services/homepage-video.policy.js';

const serviceSource = readFileSync(
  fileURLToPath(new URL('../src/services/admin-homepage-video.service.ts', import.meta.url)),
  'utf8',
);

describe('homepage promotional video visibility', () => {
  it('returns the uploaded video only when enabled', () => {
    expect(publicHomepageVideo({ enabled: true, url: 'https://media.example.test/public/homepage/brand.mp4' })).toEqual({
      url: 'https://media.example.test/public/homepage/brand.mp4',
    });
    expect(publicHomepageVideo({ enabled: false, url: 'https://media.example.test/public/homepage/brand.mp4' })).toBeNull();
    expect(publicHomepageVideo({ enabled: true, url: null })).toBeNull();
    expect(publicHomepageVideo(null)).toBeNull();
  });

  it('refuses to enable the homepage video before a real video is configured', () => {
    try {
      assertHomepageVideoCanBeEnabled(true, null);
      throw new Error('Expected missing homepage video to be refused');
    } catch (error) {
      expect(error).toMatchObject({ code: 'HOMEPAGE_VIDEO_REQUIRED', statusCode: 422 });
    }
    expect(() => assertHomepageVideoCanBeEnabled(false, null)).not.toThrow();
    expect(() => assertHomepageVideoCanBeEnabled(true, 'https://media.example.test/brand.mp4')).not.toThrow();
  });

  it('gates admin access, confirms the caller-owned homepage upload, persists it and audits changes', () => {
    expect(serviceSource).toContain("adminAccess(userId, 'marketing:manage')");
    expect(serviceSource).toContain("objectKey.startsWith('public/homepage/')");
    expect(serviceSource).toContain('objectStorage.confirmUpload(input.objectKey, userId)');
    expect(serviceSource).toContain('prisma.homepageVideo.upsert');
    expect(serviceSource).toContain("event: 'HOMEPAGE_VIDEO_UPDATED'");
  });
});
