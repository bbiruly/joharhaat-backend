import { describe, expect, it } from 'vitest';
import { mockObjectStorage } from '../src/services/storage.service.js';

describe('mock object storage', () => {
  it('creates a bounded presigned upload', async () => expect((await mockObjectStorage.createPresignedUpload({ fileName: 'certificate.pdf', mimeType: 'application/pdf', size: 1000, category: 'msme' })).objectKey).toMatch(/^msme\//));
  it('rejects unsafe or oversized uploads', async () => await expect(mockObjectStorage.createPresignedUpload({ fileName: 'bad.exe', mimeType: 'application/octet-stream', size: 10, category: 'msme' })).rejects.toThrow('allowed format'));
});
