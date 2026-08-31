import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export interface ObjectStorageService {
  createPresignedUpload(input: { fileName: string; mimeType: string; size: number; category: 'product' | 'msme' }): Promise<{ objectKey: string; uploadUrl: string; publicUrl: string; expiresAt: string }>;
  confirmUpload(objectKey: string): Promise<{ objectKey: string; confirmed: true }>;
}
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const mockObjectStorage: ObjectStorageService = {
  async createPresignedUpload(input) {
    const max = input.category === 'msme' ? 5_000_000 : 10_000_000;
    if (!allowed.has(input.mimeType) || input.size <= 0 || input.size > max) throw new ApiError(422, `Upload must be an allowed format and at most ${max / 1_000_000} MB.`, 'INVALID_UPLOAD');
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
    const objectKey = `${input.category}/${randomUUID()}-${safeName}`;
    return { objectKey, uploadUrl: `${env.STORAGE_PUBLIC_BASE_URL}/${objectKey}?mockUpload=1`, publicUrl: `${env.STORAGE_PUBLIC_BASE_URL}/${objectKey}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  },
  async confirmUpload(objectKey) { if (!/^(product|msme)\/[a-z0-9-]+-[^/]+$/i.test(objectKey)) throw new ApiError(422, 'Object key is invalid.', 'INVALID_OBJECT_KEY'); return { objectKey, confirmed: true }; },
};
