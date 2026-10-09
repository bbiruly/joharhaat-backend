import { FeaturedEndorsementStatus, FeaturedEndorsementType } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { writeAudit } from '../utils/audit-log.js';
import { adminAccess } from './admin.service.js';
import { assertEndorsementMediaKeys, assertFeaturedEndorsementCanPublish, sortPublicEndorsements, toPublicEndorsement } from './featured-endorsement.policy.js';
import { objectStorage, publicMediaUrl } from './storage.service.js';

export interface FeaturedEndorsementInput {
  type: FeaturedEndorsementType;
  displayName: string;
  role: string;
  organization?: string | null;
  quote: string;
  imageObjectKey: string | null;
  imageAltText: string | null;
  videoObjectKey: string | null;
  displayOrder: number;
}

const clean = (value: string | null | undefined) => value?.trim() || null;
const mediaShape = (value: { displayName: string; role: string; quote: string; imageObjectKey: string | null; imageAltText: string | null; videoObjectKey: string | null }) => {
  if (!value.displayName.trim() || !value.role.trim() || !value.quote.trim())
    throw new ApiError(422, 'Name, role and feedback are required.', 'ENDORSEMENT_CONTENT_REQUIRED');
  assertEndorsementMediaKeys(value, false);
};

function assertObjectKey(key: string | null, kind: 'image' | 'video') {
  if (!key) return;
  const allowed = kind === 'image'
    ? /^public\/endorsement\/[a-f0-9-]+\.(jpe?g|png|webp)$/i
    : /^public\/endorsement\/[a-f0-9-]+\.(mp4|webm)$/i;
  if (!allowed.test(key)) throw new ApiError(422, `A valid endorsement ${kind} upload is required.`, 'INVALID_OBJECT_KEY');
}

async function resolveMedia(key: string | null, previousKey: string | null, previousUrl: string | null, userId: string) {
  if (!key) return { objectKey: null, url: null };
  if (key === previousKey) return { objectKey: key, url: previousUrl };
  const upload = await objectStorage.confirmUpload(key, userId);
  if (!upload.publicUrl) throw new ApiError(422, 'A public endorsement media upload is required.', 'INVALID_OBJECT_KEY');
  return { objectKey: upload.objectKey, url: publicMediaUrl(upload.objectKey) };
}

function auditState(value: { type: FeaturedEndorsementType; displayName: string; role: string; organization: string | null; status: FeaturedEndorsementStatus; displayOrder: number; imageObjectKey: string | null; videoObjectKey: string | null }) {
  return { type: value.type, displayName: value.displayName, role: value.role, organization: value.organization, status: value.status, displayOrder: value.displayOrder, hasImage: Boolean(value.imageObjectKey), hasVideo: Boolean(value.videoObjectKey) };
}

export async function listAdminEndorsements(userId: string) {
  await adminAccess(userId, 'marketing:manage');
  return prisma.featuredEndorsement.findMany({ orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function listPublicEndorsements() {
  const records = await prisma.featuredEndorsement.findMany({
    where: { status: FeaturedEndorsementStatus.PUBLISHED },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, type: true, displayName: true, role: true, organization: true, quote: true, imageUrl: true, imageAltText: true, videoUrl: true, displayOrder: true, status: true, createdAt: true },
  });
  return sortPublicEndorsements(records).map(toPublicEndorsement).filter((item) => item !== null);
}

export async function presignEndorsementUpload(userId: string, input: { fileName: string; mimeType: string; size: number }) {
  await adminAccess(userId, 'marketing:manage');
  return objectStorage.createPresignedUpload({ ...input, category: 'endorsement', ownerId: userId });
}

export async function createEndorsement(userId: string, requestId: string | undefined, input: FeaturedEndorsementInput) {
  await adminAccess(userId, 'marketing:manage');
  const imageObjectKey = input.imageObjectKey;
  const imageAltText = clean(input.imageAltText);
  const videoObjectKey = input.videoObjectKey;
  assertObjectKey(imageObjectKey, 'image');
  assertObjectKey(videoObjectKey, 'video');
  mediaShape({ ...input, imageObjectKey, imageAltText, videoObjectKey });
  const [image, video] = await Promise.all([
    resolveMedia(imageObjectKey, null, null, userId),
    resolveMedia(videoObjectKey, null, null, userId),
  ]);
  const created = await prisma.featuredEndorsement.create({ data: {
    type: input.type,
    displayName: input.displayName.trim(),
    role: input.role.trim(),
    organization: clean(input.organization),
    quote: input.quote.trim(),
    imageObjectKey: image.objectKey,
    imageUrl: image.url,
    imageAltText,
    videoObjectKey: video.objectKey,
    videoUrl: video.url,
    displayOrder: input.displayOrder,
  } });
  await writeAudit(prisma, { event: 'ENDORSEMENT_CREATED', actorId: userId, entityType: 'FeaturedEndorsement', entityId: created.id, requestId, permission: 'marketing:manage', nextState: auditState(created) });
  return created;
}

export async function updateEndorsement(userId: string, id: string, requestId: string | undefined, input: FeaturedEndorsementInput) {
  await adminAccess(userId, 'marketing:manage');
  const previous = await prisma.featuredEndorsement.findUnique({ where: { id } });
  if (!previous) throw new ApiError(404, 'Featured endorsement was not found.', 'ENDORSEMENT_NOT_FOUND');
  const imageObjectKey = input.imageObjectKey;
  const imageAltText = clean(input.imageAltText);
  const videoObjectKey = input.videoObjectKey;
  assertObjectKey(imageObjectKey, 'image');
  assertObjectKey(videoObjectKey, 'video');
  mediaShape({ ...input, imageObjectKey, imageAltText, videoObjectKey });
  const [image, video] = await Promise.all([
    resolveMedia(imageObjectKey, previous.imageObjectKey, previous.imageUrl, userId),
    resolveMedia(videoObjectKey, previous.videoObjectKey, previous.videoUrl, userId),
  ]);
  const organization = clean(input.organization);
  const contentChanged = previous.type !== input.type || previous.displayName !== input.displayName.trim() || previous.role !== input.role.trim() || previous.organization !== organization || previous.quote !== input.quote.trim() || previous.imageObjectKey !== image.objectKey || previous.imageAltText !== imageAltText || previous.videoObjectKey !== video.objectKey;
  const updated = await prisma.featuredEndorsement.update({ where: { id }, data: {
    type: input.type,
    displayName: input.displayName.trim(),
    role: input.role.trim(),
    organization,
    quote: input.quote.trim(),
    imageObjectKey: image.objectKey,
    imageUrl: image.url,
    imageAltText,
    videoObjectKey: video.objectKey,
    videoUrl: video.url,
    displayOrder: input.displayOrder,
    ...(contentChanged ? {
      status: previous.status === FeaturedEndorsementStatus.PUBLISHED ? FeaturedEndorsementStatus.DRAFT : previous.status,
      identityConfirmedAt: null,
      consentConfirmedAt: null,
      confirmedById: null,
      publishedAt: null,
      publishedById: null,
    } : {}),
  } });
  await writeAudit(prisma, { event: 'ENDORSEMENT_UPDATED', actorId: userId, entityType: 'FeaturedEndorsement', entityId: id, requestId, permission: 'marketing:manage', previousState: auditState(previous), nextState: auditState(updated) });
  return updated;
}

export async function publishEndorsement(userId: string, id: string, requestId: string | undefined, confirmations: { identityConfirmed: boolean; consentConfirmed: boolean }) {
  await adminAccess(userId, 'marketing:manage');
  const previous = await prisma.featuredEndorsement.findUnique({ where: { id } });
  if (!previous) throw new ApiError(404, 'Featured endorsement was not found.', 'ENDORSEMENT_NOT_FOUND');
  if (previous.status === FeaturedEndorsementStatus.ARCHIVED) throw new ApiError(409, 'Archived endorsements cannot be published.', 'ENDORSEMENT_ARCHIVED');
  assertFeaturedEndorsementCanPublish({ ...confirmations, imageUrl: previous.imageUrl, imageAltText: previous.imageAltText, videoUrl: previous.videoUrl });
  const now = new Date();
  const updated = await prisma.featuredEndorsement.update({ where: { id }, data: { status: FeaturedEndorsementStatus.PUBLISHED, identityConfirmedAt: now, consentConfirmedAt: now, confirmedById: userId, publishedAt: now, publishedById: userId } });
  await writeAudit(prisma, { event: 'ENDORSEMENT_PUBLISHED', actorId: userId, entityType: 'FeaturedEndorsement', entityId: id, requestId, permission: 'marketing:manage', previousState: auditState(previous), nextState: auditState(updated) });
  return updated;
}

export async function unpublishEndorsement(userId: string, id: string, requestId: string | undefined) {
  return changeEndorsementStatus(userId, id, requestId, FeaturedEndorsementStatus.DRAFT);
}

export async function archiveEndorsement(userId: string, id: string, requestId: string | undefined) {
  return changeEndorsementStatus(userId, id, requestId, FeaturedEndorsementStatus.ARCHIVED);
}

async function changeEndorsementStatus(userId: string, id: string, requestId: string | undefined, status: FeaturedEndorsementStatus) {
  await adminAccess(userId, 'marketing:manage');
  const previous = await prisma.featuredEndorsement.findUnique({ where: { id } });
  if (!previous) throw new ApiError(404, 'Featured endorsement was not found.', 'ENDORSEMENT_NOT_FOUND');
  const event = status === FeaturedEndorsementStatus.DRAFT ? 'ENDORSEMENT_UNPUBLISHED' : 'ENDORSEMENT_ARCHIVED';
  const updated = await prisma.featuredEndorsement.update({ where: { id }, data: { status, identityConfirmedAt: null, consentConfirmedAt: null, confirmedById: null, publishedAt: null, publishedById: null } });
  await writeAudit(prisma, { event, actorId: userId, entityType: 'FeaturedEndorsement', entityId: id, requestId, permission: 'marketing:manage', previousState: auditState(previous), nextState: auditState(updated) });
  return updated;
}
