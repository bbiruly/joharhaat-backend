import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export type UploadCategory = 'product' | 'msme' | 'review';

export interface ObjectStorageService {
  createPresignedUpload(input: { fileName: string; mimeType: string; size: number; category: UploadCategory }): Promise<{ objectKey: string; uploadUrl: string; publicUrl: string; expiresAt: string }>;
  confirmUpload(objectKey: string): Promise<{ objectKey: string; confirmed: true }>;
}
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
/** A review photo comes off a phone camera; 5 MB is generous for one. */
const MAX_BYTES: Record<UploadCategory, number> = { msme: 5_000_000, review: 5_000_000, product: 10_000_000 };
export const mockObjectStorage: ObjectStorageService = {
  async createPresignedUpload(input) {
    const max = MAX_BYTES[input.category];
    // A PDF is a KYC certificate, never a review photo.
    const permitted = allowed.has(input.mimeType) && (input.category !== 'review' || input.mimeType.startsWith('image/'));
    if (!permitted || input.size <= 0 || input.size > max) throw new ApiError(422, `Upload must be an allowed format and at most ${max / 1_000_000} MB.`, 'INVALID_UPLOAD');
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
    const objectKey = `${input.category}/${randomUUID()}-${safeName}`;
    return { objectKey, uploadUrl: `${env.STORAGE_PUBLIC_BASE_URL}/${objectKey}?mockUpload=1`, publicUrl: `${env.STORAGE_PUBLIC_BASE_URL}/${objectKey}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  },
  async confirmUpload(objectKey) { if (!/^(product|msme|review)\/[a-z0-9-]+-[^/]+$/i.test(objectKey)) throw new ApiError(422, 'Object key is invalid.', 'INVALID_OBJECT_KEY'); return { objectKey, confirmed: true }; },
};
