import { ApiError } from '../utils/api-error.js';

export interface FeaturedEndorsementMedia {
  imageUrl: string | null;
  imageAltText: string | null;
  videoUrl: string | null;
}

export function assertFeaturedEndorsementCanPublish(input: {
  identityConfirmed: boolean;
  consentConfirmed: boolean;
  imageUrl: string | null;
  imageAltText: string | null;
  videoUrl: string | null;
}) {
  if (!input.identityConfirmed || !input.consentConfirmed)
    throw new ApiError(422, 'Confirm the person’s identity and media consent before publishing.', 'ENDORSEMENT_CONFIRMATION_REQUIRED');
  if (!input.imageUrl && !input.videoUrl)
    throw new ApiError(422, 'Add an image or video before publishing this endorsement.', 'ENDORSEMENT_MEDIA_REQUIRED');
  if (input.imageUrl && !input.imageAltText?.trim())
    throw new ApiError(422, 'Add alternative text for the endorsement image.', 'ENDORSEMENT_IMAGE_ALT_REQUIRED');
}

export function assertEndorsementMediaKeys(input: {
  imageObjectKey: string | null;
  imageAltText: string | null;
  videoObjectKey: string | null;
}, requireMedia = true) {
  if (requireMedia && !input.imageObjectKey && !input.videoObjectKey)
    throw new ApiError(422, 'Add an image or video to this endorsement.', 'ENDORSEMENT_MEDIA_REQUIRED');
  if (input.imageObjectKey && !input.imageAltText?.trim())
    throw new ApiError(422, 'Add alternative text for the endorsement image.', 'ENDORSEMENT_IMAGE_ALT_REQUIRED');
}

export function toPublicEndorsement<T extends {
  id: string;
  type: string;
  displayName: string;
  role: string;
  organization: string | null;
  quote: string;
  imageUrl: string | null;
  imageAltText: string | null;
  videoUrl: string | null;
  displayOrder: number;
  status: string;
}>(record: T) {
  if (record.status !== 'PUBLISHED') return null;
  return {
    id: record.id,
    type: record.type,
    displayName: record.displayName,
    role: record.role,
    organization: record.organization,
    quote: record.quote,
    imageUrl: record.imageUrl,
    imageAltText: record.imageAltText,
    videoUrl: record.videoUrl,
    displayOrder: record.displayOrder,
  };
}

export function sortPublicEndorsements<T extends { displayOrder: number; createdAt: Date }>(items: T[]) {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.getTime() - b.createdAt.getTime());
}
