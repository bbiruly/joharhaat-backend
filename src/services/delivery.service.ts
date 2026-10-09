import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { auditRow, logAudit, writeAudit } from '../utils/audit-log.js';
import { adminAccess } from './admin.service.js';
import { parseDeliveryPincodeCsv, type DeliveryPincodeImportRow } from './delivery-rules.js';

const SETTINGS_ID = 'default';
const DELIVERY_PERMISSION = 'shipping:manage' as const;

export async function deliverySettings(userId: string) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  return prisma.deliverySettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
}

export async function updateDeliverySettings(
  userId: string,
  requestId: string | undefined,
  input: { isPinPricingEnabled: boolean; freeDeliveryThreshold: number },
) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  const before = await prisma.deliverySettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
  if (input.isPinPricingEnabled) {
    const serviceableCount = await prisma.deliveryPincode.count({ where: { isServiceable: true } });
    if (!serviceableCount) throw new ApiError(422, 'Import serviceable PIN codes before enabling PIN pricing.', 'DELIVERY_PINCODES_REQUIRED');
  }
  const saved = await prisma.deliverySettings.update({
    where: { id: SETTINGS_ID },
    data: { isPinPricingEnabled: input.isPinPricingEnabled, freeDeliveryThreshold: new Prisma.Decimal(input.freeDeliveryThreshold), updatedById: userId },
  });
  await writeAudit(prisma, {
    event: 'DELIVERY_SETTINGS_UPDATED', actorId: userId, entityType: 'DeliverySettings', entityId: SETTINGS_ID,
    requestId, permission: DELIVERY_PERMISSION,
    previousState: { isPinPricingEnabled: before.isPinPricingEnabled, freeDeliveryThreshold: before.freeDeliveryThreshold.toString() },
    nextState: { isPinPricingEnabled: saved.isPinPricingEnabled, freeDeliveryThreshold: saved.freeDeliveryThreshold.toString() },
  });
  return saved;
}

export async function listDeliveryPincodes(userId: string, query: { q?: string; page?: number; pageSize?: number; serviceable?: boolean }) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 50)));
  const where: Prisma.DeliveryPincodeWhereInput = {
    ...(query.serviceable === undefined ? {} : { isServiceable: query.serviceable }),
    ...(query.q ? { OR: [
      { postalCode: { contains: query.q } },
      { state: { contains: query.q, mode: 'insensitive' } },
      { district: { contains: query.q, mode: 'insensitive' } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.deliveryPincode.findMany({ where, orderBy: [{ state: 'asc' }, { district: 'asc' }, { postalCode: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.deliveryPincode.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function updateDeliveryPincode(
  userId: string,
  requestId: string | undefined,
  postalCode: string,
  input: Pick<DeliveryPincodeImportRow, 'isServiceable' | 'deliveryFee'>,
) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  const before = await prisma.deliveryPincode.findUnique({ where: { postalCode } });
  if (!before) throw new ApiError(404, 'PIN code was not found in the imported delivery list.', 'DELIVERY_PIN_NOT_FOUND');
  const saved = await prisma.deliveryPincode.update({
    where: { postalCode },
    data: { isServiceable: input.isServiceable, deliveryFee: new Prisma.Decimal(input.deliveryFee), updatedById: userId },
  });
  await writeAudit(prisma, {
    event: 'DELIVERY_PIN_UPDATED', actorId: userId, entityType: 'DeliveryPincode', entityId: postalCode,
    requestId, permission: DELIVERY_PERMISSION,
    previousState: { isServiceable: before.isServiceable, deliveryFee: before.deliveryFee.toString() },
    nextState: { isServiceable: saved.isServiceable, deliveryFee: saved.deliveryFee.toString() },
  });
  return saved;
}

export async function importDeliveryPincodes(userId: string, requestId: string | undefined, csv: string) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  const parsed = parseDeliveryPincodeCsv(csv);
  if (!parsed.ok) throw new ApiError(422, 'The PIN CSV contains invalid rows. Fix the listed rows and import again.', 'DELIVERY_PIN_CSV_INVALID', { issues: parsed.issues });

  await prisma.$transaction(async (tx) => {
    for (let start = 0; start < parsed.rows.length; start += 5_000) {
      const batch = parsed.rows.slice(start, start + 5_000);
      const values = batch.map((row) => Prisma.sql`(${row.postalCode}, ${row.state}, ${row.district}, ${row.isServiceable}, ${new Prisma.Decimal(row.deliveryFee)}, ${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "delivery_pincodes" ("postal_code", "state", "district", "is_serviceable", "delivery_fee", "updated_by_id", "created_at", "updated_at")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("postal_code") DO UPDATE SET
          "state" = EXCLUDED."state",
          "district" = EXCLUDED."district",
          "is_serviceable" = EXCLUDED."is_serviceable",
          "delivery_fee" = EXCLUDED."delivery_fee",
          "updated_by_id" = EXCLUDED."updated_by_id",
          "updated_at" = CURRENT_TIMESTAMP
      `);
    }
    await tx.adminAuditLog.create({ data: auditRow({
      event: 'DELIVERY_PINCODES_IMPORTED', actorId: userId, entityType: 'DeliveryPincodeImport', entityId: requestId ?? 'manual',
      requestId, permission: DELIVERY_PERMISSION,
      nextState: { rowsImported: parsed.rows.length, states: [...new Set(parsed.rows.map((row) => row.state))].sort() },
    }) });
  }, { maxWait: 10_000, timeout: 120_000 });
  logAudit({ event: 'DELIVERY_PINCODES_IMPORTED', actorId: userId, entityType: 'DeliveryPincodeImport', entityId: requestId ?? 'manual', requestId, permission: DELIVERY_PERMISSION });
  return { imported: parsed.rows.length, states: [...new Set(parsed.rows.map((row) => row.state))].sort() };
}

export async function previewDeliveryPincodes(userId: string, csv: string) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  const parsed = parseDeliveryPincodeCsv(csv);
  if (!parsed.ok) return { valid: false, rowCount: Math.max(0, csv.split(/\r?\n/).filter((line) => line.trim()).length - 1), issues: parsed.issues.slice(0, 200), truncatedIssues: parsed.issues.length > 200, sample: [] };
  return { valid: true, rowCount: parsed.rows.length, issues: [], truncatedIssues: false, sample: parsed.rows.slice(0, 10) };
}

export async function exportDeliveryPincodes(userId: string) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  const rows = await prisma.deliveryPincode.findMany({ orderBy: [{ state: 'asc' }, { district: 'asc' }, { postalCode: 'asc' }] });
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    'pincode,state,district,serviceable,deliveryFee',
    ...rows.map((row) => [row.postalCode, row.state, row.district, String(row.isServiceable), row.deliveryFee.toFixed(2)].map(quote).join(',')),
  ].join('\r\n');
}

export async function deliveryPincodeTemplate(userId: string) {
  await adminAccess(userId, DELIVERY_PERMISSION);
  return 'pincode,state,district,serviceable,deliveryFee\r\n';
}

export async function lookupDeliveryPincode(postalCode: string) {
  const [settings, pin] = await Promise.all([
    prisma.deliverySettings.findUnique({ where: { id: SETTINGS_ID } }),
    prisma.deliveryPincode.findUnique({ where: { postalCode } }),
  ]);
  if (!pin && settings?.isPinPricingEnabled) throw new ApiError(404, 'This PIN code is not in the delivery coverage list.', 'DELIVERY_PIN_NOT_FOUND');
  if (!pin) return { postalCode, state: null, district: null, isServiceable: null, deliveryFee: null, pinPricingEnabled: false };
  return { postalCode, state: pin.state, district: pin.district, isServiceable: pin.isServiceable, deliveryFee: pin.deliveryFee, pinPricingEnabled: settings?.isPinPricingEnabled ?? false };
}
