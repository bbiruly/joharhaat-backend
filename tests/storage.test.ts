import { describe, expect, it } from 'vitest';
import { cloudFrontBaseUrl, credentialsFromEnvironment, objectKeyFor, presignedUploadHeaders, storageSigningError, validateUpload } from '../src/services/storage.service.js';

describe('S3 object storage policy', () => {
  it('creates a private KYC object key', () => expect(objectKeyFor('msme', 'certificate.pdf')).toMatch(/^private\/msme\//));
  it('accepts bounded MP4 and WebM homepage videos and puts them in a separate public prefix', () => {
    expect(() => validateUpload({ mimeType: 'video/mp4', size: 99_000_000, category: 'homepage' })).not.toThrow();
    expect(objectKeyFor('homepage', 'brand-film.mp4')).toMatch(/^public\/homepage\/[a-f0-9-]+\.mp4$/);
  });
  it('rejects unsupported, oversized homepage video and video uploads in other categories', () => {
    for (const input of [
      { mimeType: 'video/quicktime', size: 10, category: 'homepage' as const },
      { mimeType: 'video/mp4', size: 100_000_001, category: 'homepage' as const },
      { mimeType: 'video/mp4', size: 10, category: 'msme' as const },
      { mimeType: 'video/webm', size: 10, category: 'product' as const },
    ]) expect(() => validateUpload(input)).toThrow('allowed format');
  });
  it('rejects unsafe or oversized uploads', () => expect(() => validateUpload({ mimeType: 'application/octet-stream', size: 10, category: 'msme' })).toThrow('allowed format'));
  it('maps signer configuration failures to a safe actionable service error', () => {
    const error = storageSigningError(new Error('private credential provider details'));
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('STORAGE_SIGNING_UNAVAILABLE');
    expect(error.message).toContain('AWS credentials');
    expect(error.message).not.toContain('private credential provider details');
    expect(error.cause).toBeInstanceOf(Error);
  });
  it('uses the earlier backend access-key variables when both values are configured', () => {
    expect(credentialsFromEnvironment({ AWS_ACCESS_KEY_ID: 'local-test-id' })).toBeUndefined();
    expect(credentialsFromEnvironment({ AWS_ACCESS_KEY_ID: 'local-test-id', AWS_SECRET_ACCESS_KEY: 'local-test-secret' })).toEqual({ accessKeyId: 'local-test-id', secretAccessKey: 'local-test-secret' });
  });
  it('normalizes the JoharXP CloudFront domain to HTTPS', () => {
    expect(cloudFrontBaseUrl('https://cdn.joharxp.com/')).toBe('https://cdn.joharxp.com');
  });
  it('returns only headers required by the presigned request', () => {
    expect(presignedUploadHeaders('image/png')).toEqual({
      'Content-Type': 'image/png',
      'x-amz-server-side-encryption': 'AES256',
    });
  });
});
