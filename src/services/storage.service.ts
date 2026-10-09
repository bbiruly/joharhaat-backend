import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, PutObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, integrations } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export type UploadCategory = 'product' | 'msme' | 'review' | 'homepage' | 'endorsement';

export interface UploadInput { fileName: string; mimeType: string; size: number; category: UploadCategory; ownerId?: string }
export interface ObjectStorageService {
  createPresignedUpload(input: UploadInput): Promise<{ objectKey: string; uploadUrl: string; uploadHeaders: Record<string,string>; publicUrl: string | null; expiresAt: string }>;
  confirmUpload(objectKey: string, ownerId: string): Promise<{ objectKey: string; confirmed: true; publicUrl: string | null }>;
}
/** A review photo comes off a phone camera; 5 MB is generous for one. */
const MAX_BYTES: Record<UploadCategory, number> = { msme: 5_000_000, review: 5_000_000, product: 10_000_000, homepage: 100_000_000, endorsement: 100_000_000 };
export function credentialsFromEnvironment(input: { AWS_ACCESS_KEY_ID?: string | undefined; AWS_SECRET_ACCESS_KEY?: string | undefined }) {
  if (!input.AWS_ACCESS_KEY_ID || !input.AWS_SECRET_ACCESS_KEY) return undefined;
  return {
    accessKeyId: input.AWS_ACCESS_KEY_ID,
    secretAccessKey: input.AWS_SECRET_ACCESS_KEY,
  };
}
const credentials = credentialsFromEnvironment(env);
const s3 = new S3Client({ region: env.AWS_REGION, ...(credentials ? { credentials } : {}) });
export function presignedUploadHeaders(mimeType: string) {
  // The S3 presigner hoists metadata and tagging into the signed query string.
  // Sending them again as headers makes S3 reject them as unsigned headers.
  return { 'Content-Type': mimeType, 'x-amz-server-side-encryption': 'AES256' };
}
export function cloudFrontBaseUrl(domain: string) {
  return `https://${domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
}
export function validateUpload(input: Pick<UploadInput, 'category' | 'mimeType' | 'size'>) {
  const endorsementVideo = input.category === 'endorsement' && ['video/mp4', 'video/webm'].includes(input.mimeType);
  const maxBytes = input.category === 'endorsement' && !endorsementVideo ? 5_000_000 : MAX_BYTES[input.category];
  const permitted = input.category === 'homepage'
    ? input.mimeType === 'video/mp4' || input.mimeType === 'video/webm'
    : input.category === 'endorsement'
      ? ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(input.mimeType)
      : input.category === 'msme'
        ? ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(input.mimeType)
        : ['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType);
  if (!permitted || input.size <= 0 || input.size > maxBytes) throw new ApiError(422, `Upload must be an allowed format and at most ${maxBytes / 1_000_000} MB.`, 'INVALID_UPLOAD');
}
export function objectKeyFor(category: UploadCategory, fileName: string) {
  const suffix = fileName.toLowerCase().match(/\.(jpe?g|png|webp|pdf|mp4|webm)$/)?.[0] ?? '';
  return `${category === 'msme' ? 'private' : 'public'}/${category}/${randomUUID()}${suffix}`;
}
function parseKey(objectKey: string) {
  const match = /^(public\/(product|review|homepage|endorsement)|private\/(msme))\/[a-f0-9-]+\.(jpg|jpeg|png|webp|pdf|mp4|webm)$/i.exec(objectKey);
  if (!match) throw new ApiError(422, 'Object key is invalid.', 'INVALID_OBJECT_KEY');
  return (match[2] ?? match[3]) as UploadCategory;
}
function publicUrl(objectKey: string) { return objectKey.startsWith('public/') ? `${cloudFrontBaseUrl(env.AWS_CLOUDFRONT_DOMAIN)}/${objectKey}` : null; }
export function publicMediaUrl(objectKey: string) {
  const url = publicUrl(objectKey);
  if (!url) throw new ApiError(422, 'A public media object key is required.', 'INVALID_OBJECT_KEY');
  return url;
}
export function storageSigningError(cause: unknown) {
  return Object.assign(
    new ApiError(503, 'Object storage could not prepare an upload. Check the server AWS credentials and bucket configuration.', 'STORAGE_SIGNING_UNAVAILABLE'),
    { cause },
  );
}
export const objectStorage: ObjectStorageService = {
  async createPresignedUpload(input) {
    if (!integrations.storage) throw new ApiError(503, 'Object storage is not configured in this environment.', 'STORAGE_NOT_CONFIGURED');
    validateUpload(input);
    const objectKey = objectKeyFor(input.category, input.fileName);
    if (!input.ownerId) throw new ApiError(401, 'Authentication is required for uploads.', 'AUTH_REQUIRED');
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: objectKey, ContentType: input.mimeType, ContentLength: input.size, Metadata: { category: input.category, expectedsize: String(input.size), ownerid: input.ownerId }, ServerSideEncryption: 'AES256', Tagging: 'confirmed=false' }), { expiresIn: 600 });
    } catch (cause) {
      throw storageSigningError(cause);
    }
    return { objectKey, uploadUrl, uploadHeaders: presignedUploadHeaders(input.mimeType), publicUrl: publicUrl(objectKey), expiresAt: new Date(Date.now() + 600_000).toISOString() };
  },
  async confirmUpload(objectKey, ownerId) {
    if (!integrations.storage) throw new ApiError(503, 'Object storage is not configured in this environment.', 'STORAGE_NOT_CONFIGURED');
    const category = parseKey(objectKey);
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: objectKey }));
      const expected = Number(head.Metadata?.expectedsize);
      if (head.Metadata?.category !== category || head.Metadata?.ownerid !== ownerId || !head.ContentLength || head.ContentLength !== expected || !head.ContentType) throw new Error('metadata mismatch');
      validateUpload({ category, mimeType: head.ContentType, size: head.ContentLength });
      await s3.send(new PutObjectTaggingCommand({ Bucket: env.AWS_S3_BUCKET, Key: objectKey, Tagging: { TagSet: [{ Key: 'confirmed', Value: 'true' }] } }));
    } catch { throw new ApiError(422, 'Uploaded object was not found or did not match its signed metadata.', 'UPLOAD_NOT_CONFIRMED'); }
    return { objectKey, confirmed: true, publicUrl: publicUrl(objectKey) };
  },
};
export async function privateDownloadUrl(objectKey: string) {
  if (!integrations.storage) throw new ApiError(503, 'Object storage is not configured in this environment.', 'STORAGE_NOT_CONFIGURED');
  if (!objectKey.startsWith('private/msme/')) throw new ApiError(422, 'Document key is invalid.', 'INVALID_OBJECT_KEY');
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: objectKey }), { expiresIn: 300 });
}
