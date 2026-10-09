import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../utils/api-error.js';
import { money } from '../utils/money.js';

export const INDIA_STATES_AND_UTS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

const stateByKey = new Map<string, string>(
  INDIA_STATES_AND_UTS.map((state) => [state.toLowerCase(), state]),
);
stateByKey.set('orissa', 'Odisha');
stateByKey.set('pondicherry', 'Puducherry');
stateByKey.set('nct of delhi', 'Delhi');
stateByKey.set('jammu & kashmir', 'Jammu and Kashmir');

export function normalizeIndiaState(value: string) {
  return stateByKey.get(value.trim().toLowerCase()) ?? null;
}

export type DeliveryQuoteStatus = 'QUOTED' | 'ADDRESS_REQUIRED' | 'RATES_NOT_CONFIGURED' | 'PIN_NOT_SERVICEABLE';

export function deliveryQuoteStatus(pinPricingEnabled: boolean, hasAddress: boolean, pinServiceable = true): DeliveryQuoteStatus {
  if (!pinPricingEnabled) return 'RATES_NOT_CONFIGURED';
  if (!hasAddress) return 'ADDRESS_REQUIRED';
  return pinServiceable ? 'QUOTED' : 'PIN_NOT_SERVICEABLE';
}

export interface DeliveryPincodeImportRow {
  postalCode: string;
  state: string;
  district: string;
  isServiceable: boolean;
  deliveryFee: string;
}

export interface DeliveryCsvIssue {
  row: number;
  message: string;
}

export type DeliveryCsvResult =
  | { ok: true; rows: DeliveryPincodeImportRow[] }
  | { ok: false; issues: DeliveryCsvIssue[] };

function csvCells(source: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = source.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell.length) return null;
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) return null;
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseDeliveryPincodeCsv(csv: string): DeliveryCsvResult {
  const parsed = csvCells(csv);
  if (!parsed) return { ok: false, issues: [{ row: 1, message: 'CSV has invalid quoting.' }] };
  if (parsed.length < 2) return { ok: false, issues: [{ row: 1, message: 'CSV needs a header and at least one PIN row.' }] };
  if (parsed.length > 100_001) return { ok: false, issues: [{ row: 1, message: 'CSV exceeds the 100,000 row import limit.' }] };

  const headers = parsed[0]!.map((header) => header.toLowerCase());
  const index = {
    postalCode: headers.indexOf('pincode'),
    state: headers.indexOf('state'),
    district: headers.indexOf('district'),
    isServiceable: headers.indexOf('serviceable'),
    deliveryFee: headers.indexOf('deliveryfee'),
  };
  const missing = Object.entries(index).filter(([, position]) => position < 0).map(([name]) => name);
  if (missing.length) return { ok: false, issues: [{ row: 1, message: `Missing required column(s): ${missing.join(', ')}.` }] };

  const rows: DeliveryPincodeImportRow[] = [];
  const issues: DeliveryCsvIssue[] = [];
  const seen = new Set<string>();
  parsed.slice(1).forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const postalCode = cells[index.postalCode] ?? '';
    const rawState = cells[index.state] ?? '';
    const district = cells[index.district] ?? '';
    const rawServiceable = (cells[index.isServiceable] ?? '').toLowerCase();
    const deliveryFee = cells[index.deliveryFee] ?? '';
    const state = normalizeIndiaState(rawState);
    const fee = Number(deliveryFee);
    let invalid = false;
    if (!/^\d{6}$/.test(postalCode)) {
      issues.push({ row: rowNumber, message: 'PIN code must contain exactly six digits.' });
      invalid = true;
    } else if (seen.has(postalCode)) {
      issues.push({ row: rowNumber, message: `Duplicate PIN code ${postalCode}.` });
      invalid = true;
    } else {
      seen.add(postalCode);
    }
    if (!state) {
      issues.push({ row: rowNumber, message: 'State or union territory is not recognized.' });
      invalid = true;
    }
    if (!district || district.length > 120) {
      issues.push({ row: rowNumber, message: 'District/city must contain 1–120 characters.' });
      invalid = true;
    }
    if (!['true', 'false'].includes(rawServiceable)) {
      issues.push({ row: rowNumber, message: 'Serviceable must be true or false.' });
      invalid = true;
    }
    if (!Number.isFinite(fee) || fee < 0 || !/^\d+(?:\.\d{1,2})?$/.test(deliveryFee)) {
      issues.push({ row: rowNumber, message: 'Delivery fee must be a non-negative amount with at most two decimals.' });
      invalid = true;
    }
    if (!invalid) {
      rows.push({ postalCode, state: state!, district, isServiceable: rawServiceable === 'true', deliveryFee: fee.toFixed(2) });
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true, rows };
}

export function deliveryFeeForPin(input: {
  merchandiseAfterDiscount: Prisma.Decimal;
  freeDeliveryThreshold: Prisma.Decimal;
  pin: { isServiceable: boolean; deliveryFee: Prisma.Decimal } | null;
}) {
  if (!input.pin || !input.pin.isServiceable)
    throw new ApiError(422, 'Delivery is not available to this PIN code.', 'DELIVERY_PIN_UNSERVICEABLE');
  return input.merchandiseAfterDiscount.greaterThanOrEqualTo(input.freeDeliveryThreshold)
    ? money(0)
    : money(input.pin.deliveryFee);
}
