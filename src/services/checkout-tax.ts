import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../utils/api-error.js';
import { allocateMoney, money, sumMoney } from '../utils/money.js';

export type TaxComponent = 'CGST' | 'SGST' | 'IGST' | 'DELIVERY_CGST' | 'DELIVERY_SGST' | 'DELIVERY_IGST';
export type TaxLine = { component: TaxComponent; rate: number; amount: number; includedInProductPrice: boolean };

export function requireProductTaxConfiguration(name: string, hsnCode: string | null, rate: Prisma.Decimal | null) {
  if (!hsnCode || rate === null || !/^\d{4,8}$/.test(hsnCode) || rate.isNegative() || rate.greaterThan(100)) {
    throw new ApiError(422, `${name} tax classification is pending admin review.`, 'PRODUCT_TAX_CONFIGURATION_REQUIRED');
  }
  return { hsnCode, rate };
}

/** Extracts GST already included in the customer-facing price. */
export function extractInclusiveTax(inclusiveAmount: Prisma.Decimal, ratePercent: Prisma.Decimal, interstate: boolean) {
  if (ratePercent.isNegative() || ratePercent.greaterThan(100)) throw new Error('GST rate must be between 0 and 100 percent.');
  const tax = ratePercent.isZero()
    ? money(0)
    : money(inclusiveAmount.mul(ratePercent).div(new Prisma.Decimal(100).plus(ratePercent)));
  const taxableValue = money(inclusiveAmount.minus(tax));
  if (interstate) return { taxableValue, cgst: money(0), sgst: money(0), igst: tax };
  const cgst = money(tax.div(2));
  return { taxableValue, cgst, sgst: money(tax.minus(cgst)), igst: money(0) };
}

export function extractExclusiveDeliveryTax(charge: Prisma.Decimal, ratePercent: Prisma.Decimal, interstate: boolean) {
  const taxableValue = money(charge);
  const tax = ratePercent.isZero() ? money(0) : money(taxableValue.mul(ratePercent).div(100));
  if (interstate) return { taxableValue, cgst: money(0), sgst: money(0), igst: tax, total: money(charge.plus(tax)) };
  const cgst = money(tax.div(2));
  return { taxableValue, cgst, sgst: money(tax.minus(cgst)), igst: money(0), total: money(charge.plus(tax)) };
}

export function aggregateTaxLines(items: Array<{ rate: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal }>, delivery: { rate: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal }): TaxLine[] {
  const totals = new Map<string, TaxLine>();
  const add = (component: TaxComponent, rate: Prisma.Decimal, amount: Prisma.Decimal, includedInProductPrice: boolean) => {
    if (amount.isZero()) return;
    const key = `${component}:${rate.toFixed(2)}`;
    const current = totals.get(key);
    totals.set(key, { component, rate: rate.toNumber(), amount: money(new Prisma.Decimal(current?.amount ?? 0).plus(amount)).toNumber(), includedInProductPrice });
  };
  for (const item of items) {
    add('CGST', item.rate.div(2), item.cgst, true);
    add('SGST', item.rate.div(2), item.sgst, true);
    add('IGST', item.rate, item.igst, true);
  }
  add('DELIVERY_CGST', delivery.rate.div(2), delivery.cgst, false);
  add('DELIVERY_SGST', delivery.rate.div(2), delivery.sgst, false);
  add('DELIVERY_IGST', delivery.rate, delivery.igst, false);
  return [...totals.values()].sort((a, b) => a.component.localeCompare(b.component) || a.rate - b.rate);
}

export function allocateVendorTaxShares(
  itemTaxGroups: number[][],
  itemTaxes: Array<{ cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal }>,
  delivery: { cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal },
  weights: Prisma.Decimal[],
) {
  const deliveryCgst = allocateMoney(delivery.cgst, weights);
  const deliverySgst = allocateMoney(delivery.sgst, weights);
  const deliveryIgst = allocateMoney(delivery.igst, weights);
  return itemTaxGroups.map((indexes, groupIndex) => ({
    cgst: money(sumMoney(indexes.map((index) => itemTaxes[index]!.cgst)).plus(deliveryCgst[groupIndex]!)),
    sgst: money(sumMoney(indexes.map((index) => itemTaxes[index]!.sgst)).plus(deliverySgst[groupIndex]!)),
    igst: money(sumMoney(indexes.map((index) => itemTaxes[index]!.igst)).plus(deliveryIgst[groupIndex]!)),
  }));
}
