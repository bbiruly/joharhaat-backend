import { Prisma } from '../generated/prisma/client.js';
export type DecimalInput = string | number | Prisma.Decimal;
export const decimal = (value: DecimalInput): Prisma.Decimal => new Prisma.Decimal(value);
export const money = (value: DecimalInput): Prisma.Decimal => decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const sumMoney = (values: Prisma.Decimal[]): Prisma.Decimal => money(values.reduce((sum, value) => sum.plus(value), decimal(0)));
export const allocateMoney = (total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] => { if (!weights.length) return []; const weightTotal = sumMoney(weights); if (weightTotal.isZero()) return weights.map((_, index) => index === weights.length - 1 ? money(total) : money(0)); let allocated = money(0); return weights.map((weight, index) => { if (index === weights.length - 1) return money(total.minus(allocated)); const share = money(total.mul(weight).div(weightTotal)); allocated = allocated.plus(share); return share; }); };
