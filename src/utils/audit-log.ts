import type { Prisma } from '../generated/prisma/client.js';
import { codeOf, describeEvent, type StatusEvent } from '../config/status-codes.js';
import { logger } from './logger.js';

/**
 * One place that writes an admin action to both the audit table and the log
 * stream, keyed on a status code.
 *
 * Before this, `action` was a free string chosen at each call site
 * ('ORDER_STATUS_CORRECTION', 'CUSTOMER_SESSIONS_REVOKED', ...) and nothing
 * appeared in the logs at all — so a support question like "who changed this
 * and when" could only be answered by querying the database, and the wording
 * of an action could drift from the wording shown in the UI.
 *
 * Passing a StatusEvent means the stored `action` is the stable code (A001),
 * the human label comes from the same registry the UI reads, and the log line
 * carries the request id so a log search and an audit row can be joined.
 */
export interface AuditEntry {
  event: StatusEvent;
  actorId: string;
  entityType: string;
  entityId: string;
  requestId?: string | undefined;
  permission?: string | undefined;
  previousState?: Prisma.InputJsonValue | undefined;
  nextState?: Prisma.InputJsonValue | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

/**
 * Write the audit row and emit the log line in one call.
 *
 * The two belong together — an admin action that reaches the table but not the
 * log stream cannot be found by a log search, and one that reaches only the
 * log leaves no durable record. Callers inside a transaction should use
 * `auditRow` with their own `tx` instead and call `logAudit` after it commits.
 */
export async function writeAudit(
  client: { adminAuditLog: { create: (args: { data: ReturnType<typeof auditRow> }) => Promise<unknown> } },
  entry: AuditEntry,
) {
  await client.adminAuditLog.create({ data: auditRow(entry) });
  logAudit(entry);
}

/** The row shape for `adminAuditLog.create({ data })`. */
export function auditRow(entry: AuditEntry) {
  return {
    actorId: entry.actorId,
    action: codeOf(entry.event),
    entityType: entry.entityType,
    entityId: entry.entityId,
    requestId: entry.requestId ?? null,
    ...(entry.permission ? { permission: entry.permission } : {}),
    ...(entry.previousState === undefined ? {} : { previousState: entry.previousState }),
    ...(entry.nextState === undefined ? {} : { nextState: entry.nextState }),
    ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
  };
}

/**
 * Emit the structured log line for an admin action.
 *
 * Logged as JSON keyed on the code, so a log search can filter by it —
 * `code:"A001"` finds every order correction across every operator and every
 * request, which a free-text message could not support. `requestId` ties the
 * line back to the HTTP request and to the audit row written alongside it.
 */
export function logAudit(entry: AuditEntry) {
  logger.info(
    {
      code: codeOf(entry.event),
      event: entry.event,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      requestId: entry.requestId ?? null,
    },
    describeEvent(entry.event),
  );
}
