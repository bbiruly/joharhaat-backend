import { AdminTeamRole, FulfillmentStatus, JharkhandDistrict, LedgerType, ModerationStatus, Prisma, ProductLifecycleStatus, UserRole, VerificationStatus, WeeklyHaatDay } from '../generated/prisma/client.js';
import { COMMERCE } from '../config/constants.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { codeOf } from '../config/status-codes.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { pagination } from '../utils/pagination.js';
import { logAudit, writeAudit } from '../utils/audit-log.js';
import { cartAbandonmentRate, consignmentTotals, haatPerformance, monthlySeries, orderTotals } from './admin-analytics.service.js';

export type AdminPermission = 'analytics:read'|'analytics:export'|'orders:manage'|'payouts:manage'|'marketing:manage'|'moderation:manage'|'haats:manage'|'team:manage';

/** Every permission the system understands. The Settings matrix offers these. */
export const ALL_PERMISSIONS: AdminPermission[] = ['analytics:read','analytics:export','orders:manage','payouts:manage','marketing:manage','moderation:manage','haats:manage','team:manage'];

/**
 * Fallback matrix. A role with no rows in `role_permissions` uses these, so an
 * empty or partially-seeded table can never lock every operator out.
 */
const DEFAULT_ROLE_PERMISSIONS: Record<AdminTeamRole, AdminPermission[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  OPERATIONS: ['analytics:read','orders:manage','haats:manage'], FINANCE: ['analytics:read','analytics:export','payouts:manage'], MARKETING: ['analytics:read','marketing:manage'], MODERATOR: ['moderation:manage'],
};

/**
 * The matrix is consulted on every single admin request, so it is cached rather
 * than re-queried each time. Short TTL, and invalidated immediately on edit, so
 * a permission change takes effect at once for the editor and within the window
 * for anyone already signed in.
 */
const MATRIX_TTL_MS = 30_000;
let matrixCache: { at: number; value: Record<AdminTeamRole, AdminPermission[]> } | null = null;

export const invalidatePermissionMatrix = () => { matrixCache = null; };

export async function permissionMatrix(): Promise<Record<AdminTeamRole, AdminPermission[]>> {
  if (matrixCache && Date.now() - matrixCache.at < MATRIX_TTL_MS) return matrixCache.value;
  const rows = await prisma.rolePermission.findMany({ select: { role: true, permission: true } });
  const grouped = new Map<AdminTeamRole, AdminPermission[]>();
  for (const row of rows) {
    if (!ALL_PERMISSIONS.includes(row.permission as AdminPermission)) continue; // stale row from a removed permission
    grouped.set(row.role, [...(grouped.get(row.role) ?? []), row.permission as AdminPermission]);
  }
  const value = Object.fromEntries(
    (Object.keys(DEFAULT_ROLE_PERMISSIONS) as AdminTeamRole[]).map((role) => [
      role,
      // SUPER_ADMIN is never configurable — it always holds everything, so the
      // matrix cannot be edited into a state with no way back in.
      role === AdminTeamRole.SUPER_ADMIN
        ? [...ALL_PERMISSIONS]
        : grouped.get(role) ?? DEFAULT_ROLE_PERMISSIONS[role],
    ]),
  ) as Record<AdminTeamRole, AdminPermission[]>;
  matrixCache = { at: Date.now(), value };
  return value;
}

/**
 * Replace one role's permissions. SUPER_ADMIN only, and SUPER_ADMIN itself
 * cannot be edited.
 */
export async function setRolePermissions(
  userId: string,
  requestId: string | undefined,
  role: AdminTeamRole,
  permissions: AdminPermission[],
) {
  const actor = await adminAccess(userId, 'team:manage');
  if (actor.role !== AdminTeamRole.SUPER_ADMIN)
    throw new ApiError(403, 'Only a SUPER_ADMIN can change the permission matrix.', 'SUPER_ADMIN_REQUIRED');
  if (role === AdminTeamRole.SUPER_ADMIN)
    throw new ApiError(422, 'SUPER_ADMIN always holds every permission and cannot be edited.', 'SUPER_ADMIN_PROTECTED');
  const unknown = permissions.filter((permission) => !ALL_PERMISSIONS.includes(permission));
  if (unknown.length) throw new ApiError(422, 'Unknown permission requested.', 'UNKNOWN_PERMISSION', { unknown });

  const previous = (await permissionMatrix())[role];
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { role } });
    if (permissions.length)
      await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ role, permission })) });
    await tx.adminAuditLog.create({
      data: {
        actorId: userId,
        action: codeOf('ADMIN_ROLE_CHANGED'),
        entityType: 'RolePermission',
        entityId: role,
        requestId: requestId ?? null,
        permission: 'team:manage',
        previousState: { role, permissions: previous },
        nextState: { role, permissions },
      },
    });
  });
  invalidatePermissionMatrix();
  logAudit({ event: 'ADMIN_ROLE_CHANGED', actorId: userId, entityType: 'RolePermission', entityId: role, requestId });
  return { role, permissions };
}

/** The full matrix for the Settings screen. */
export async function readPermissionMatrix(userId: string) {
  await adminAccess(userId, 'team:manage');
  const matrix = await permissionMatrix();
  return {
    allPermissions: ALL_PERMISSIONS,
    roles: (Object.keys(matrix) as AdminTeamRole[]).map((role) => ({
      role,
      permissions: matrix[role],
      /** SUPER_ADMIN is fixed at every permission and cannot be edited. */
      isProtected: role === AdminTeamRole.SUPER_ADMIN,
    })),
  };
}
/**
 * Resolves the caller's admin role.
 *
 * A UserRole.ADMIN with no AdminMembership row used to be treated as
 * SUPER_ADMIN. That was a bootstrap convenience from before admins could be
 * created through the API, and it meant any account promoted to ADMIN by any
 * route or by hand silently held all eight permissions.
 *
 * Now the membership row is the only source of a role. Bootstrapping a first
 * SUPER_ADMIN is the seed's job, or set ADMIN_BOOTSTRAP_EMAIL to let exactly
 * one known account through once — after which it should be unset.
 */
async function resolveAdminRole(userId: string) {
  const membership = await prisma.adminMembership.findUnique({ where: { userId } });

  if (!membership) {
    const bootstrap = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    if (bootstrap) {
      const account = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (account?.email?.toLowerCase() === bootstrap) {
        logger.warn({ userId }, 'ADMIN_BOOTSTRAP_EMAIL granted SUPER_ADMIN with no membership row — unset it once a real membership exists');
        return { role: AdminTeamRole.SUPER_ADMIN, permissions: [...ALL_PERMISSIONS] };
      }
    }
    throw new ApiError(403, 'This account has no admin membership.', 'ADMIN_MEMBERSHIP_REQUIRED');
  }

  if (!membership.isActive) throw new ApiError(403, 'Admin access is disabled.', 'ADMIN_DISABLED');
  const matrix = await permissionMatrix();
  return { role: membership.role, permissions: matrix[membership.role] };
}

const permissionDenied = () => new ApiError(403, 'Your admin role does not allow this action.', 'ADMIN_PERMISSION_DENIED');

export async function adminAccess(userId: string, permission?: AdminPermission) {
  const access = await resolveAdminRole(userId);
  if (permission && !access.permissions.includes(permission)) throw permissionDenied();
  return access;
}

/**
 * Grants when the caller holds ANY ONE of the listed permissions.
 *
 * Used where a screen is legitimately shared by two roles — payment attempts
 * are read by FINANCE (`payouts:manage`) for reconciliation and by OPERATIONS
 * (`orders:manage`) when a customer reports a failed payment. This adds no new
 * permission and does not change the role matrix.
 */
export async function adminAccessAny(userId: string, permissions: AdminPermission[]) {
  const access = await resolveAdminRole(userId);
  if (permissions.length && !permissions.some((permission) => access.permissions.includes(permission))) throw permissionDenied();
  return access;
}

/**
 * Thirty-day operational snapshot.
 *
 * Aggregated in Postgres. This used to pull every order in the window into
 * memory with its vendor orders attached, which does not survive a marketplace
 * doing lakhs of orders a day.
 */
export async function overview(userId: string) {
  await adminAccess(userId, 'analytics:read');
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400000);
  const [orders, consignments, pendingKyc, pendingProducts, lowStock, pendingPayouts, expiringHaats] =
    await Promise.all([
      orderTotals(since),
      consignmentTotals(since, now),
      prisma.vendorApplication.count({ where: { status: 'PENDING' } }),
      prisma.product.count({ where: { lifecycleStatus: 'PENDING_REVIEW' } }),
      prisma.productVariant.count({ where: { stock: { lt: COMMERCE.lowStockThreshold }, isActive: true } }),
      prisma.payoutRequest.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.managedHaatOverride.count({ where: { enabled: true, liveUntil: { gt: now, lte: new Date(now.getTime() + 86400000) } } }),
    ]);
  return {
    snapshotAt: now,
    periodDays: 30,
    metrics: {
      gmv: orders.gmv,
      orders: orders.orders,
      averageOrderValue: orders.averageOrderValue,
      commission: consignments.commission,
      payoutLiability: consignments.payoutLiability,
      deliverySuccessRate: consignments.deliverySuccessRate,
      rtoOrders: consignments.rto,
    },
    attention: {
      pendingKyc,
      pendingProducts,
      lowStock,
      pendingPayouts,
      expiringHaats,
      delayedOrders: consignments.delayed,
      failedPayments: orders.failedPayments,
    },
  };
}
export async function adminOrders(userId:string, query:any){await adminAccess(userId,'orders:manage'); const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20)); const where:Prisma.OrderWhereInput={...(query.paymentStatus?{paymentStatus:query.paymentStatus}:{}),...(query.q?{OR:[{orderNumber:{contains:query.q,mode:'insensitive'}},{recipientName:{contains:query.q,mode:'insensitive'}}]}:{})}; const [items,total]=await prisma.$transaction([prisma.order.findMany({where,include:{vendorOrders:{include:{vendor:true,items:true,statusLogs:{orderBy:{createdAt:'asc'}}}},paymentIntents:{orderBy:{createdAt:'desc'},take:1}},orderBy:{createdAt:'desc'},skip:(page-1)*pageSize,take:pageSize}),prisma.order.count({where})]);return{items,page,pageSize,total,totalPages:Math.ceil(total/pageSize)};}
/**
 * `deliveredAt` for a corrected consignment.
 *
 * The vendor's own transition stamps this, but the admin correction never did,
 * so a consignment corrected to DELIVERED landed in the payouts queue
 * (`where: { status: 'DELIVERED' }`, ordered by `deliveredAt`) with a null sort
 * key. Correcting away from DELIVERED clears it again so the timestamp can
 * never contradict the status.
 */
export function deliveredAtFor(status: FulfillmentStatus, current: Date | null, now = new Date()) {
  if (status === FulfillmentStatus.DELIVERED) return current ?? now;
  return null;
}

/**
 * Escrow release is gated purely on `status === DELIVERED`, so correcting a
 * consignment away from DELIVERED after the money has moved would strand a
 * WalletLedger ESCROW_RELEASE row against a non-delivered order. Blocked rather
 * than silently allowed — reversing a payout is a finance operation, not a
 * status correction.
 */
export function assertCorrectionAllowed(status: FulfillmentStatus, escrowReleased: boolean) {
  if (escrowReleased && status !== FulfillmentStatus.DELIVERED)
    throw new ApiError(422, 'Escrow has already been released for this consignment, so it cannot be moved out of delivered.', 'PAYOUT_ALREADY_RELEASED');
}

export async function correctOrderStatus(userId:string,requestId:string|undefined,id:string,status:FulfillmentStatus,reason:string){await adminAccess(userId,'orders:manage');if(!reason.trim())throw new ApiError(422,'A correction reason is required.','REASON_REQUIRED');return prisma.$transaction(async tx=>{const item=await tx.vendorOrder.findUnique({where:{id}});if(!item)throw new ApiError(404,'Vendor order was not found.','ORDER_NOT_FOUND');
    const escrow = await tx.walletLedger.findUnique({ where: { vendorId_vendorOrderId_type: { vendorId: item.vendorId, vendorOrderId: id, type: LedgerType.ESCROW_RELEASE } }, select: { id: true } });
    assertCorrectionAllowed(status, Boolean(escrow));
    const deliveredAt = deliveredAtFor(status, item.deliveredAt);
    const updated=await tx.vendorOrder.update({where:{id},data:{status,deliveredAt,statusLogs:{create:{status,actorUserId:userId,note:`Admin correction: ${reason}`}}}});await tx.adminActionReason.create({data:{actorId:userId,action:codeOf('ORDER_STATUS_CORRECTION'),entityType:'VendorOrder',entityId:id,reason}});await tx.adminAuditLog.create({data:{actorId:userId,action:codeOf('ORDER_STATUS_CORRECTION'),entityType:'VendorOrder',entityId:id,requestId:requestId??null,permission:'orders:manage',previousState:{status:item.status,deliveredAt:item.deliveredAt},nextState:{status,deliveredAt}}});logAudit({ event: 'ORDER_STATUS_CORRECTION', actorId: userId, entityType: 'VendorOrder', entityId: id, requestId });
    return updated;});}
/**
 * Escrow and payout queues.
 *
 * Every delivered consignment stays DELIVERED forever, so `eligible` grew
 * without bound — after a year of trading it would be the entire order history.
 * The same for payout requests. All three lists are now paginated with the
 * shared defaults, and each returns its own total so the screen can show
 * "showing 20 of N" rather than silently truncating.
 */
export async function payouts(userId: string, query: { page?: unknown; pageSize?: unknown } = {}) {
  await adminAccess(userId, 'payouts:manage');
  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));
  const [eligible, eligibleTotal, requests, requestsTotal, ledgers, ledgersTotal] = await Promise.all([
    prisma.vendorOrder.findMany({ where: { status: 'DELIVERED' }, include: { vendor: true, walletLedgers: true }, orderBy: { deliveredAt: 'desc' }, skip, take }),
    prisma.vendorOrder.count({ where: { status: 'DELIVERED' } }),
    prisma.payoutRequest.findMany({ include: { vendor: true }, orderBy: { requestedAt: 'desc' }, skip, take }),
    prisma.payoutRequest.count(),
    prisma.walletLedger.findMany({ include: { vendor: true, vendorOrder: true }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.walletLedger.count(),
  ]);
  return {
    eligible, requests, ledgers,
    page, pageSize,
    totals: { eligible: eligibleTotal, requests: requestsTotal, ledgers: ledgersTotal },
    totalPages: {
      eligible: Math.max(1, Math.ceil(eligibleTotal / pageSize)),
      requests: Math.max(1, Math.ceil(requestsTotal / pageSize)),
      ledgers: Math.max(1, Math.ceil(ledgersTotal / pageSize)),
    },
  };
}
export async function notifications(userId:string){await adminAccess(userId);return prisma.adminNotification.findMany({where:{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},include:{reads:{where:{userId}}},orderBy:{createdAt:'desc'},take:100});}
export async function markNotification(userId:string,id:string){await adminAccess(userId);return prisma.adminNotificationRead.upsert({where:{notificationId_userId:{notificationId:id,userId}},update:{readAt:new Date()},create:{notificationId:id,userId}});}
/**
 * Mark every live notification as read for this admin.
 *
 * Was: read every notification id, then one upsert per row inside a single
 * transaction — N round trips holding a transaction open, growing with the
 * table. Now one INSERT ... SELECT that skips rows already marked, so the work
 * happens entirely in the database in a single statement.
 *
 * Scoped to notifications that have not expired, matching what `notifications()`
 * actually returns — marking invisible history as read was pointless work.
 */
export async function markAllNotifications(userId: string) {
  await adminAccess(userId);
  // The table is keyed on (notification_id, user_id) with no surrogate id.
  const inserted = await prisma.$executeRaw`
    INSERT INTO admin_notification_reads (notification_id, user_id, read_at)
    SELECT n.id, ${userId}, now()
    FROM admin_notifications n
    WHERE (n.expires_at IS NULL OR n.expires_at > now())
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `;
  return { count: inserted };
}
export async function team(userId:string){await adminAccess(userId,'team:manage');return prisma.adminMembership.findMany({include:{user:{select:{id:true,name:true,email:true,mobile:true,isActive:true,createdAt:true}}},orderBy:{createdAt:'asc'}});}
/**
 * Promote an existing account to admin, or re-activate a membership that was
 * disabled earlier.
 *
 * Only SUPER_ADMIN may do this. `team:manage` alone is not enough: an
 * OPERATIONS admin holding it could otherwise mint themselves a SUPER_ADMIN
 * peer and escalate out of their own role.
 *
 * The person must already have a JoharHaat account — this does not create
 * users, so there is no path here to a credential-less admin, and the operator
 * has to know the exact email of a real person.
 */
export async function createTeamMember(
  userId: string,
  requestId: string | undefined,
  input: { email: string; role: AdminTeamRole },
) {
  const actor = await adminAccess(userId, 'team:manage');
  if (actor.role !== AdminTeamRole.SUPER_ADMIN)
    throw new ApiError(403, 'Only a SUPER_ADMIN can add admin members.', 'SUPER_ADMIN_REQUIRED');

  const account = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: { id: true, isActive: true, adminMembership: { select: { id: true } } },
  });
  if (!account)
    throw new ApiError(404, 'No JoharHaat account exists with that email. Ask them to register first.', 'ACCOUNT_NOT_FOUND');
  if (!account.isActive)
    throw new ApiError(422, 'That account is disabled and cannot be made an admin.', 'ACCOUNT_DISABLED');
  if (account.adminMembership)
    throw new ApiError(409, 'That account is already an admin member.', 'ADMIN_MEMBER_EXISTS');

  return prisma.$transaction(async (tx) => {
    const membership = await tx.adminMembership.create({
      data: { userId: account.id, role: input.role, isActive: true },
      include: { user: { select: { id: true, name: true, email: true, mobile: true } } },
    });
    await tx.user.update({ where: { id: account.id }, data: { role: UserRole.ADMIN } });
    await tx.adminAuditLog.create({
      data: {
        actorId: userId,
        action: codeOf('ADMIN_CREATED'),
        entityType: 'AdminMembership',
        entityId: membership.id,
        requestId: requestId ?? null,
        permission: 'team:manage',
        nextState: { role: input.role, isActive: true },
      },
    });
    logAudit({ event: 'ADMIN_CREATED', actorId: userId, entityType: 'AdminMembership', entityId: membership.id, requestId });
    return membership;
  });
}

/**
 * Revoke admin access: the membership row is removed and the account drops
 * back to CUSTOMER. The person keeps their JoharHaat account and order history
 * — this is not a user deletion.
 */
export async function removeTeamMember(
  userId: string,
  requestId: string | undefined,
  id: string,
) {
  const actor = await adminAccess(userId, 'team:manage');
  if (actor.role !== AdminTeamRole.SUPER_ADMIN)
    throw new ApiError(403, 'Only a SUPER_ADMIN can remove admin members.', 'SUPER_ADMIN_REQUIRED');

  const member = await prisma.adminMembership.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, 'Admin member was not found.', 'ADMIN_MEMBER_NOT_FOUND');
  if (member.role === AdminTeamRole.SUPER_ADMIN)
    throw new ApiError(422, 'A SUPER_ADMIN cannot be removed from the admin panel.', 'SUPER_ADMIN_PROTECTED');
  if (member.userId === userId)
    throw new ApiError(422, 'You cannot remove your own admin access.', 'SELF_DISABLE_FORBIDDEN');

  return prisma.$transaction(async (tx) => {
    await tx.adminMembership.delete({ where: { id } });
    await tx.user.update({ where: { id: member.userId }, data: { role: UserRole.CUSTOMER } });
    await tx.adminAuditLog.create({
      data: {
        actorId: userId,
        action: codeOf('ADMIN_DISABLED'),
        entityType: 'AdminMembership',
        entityId: id,
        requestId: requestId ?? null,
        permission: 'team:manage',
        previousState: { role: member.role, isActive: member.isActive },
      },
    });
    logAudit({ event: 'ADMIN_DISABLED', actorId: userId, entityType: 'AdminMembership', entityId: id, requestId });
    return { removed: true };
  });
}

/**
 * A SUPER_ADMIN may not be disabled or demoted through the API, by anyone —
 * including another SUPER_ADMIN and including themselves. Losing every
 * SUPER_ADMIN would leave the permission matrix unmanageable with no way back
 * in, so that change is deliberately only possible directly in the database.
 */
export function assertTeamChangeAllowed(input: {
  targetRole: AdminTeamRole;
  targetIsSelf: boolean;
  nextRole?: AdminTeamRole | undefined;
  nextIsActive?: boolean | undefined;
}) {
  const disabling = input.nextIsActive === false;
  const demoting = input.nextRole !== undefined && input.nextRole !== input.targetRole;
  if (input.targetRole === AdminTeamRole.SUPER_ADMIN && (disabling || demoting))
    throw new ApiError(422, 'A SUPER_ADMIN cannot be disabled or have their role changed from the admin panel.', 'SUPER_ADMIN_PROTECTED');
  if (input.targetIsSelf && disabling)
    throw new ApiError(422, 'You cannot disable your own admin access.', 'SELF_DISABLE_FORBIDDEN');
}

export async function updateTeamMember(userId:string,id:string,input:{role?:AdminTeamRole;isActive?:boolean},requestId?:string){await adminAccess(userId,'team:manage');const member=await prisma.adminMembership.findUnique({where:{id}});if(!member)throw new ApiError(404,'Admin member was not found.','ADMIN_MEMBER_NOT_FOUND');
  assertTeamChangeAllowed({ targetRole: member.role, targetIsSelf: member.userId === userId, nextRole: input.role, nextIsActive: input.isActive });
  const updated = await prisma.adminMembership.update({ where: { id }, data: input });
  // A role or access change is exactly the kind of thing an incident review
  // asks about, so it records both sides of the change.
  await writeAudit(prisma, { event: 'TEAM_MEMBER_UPDATED', actorId: userId, entityType: 'AdminMembership', entityId: id, requestId, permission: 'team:manage', previousState: { role: member.role, isActive: member.isActive }, nextState: { role: updated.role, isActive: updated.isActive } });
  return updated;}

/**
 * Revenue series for the admin dashboard.
 *
 * Every figure is aggregated in Postgres, so the response size is bounded by
 * the number of months and districts rather than the number of orders.
 *
 * customerAcquisitionCost was removed: it divided a hardcoded 25,000 of
 * "marketing spend" by the new-customer count. There is no marketing spend
 * anywhere in the schema, so the number was invented, and no screen rendered
 * it. A real CAC needs a real spend source.
 */
export async function analytics(userId: string, months: number) {
  await adminAccess(userId, 'analytics:read');
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const [monthly, haats, totals, abandonmentRate] = await Promise.all([
    monthlySeries(since),
    haatPerformance(since),
    orderTotals(since),
    cartAbandonmentRate(since),
  ]);
  const netRevenue = monthly.reduce((sum, point) => sum.plus(point.revenue), new Prisma.Decimal(0));
  return { gmv: totals.gmv, netRevenue, cartAbandonmentRate: abandonmentRate, monthly, haats };
}
export const listHaats = async (userId: string) => (await adminAccess(userId, 'haats:manage'), prisma.weeklyHaat.findMany({ include: { overrides: true }, orderBy: [{ day: 'asc' }, { name: 'asc' }] }));
/**
 * The route validates this shape, so the object is safe to hand to Prisma.
 * It used to be `any` spread straight into create/update, which let a caller
 * set any column on the table.
 */
export interface HaatInput {
  name: string;
  district: JharkhandDistrict;
  day: WeeklyHaatDay;
  opensAt: string;
  closesAt: string;
  isEnabled?: boolean | undefined;
}

export async function saveHaat(userId: string, id: string | undefined, input: HaatInput, requestId?: string) {
  await adminAccess(userId, 'haats:manage');
  if (input.opensAt >= input.closesAt)
    throw new ApiError(422, 'Closing time must be after opening time.', 'INVALID_HAAT_TIME');
  // Build the row explicitly rather than spreading the input, so a field added
  // to HaatInput later cannot silently reach a column it should not.
  const data = {
    name: input.name,
    district: input.district,
    day: input.day,
    opensAt: input.opensAt,
    closesAt: input.closesAt,
    ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
  };
  const previous = id
    ? await prisma.weeklyHaat.findUnique({ where: { id }, select: { name: true, day: true, opensAt: true, closesAt: true, isEnabled: true } })
    : null;
  const saved = id
    ? await prisma.weeklyHaat.update({ where: { id }, data })
    : await prisma.weeklyHaat.create({ data });
  await writeAudit(prisma, {
    event: 'HAAT_SAVED',
    actorId: userId,
    entityType: 'WeeklyHaat',
    entityId: saved.id,
    requestId,
    permission: 'haats:manage',
    ...(previous ? { previousState: previous } : {}),
    nextState: data,
  });
  return saved;
}
export async function setLiveHaat(userId: string, id: string, liveUntil: Date, requestId?: string) {
  await adminAccess(userId, 'haats:manage');
  if (liveUntil <= new Date()) throw new ApiError(422, 'Live override must end in the future.', 'INVALID_LIVE_OVERRIDE');
  const override = await prisma.managedHaatOverride.create({ data: { haatId: id, liveFrom: new Date(), liveUntil } });
  await writeAudit(prisma, { event: 'HAAT_SET_LIVE', actorId: userId, entityType: 'WeeklyHaat', entityId: id, requestId, permission: 'haats:manage', nextState: { liveUntil: liveUntil.toISOString() } });
  return override;
}
export async function toggleHaat(userId: string, id: string, enabled: boolean, requestId?: string) {
  await adminAccess(userId, 'haats:manage');
  const before = await prisma.weeklyHaat.findUnique({ where: { id }, select: { isEnabled: true } });
  const updated = await prisma.weeklyHaat.update({ where: { id }, data: { isEnabled: enabled } });
  await writeAudit(prisma, { event: 'HAAT_TOGGLED', actorId: userId, entityType: 'WeeklyHaat', entityId: id, requestId, permission: 'haats:manage', previousState: { isEnabled: before?.isEnabled ?? null }, nextState: { isEnabled: enabled } });
  return updated;
}
export const abandonedCarts = async (userId: string) => (await adminAccess(userId, 'marketing:manage'), prisma.cart.findMany({ where: { abandonmentStatus: { in: ['ABANDONED', 'REMINDER_SENT'] } }, include: { customer: { select: { name: true, email: true, mobile: true } }, items: { include: { variant: { include: { product: true } } } } }, orderBy: { updatedAt: 'desc' } }));
export async function reminderOpened(userId: string, id: string, requestId?: string) { await adminAccess(userId, 'marketing:manage'); const cart = await prisma.cart.findUnique({ where: { id }, include: { customer: true, items: { include: { variant: true } } } }); if (!cart) throw new ApiError(404, 'Cart was not found.', 'CART_NOT_FOUND'); await prisma.cart.update({ where: { id }, data: { abandonmentStatus: 'REMINDER_SENT', lastReminderAt: new Date() } }); const value = cart.items.reduce((sum, item) => sum.plus(item.variant.price.mul(item.quantity)), new Prisma.Decimal(0)); const message = encodeURIComponent(`Johar ${cart.customer.name}! Aapke JoharHaat cart mein ₹${value.toFixed(2)} ka samaan intezar kar raha hai. Checkout complete karein.`); await writeAudit(prisma, { event: 'CART_REMINDER_PREPARED', actorId: userId, entityType: 'Cart', entityId: id, requestId, permission: 'marketing:manage' }); return { auditAt: new Date(), whatsappUrl: `https://wa.me/91${cart.customer.mobile}?text=${message}` }; }
export const applications = async (userId: string) => (await adminAccess(userId, 'moderation:manage'), prisma.vendorApplication.findMany({ include: { documents: true, audits: true }, orderBy: { createdAt: 'desc' } }));
/**
 * Approval preconditions, kept pure so they are unit-testable without a database.
 *
 * Both used to surface as 409 CONFLICT — the first explicitly, the second by
 * letting a Prisma P2002 on the unique `Vendor.msmeNumber` escape to the error
 * handler, which maps P2002 to 409. The admin UI renders any 409 as a write
 * conflict ("someone else changed this record first"), so a first-attempt
 * approval of an untouched record reported a phantom race. These are
 * preconditions, not conflicts, so they are 422 with their own codes.
 */
export function assertApprovalEligible(input: { ownerHasPassword: boolean; msmeOwnedByAnotherVendor: boolean }) {
  if (!input.ownerHasPassword) throw new ApiError(422, 'The applicant must create a password-protected account before approval.', 'APPLICANT_ACCOUNT_REQUIRED');
  if (input.msmeOwnedByAnotherVendor) throw new ApiError(422, 'This MSME number is already registered to a different vendor.', 'MSME_ALREADY_REGISTERED');
}

export async function moderate(actorId: string, requestId: string | undefined, id: string, status: ModerationStatus, reason?: string) {
  await adminAccess(actorId, 'moderation:manage');
  if ((status === ModerationStatus.HOLD || status === ModerationStatus.REJECTED) && !reason?.trim()) throw new ApiError(422, 'A reason is required for hold or rejection.', 'REASON_REQUIRED');
  return prisma.$transaction(async (tx) => {
    const application = await tx.vendorApplication.findUnique({ where: { id }, include: { documents: true } });
    if (!application) throw new ApiError(404, 'Vendor application was not found.', 'APPLICATION_NOT_FOUND');
    if (application.status === status) return application;
    const updated = await tx.vendorApplication.update({ where: { id }, data: { status, decisionReason: reason ?? null, decidedAt: new Date(), audits: { create: { moderatorId: actorId, status, reason: reason ?? null } } } });
    if (status === ModerationStatus.APPROVED) {
      const owner = application.ownerUserId ? await tx.user.findUnique({ where: { id: application.ownerUserId } }) : await tx.user.findUnique({ where: { email: application.email } });
      // `submitApplication` guards the MSME number against other applications
      // but never against an existing Vendor row, which is where the clash
      // actually bites — check it before the upsert rather than after.
      const msmeHolder = await tx.vendor.findUnique({ where: { msmeNumber: application.msmeNumber }, select: { ownerId: true } });
      assertApprovalEligible({
        ownerHasPassword: Boolean(owner?.passwordHash),
        msmeOwnedByAnotherVendor: Boolean(owner && msmeHolder && msmeHolder.ownerId !== owner.id),
      });
      if (!owner) throw new ApiError(422, 'The applicant must create a password-protected account before approval.', 'APPLICANT_ACCOUNT_REQUIRED');
      await tx.user.update({ where: { id: owner.id }, data: { role: UserRole.VENDOR } });
      const certificate = application.documents.find((document) => document.category === 'MSME');
      await tx.vendor.upsert({ where: { ownerId: owner.id }, update: { verificationStatus: VerificationStatus.VERIFIED }, create: { ownerId: owner.id, businessName: application.collectiveName, district: application.district, region: application.district.replaceAll('_', ' '), msmeNumber: application.msmeNumber, msmeCertificateUrl: certificate?.objectKey ?? 'metadata-unavailable', verificationStatus: VerificationStatus.VERIFIED } });
    }
    await tx.adminAuditLog.create({ data: { actorId, action: `VENDOR_${status}`, entityType: 'VendorApplication', entityId: id, requestId: requestId ?? null, metadata: reason ? { reason } : Prisma.JsonNull } });
    return updated;
  });
}

export const productsForModeration = async (userId: string) => (await adminAccess(userId, 'moderation:manage'), prisma.product.findMany({
  where: { lifecycleStatus: { in: [ProductLifecycleStatus.PENDING_REVIEW, ProductLifecycleStatus.REJECTED, ProductLifecycleStatus.SUSPENDED] } },
  include: { vendor: { include: { owner: { select: { name: true, mobile: true } } } }, category: true, variants: true, media: { orderBy: { sortOrder: 'asc' } }, reviewer: { select: { name: true } } },
  orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
}));

export async function moderateProduct(actorId: string, requestId: string | undefined, id: string, decision: 'APPROVE' | 'REJECT' | 'SUSPEND', reason?: string) {
  await adminAccess(actorId, 'moderation:manage');
  if (decision !== 'APPROVE' && !reason?.trim()) throw new ApiError(422, 'A moderation reason is required.', 'REASON_REQUIRED');
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id }, include: { variants: true, media: true } });
    if (!product) throw new ApiError(404, 'Product was not found.', 'PRODUCT_NOT_FOUND');
    const target = decision === 'APPROVE' ? ProductLifecycleStatus.APPROVED : decision === 'REJECT' ? ProductLifecycleStatus.REJECTED : ProductLifecycleStatus.SUSPENDED;
    if (product.lifecycleStatus === target) return product;
    if (decision === 'APPROVE' && (!product.variants.length || !product.media.length)) throw new ApiError(422, 'A product needs at least one variant and photo before approval.', 'PRODUCT_INCOMPLETE');
    const updated = await tx.product.update({ where: { id }, data: { lifecycleStatus: target, isPublished: decision === 'APPROVE', moderationReason: reason?.trim() || null, reviewedAt: new Date(), reviewerId: actorId } });
    await tx.adminAuditLog.create({ data: { actorId, action: `PRODUCT_${decision}`, entityType: 'Product', entityId: id, requestId: requestId ?? null, metadata: reason ? { reason } : Prisma.JsonNull } });
    return updated;
  });
}
