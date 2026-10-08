import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { writeAudit } from '../utils/audit-log.js';
import { assertHomepageVideoCanBeEnabled, publicHomepageVideo } from './homepage-video.policy.js';
import { adminAccess } from './admin.service.js';
import { objectStorage, publicMediaUrl } from './storage.service.js';

const SETTING_ID = 'homepage';

export interface HomepageVideoUpdate {
  objectKey?: string | null;
  enabled: boolean;
}

export async function homepageVideoForAdmin(userId: string) {
  await adminAccess(userId, 'marketing:manage');
  const value = await prisma.homepageVideo.findUnique({ where: { id: SETTING_ID } });
  return value ?? { id: SETTING_ID, objectKey: null, url: null, enabled: false, updatedById: null, updatedAt: null };
}

export async function homepageVideoPublic() {
  const value = await prisma.homepageVideo.findUnique({ where: { id: SETTING_ID } });
  return publicHomepageVideo(value);
}

export async function presignHomepageVideo(userId: string, input: { fileName: string; mimeType: string; size: number }) {
  await adminAccess(userId, 'marketing:manage');
  return objectStorage.createPresignedUpload({ ...input, category: 'homepage', ownerId: userId });
}

export async function updateHomepageVideo(userId: string, requestId: string | undefined, input: HomepageVideoUpdate) {
  await adminAccess(userId, 'marketing:manage');
  const previous = await prisma.homepageVideo.findUnique({ where: { id: SETTING_ID } });
  let objectKey = previous?.objectKey ?? null;
  let url = previous?.url ?? null;

  if (input.objectKey === null) {
    objectKey = null;
    url = null;
  } else if (input.objectKey) {
    if (!input.objectKey.startsWith('public/homepage/'))
      throw new ApiError(422, 'A homepage video upload is required.', 'INVALID_OBJECT_KEY');
    const upload = await objectStorage.confirmUpload(input.objectKey, userId);
    if (!upload.publicUrl) throw new ApiError(422, 'A public homepage video is required.', 'INVALID_OBJECT_KEY');
    objectKey = upload.objectKey;
    url = publicMediaUrl(upload.objectKey);
  }

  assertHomepageVideoCanBeEnabled(input.enabled, url);

  const saved = await prisma.homepageVideo.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, objectKey, url, enabled: input.enabled, updatedById: userId },
    update: { objectKey, url, enabled: input.enabled, updatedById: userId },
  });

  await writeAudit(prisma, {
    event: 'HOMEPAGE_VIDEO_UPDATED',
    actorId: userId,
    entityType: 'HomepageVideo',
    entityId: SETTING_ID,
    requestId,
    permission: 'marketing:manage',
    previousState: { objectKey: previous?.objectKey ?? null, enabled: previous?.enabled ?? false },
    nextState: { objectKey, enabled: saved.enabled },
  });
  return saved;
}
