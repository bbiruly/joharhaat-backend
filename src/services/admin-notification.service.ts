import type {
  AdminNotificationCategory,
  AdminNotificationSeverity,
} from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';

/**
 * The single write path for `AdminNotification`.
 *
 * Nothing in the codebase created notifications before this helper, so every
 * producer must go through here rather than calling `prisma.adminNotification`
 * directly — that keeps de-duplication and expiry policy in one place.
 */
export interface AdminNotificationInput {
  severity: AdminNotificationSeverity;
  category: AdminNotificationCategory;
  title: string;
  message: string;
  actionHref?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  expiresAt?: Date | null;
}

/**
 * Producers run on a schedule, so the same entity would otherwise raise the
 * same alert on every pass. A notification is suppressed when an unexpired one
 * already exists for the same category + entity inside this window.
 */
export const NOTIFICATION_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;

async function isDuplicate(input: AdminNotificationInput, now: Date) {
  if (!input.entityType || !input.entityId) return false;
  const existing = await prisma.adminNotification.findFirst({
    where: {
      category: input.category,
      entityType: input.entityType,
      entityId: input.entityId,
      createdAt: { gte: new Date(now.getTime() - NOTIFICATION_DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  return existing !== null;
}

/** Creates one notification, or returns `null` when it was de-duplicated. */
export async function createAdminNotification(
  input: AdminNotificationInput,
  now = new Date(),
) {
  if (await isDuplicate(input, now)) return null;
  return prisma.adminNotification.create({
    data: {
      severity: input.severity,
      category: input.category,
      title: input.title,
      message: input.message,
      actionHref: input.actionHref ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

/**
 * Bulk variant used by the aggregation job. Returns how many rows were written
 * after de-duplication.
 */
export async function createAdminNotifications(
  inputs: readonly AdminNotificationInput[],
  now = new Date(),
) {
  let created = 0;
  for (const input of inputs) {
    if (await createAdminNotification(input, now)) created += 1;
  }
  return created;
}
