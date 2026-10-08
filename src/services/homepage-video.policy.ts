import { ApiError } from '../utils/api-error.js';

export function publicHomepageVideo(value: { enabled: boolean; url: string | null } | null) {
  return value?.enabled && value.url ? { url: value.url } : null;
}

export function assertHomepageVideoCanBeEnabled(enabled: boolean, url: string | null) {
  if (enabled && !url) throw new ApiError(422, 'Upload a video before showing it on the homepage.', 'HOMEPAGE_VIDEO_REQUIRED');
}
