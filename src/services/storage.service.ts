import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, PutObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, integrations } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export type UploadCategory = 'product' | 'msme' | 'review';

export interface UploadInput { fileName: string; mimeType: string; size: number; category: UploadCategory; ownerId?: string }
export interface ObjectStorageService {
  createPresignedUpload(input: UploadInput): Promise<{ objectKey: string; uploadUrl: string; uploadHeaders: Record<string,string>; publicUrl: string | null; expiresAt: string }>;
  confirmUpload(objectKey: string, ownerId: string): Promise<{ objectKey: string; confirmed: true; publicUrl: string | null }>;
}
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
/** A review photo comes off a phone camera; 5 MB is generous for one. */
const MAX_BYTES: Record<UploadCategory, number> = { msme: 5_000_000, review: 5_000_000, product: 10_000_000 };
const s3 = new S3Client({ region: env.AWS_REGION });
export function validateUpload(input: Pick<UploadInput, 'category' | 'mimeType' | 'size'>) {
  const permitted = allowed.has(input.mimeType) && (input.category === 'msme' || input.mimeType.startsWith('image/'));
  if (!permitted || input.size <= 0 || input.size > MAX_BYTES[input.category]) throw new ApiError(422, `Upload must be an allowed format and at most ${MAX_BYTES[input.category] / 1_000_000} MB.`, 'INVALID_UPLOAD');
}
export function objectKeyFor(category: UploadCategory, fileName: string) {
  const suffix = fileName.toLowerCase().match(/\.(jpe?g|png|webp|pdf)$/)?.[0] ?? '';
  return `${category === 'msme' ? 'private' : 'public'}/${category}/${randomUUID()}${suffix}`;
}
function parseKey(objectKey: string) {
  const match = /^(public\/(product|review)|private\/(msme))\/[a-f0-9-]+\.(jpg|jpeg|png|webp|pdf)$/i.exec(objectKey);
  if (!match) throw new ApiError(422, 'Object key is invalid.', 'INVALID_OBJECT_KEY');
  return (match[2] ?? match[3]) as UploadCategory;
}
function publicUrl(objectKey: string) { return objectKey.startsWith('public/') ? `${env.CLOUDFRONT_BASE_URL.replace(/\/$/, '')}/${objectKey}` : null; }
export function publicMediaUrl(objectKey: string) {
  const url = publicUrl(objectKey);
  if (!url) throw new ApiError(422, 'A public media object key is required.', 'INVALID_OBJECT_KEY');
  return url;
}
export const objectStorage: ObjectStorageService = {
  async createPresignedUpload(input) {
    if (!integrations.storage) throw new ApiError(503, 'Object storage is not configured in this environment.', 'STORAGE_NOT_CONFIGURED');
    validateUpload(input);
    const objectKey = objectKeyFor(input.category, input.fileName);
    if (!input.ownerId) throw new ApiError(401, 'Authentication is required for uploads.', 'AUTH_REQUIRED');
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey, ContentType: input.mimeType, ContentLength: input.size, Metadata: { category: input.category, expectedsize: String(input.size), ownerid: input.ownerId }, ServerSideEncryption: 'AES256', Tagging: 'confirmed=false' }), { expiresIn: env.UPLOAD_URL_TTL_SECONDS });
    return { objectKey, uploadUrl, uploadHeaders: { 'Content-Type': input.mimeType, 'x-amz-meta-category': input.category, 'x-amz-meta-expectedsize': String(input.size), 'x-amz-meta-ownerid': input.ownerId, 'x-amz-server-side-encryption': 'AES256', 'x-amz-tagging': 'confirmed=false' }, publicUrl: publicUrl(objectKey), expiresAt: new Date(Date.now() + env.UPLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  },
  async confirmUpload(objectKey, ownerId) {
    if (!integrations.storage) throw new ApiError(503, 'Object storage is not configured in this environment.', 'STORAGE_NOT_CONFIGURED');
    const category = parseKey(objectKey);
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
      const expected = Number(head.Metadata?.expectedsize);
      if (head.Metadata?.category !== category || head.Metadata?.ownerid !== ownerId || !head.ContentLength || head.ContentLength !== expected || !head.ContentType) throw new Error('metadata mismatch');
      validateUpload({ category, mimeType: head.ContentType, size: head.ContentLength });
      await s3.send(new PutObjectTaggingCommand({ Bucket: env.S3_BUCKET, Key: objectKey, Tagging: { TagSet: [{ Key: 'confirmed', Value: 'true' }] } }));
    } catch { throw new ApiError(422, 'Uploaded object was not found or did not match its signed metadata.', 'UPLOAD_NOT_CONFIRMED'); }
    return { objectKey, confirmed: true, publicUrl: publicUrl(objectKey) };
  },
};
export async function privateDownloadUrl(objectKey: string) {
  if (!integrations.storage) throw new ApiError(503, 'Object storage is not configured in this environment.', 'STORAGE_NOT_CONFIGURED');
  if (!objectKey.startsWith('private/msme/')) throw new ApiError(422, 'Document key is invalid.', 'INVALID_OBJECT_KEY');
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }), { expiresIn: 300 });
}
