import { describe, expect, it } from 'vitest';
import { objectKeyFor, validateUpload } from '../src/services/storage.service.js';

describe('S3 object storage policy', () => {
  it('creates a private KYC object key', () => expect(objectKeyFor('msme', 'certificate.pdf')).toMatch(/^private\/msme\//));
  it('rejects unsafe or oversized uploads', () => expect(() => validateUpload({ mimeType: 'application/octet-stream', size: 10, category: 'msme' })).toThrow('allowed format'));
});
