import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { pagination } from '../utils/pagination.js';
import { findByCode, STATUS_CODES } from '../config/status-codes.js';
import { adminAccess } from './admin.service.js';

/**
 * Read side of the admin audit trail.
 *
 * `writeAudit` has been recording every admin action into `AdminAuditLog` from
 * seventeen call sites, and until now nothing could read it back — no endpoint,
 * no screen. An audit trail nobody can read is not an audit trail; it only
 * looks like one during a review.
 *
 * Gated on `team:manage` rather than `analytics:read`. The rows carry who did
 * what to whom, including `previousState`/`nextState` snapshots of team and
 * customer records, so this is an access-control surface, not a reporting one.
 * By default only SUPER_ADMIN holds `team:manage`.
 */
const VIEW_PERMISSION = 'team:manage' as const;

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Parses a date filter, ignoring anything unparseable rather than throwing. */
function asDate(value: unknown) {
  const text = asText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export interface AuditQuery {
  page?: unknown;
  pageSize?: unknown;
  /** Status code, e.g. `A001`. */
  action?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  actorId?: unknown;
  from?: unknown;
  to?: unknown;
}

function buildWhere(query: AuditQuery): Prisma.AdminAuditLogWhereInput {
  const action = asText(query.action);
  const entityType = asText(query.entityType);
  const entityId = asText(query.entityId);
  const actorId = asText(query.actorId);
  const from = asDate(query.from);
  const to = asDate(query.to);

  return {
    // Only accept a code the registry actually knows, so a typo returns
    // "no rows for A0O1" rather than silently listing everything.
    ...(action && findByCode(action) ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };
}

export async function auditLog(userId: string, query: AuditQuery = {}) {
  await adminAccess(userId, VIEW_PERMISSION);

  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const where = buildWhere(query);

  const [rows, total] = await prisma.$transaction([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        requestId: true,
        permission: true,
        previousState: true,
        nextState: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return {
    items: rows.map((row) => {
      const entry = findByCode(row.action);
      return {
        ...row,
        // The stored value is the stable code; the wording comes from the same
        // registry the UI reads, so a label change never rewrites history.
        label: entry?.en ?? row.action,
        labelHi: entry?.hi ?? row.action,
        severity: entry?.severity ?? null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * The filter options, built from the data that exists rather than from the full
 * registry — an operator should not be offered a code that has never been
 * written. Actors come from the rows too, so the list is exactly who has acted.
 */
export async function auditFilters(userId: string) {
  await adminAccess(userId, VIEW_PERMISSION);

  // Deliberately not batched into $transaction: Prisma erases the groupBy
  // result type inside one, which drops _count entirely.
  const [actions, entityTypes, actorGroups] = await Promise.all([
    prisma.adminAuditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
    prisma.adminAuditLog.groupBy({ by: ['entityType'], _count: { _all: true }, orderBy: { entityType: 'asc' } }),
    prisma.adminAuditLog.groupBy({ by: ['actorId'], _count: { _all: true }, orderBy: { actorId: 'asc' } }),
  ]);

  const actors = actorGroups.length
    ? await prisma.user.findMany({
        where: { id: { in: actorGroups.map((group) => group.actorId) } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  return {
    actions: actions.map((group) => ({
      code: group.action,
      label: findByCode(group.action)?.en ?? group.action,
      count: group._count._all,
    })),
    entityTypes: entityTypes.map((group) => ({
      value: group.entityType,
      count: group._count._all,
    })),
    actors: actorGroups.map((group) => ({
      id: group.actorId,
      name: actorById.get(group.actorId)?.name ?? 'Removed account',
      email: actorById.get(group.actorId)?.email ?? null,
      count: group._count._all,
    })),
    /** Every code the product can emit, so the UI can explain an unused one. */
    knownCodes: Object.values(STATUS_CODES).map((entry) => ({
      code: entry.code,
      label: entry.en,
    })),
  };
}
