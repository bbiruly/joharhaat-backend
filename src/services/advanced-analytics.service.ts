import { randomUUID } from 'node:crypto';
import {
  AdminNotificationCategory,
  AdminNotificationSeverity,
  ForecastConfidence,
  FulfillmentStatus,
  Prisma,
  type JharkhandDistrict,
} from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { COMMERCE } from '../config/constants.js';
import { pagination } from '../utils/pagination.js';
import { adminAccess } from './admin.service.js';
import {
  createAdminNotifications,
  type AdminNotificationInput,
} from './admin-notification.service.js';

const aliases:Record<string,string>={'महुआ':'mahua','महुवा':'mahua','लाख':'lac','लाह':'lac','सोहराय':'sohrai','हस्तशिल्प':'handicraft'};
export const normalizeQuery=(value:string)=>{const clean=value.trim().toLowerCase().replace(/\s+/g,' ');return aliases[clean]||clean};
const since=(days:number)=>new Date(Date.now()-Math.min(365,Math.max(1,days))*86400000);
const lastRun=()=>prisma.analyticsAggregationRun.findFirst({where:{status:'SUCCEEDED'},orderBy:{completedAt:'desc'},select:{completedAt:true}});

/** Districts are stored SCREAMING_SNAKE and displayed with spaces (§7). */
const districtName = (district: JharkhandDistrict) => district.replaceAll('_', ' ');

// ---------------------------------------------------------------------------
// Demand window + forecast maths (pure, unit-tested in tests/)
// ---------------------------------------------------------------------------

/** Selectable analysis windows. One value drives both admin intelligence endpoints. */
export const ANALYTICS_WINDOWS = [30, 60, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];
export const DEFAULT_ANALYTICS_WINDOW: AnalyticsWindow = 30;

export function parseWindow(value: unknown): AnalyticsWindow {
  const days = Number(value);
  return (ANALYTICS_WINDOWS as readonly number[]).includes(days)
    ? (days as AnalyticsWindow)
    : DEFAULT_ANALYTICS_WINDOW;
}

/**
 * Cancelled and returned orders are not demand — counting them inflated
 * velocity, the reorder recommendation and revenue-at-risk alike.
 */
export const DEMAND_STATUSES: FulfillmentStatus[] = [
  FulfillmentStatus.PENDING,
  FulfillmentStatus.PACKED,
  FulfillmentStatus.SHIPPED,
  FulfillmentStatus.DELIVERED,
];

/**
 * The weighted blend is unchanged — 50% short, 30% medium, 20% long — but the
 * windows it draws from now scale with the selected period. At 90 days the
 * tiers are still 7 / 30 / 90, so previously published numbers are reproduced.
 */
export function velocityTiers(days: AnalyticsWindow) {
  return [
    { days: 7, weight: 0.5 },
    { days: Math.round(days / 3), weight: 0.3 },
    { days, weight: 0.2 },
  ] as const;
}

/** Days of cover at or below this raises a stock alert. */
export const STOCKOUT_RISK_DAYS = 7;
/** Days of cover below this escalates that alert to CRITICAL. */
export const STOCKOUT_CRITICAL_DAYS = 3;

export interface ForecastTier {
  days: number;
  weight: number;
  units: number;
}

export interface ForecastInput {
  stock: number;
  /** Unit price in rupees. */
  price: number;
  /** Number of order lines observed — drives confidence, not velocity. */
  observations: number;
  tiers: readonly ForecastTier[];
  lowStockThreshold: number;
}

export function forecastConfidence(observations: number): ForecastConfidence {
  if (observations >= 20) return ForecastConfidence.HIGH;
  if (observations >= 5) return ForecastConfidence.MEDIUM;
  return ForecastConfidence.LOW;
}

export type ForecastClassification = 'dead' | 'critical' | 'slow' | 'healthy';

function classify(velocity: number, daysOfCover: number | null): ForecastClassification {
  if (velocity === 0) return 'dead';
  if (daysOfCover !== null && daysOfCover <= STOCKOUT_RISK_DAYS) return 'critical';
  if (velocity < 0.15) return 'slow';
  return 'healthy';
}

/** Severity scales with how little cover is left. */
export function stockoutSeverity(daysOfCover: number | null): AdminNotificationSeverity {
  return daysOfCover !== null && daysOfCover < STOCKOUT_CRITICAL_DAYS
    ? AdminNotificationSeverity.CRITICAL
    : AdminNotificationSeverity.WARNING;
}

/**
 * Cross-references demand velocity against stock on hand. `daysOfCover` and
 * `belowThreshold` are the two signals the admin screen ranks on.
 */
export function buildForecast(input: ForecastInput) {
  const blended = input.tiers.reduce(
    (total, tier) => (tier.days > 0 ? total + (tier.units / tier.days) * tier.weight : total),
    0,
  );
  const dailyVelocity = Number(blended.toFixed(3));
  const forecast7 = Math.ceil(dailyVelocity * 7);
  const forecast30 = Math.ceil(dailyVelocity * 30);
  const safetyStock = Math.ceil(dailyVelocity * 7);
  const daysOfCover = dailyVelocity > 0 ? Math.floor(input.stock / dailyVelocity) : null;
  const belowThreshold = input.stock < input.lowStockThreshold;
  const stockoutRisk =
    dailyVelocity > 0 &&
    (belowThreshold || (daysOfCover !== null && daysOfCover <= STOCKOUT_RISK_DAYS));

  return {
    dailyVelocity,
    forecast7,
    forecast30,
    recommendedReorder: Math.max(0, forecast30 + safetyStock - input.stock),
    daysOfCover,
    belowThreshold,
    stockoutRisk,
    revenueAtRisk: new Prisma.Decimal(Math.max(0, forecast30 - input.stock)).mul(input.price),
    confidence: forecastConfidence(input.observations),
    classification: classify(dailyVelocity, daysOfCover),
  };
}

/** Sums order-line quantities inside each tier window. */
export function tierUnits(
  days: AnalyticsWindow,
  lines: readonly { at: Date; quantity: number }[],
  now = Date.now(),
): ForecastTier[] {
  return velocityTiers(days).map((tier) => ({
    days: tier.days,
    weight: tier.weight,
    units: lines
      .filter((line) => line.at.getTime() >= now - tier.days * 86400000)
      .reduce((total, line) => total + line.quantity, 0),
  }));
}

const forecastExplanation = (days: AnalyticsWindow) => {
  const tiers = velocityTiers(days);
  return (
    `Weighted daily demand over ${days} days: 50% of ${tiers[0].days}-day, ` +
    `30% of ${tiers[1].days}-day and 20% of ${tiers[2].days}-day velocity; ` +
    'plus 7 days safety stock. Cancelled and RTO orders are excluded.'
  );
};

// ---------------------------------------------------------------------------
// Search insights (unchanged)
// ---------------------------------------------------------------------------

export async function searchInsights(userId:string,days=30){await adminAccess(userId,'analytics:read');const events=await prisma.productAnalyticsEvent.findMany({where:{createdAt:{gte:since(days)},searchQuery:{not:null}},include:{product:{select:{name:true,district:true}}}});const groups=new Map<string,{family:string;queries:Set<string>;impressions:number;clicks:number;carts:number;products:Set<string>;districts:Set<string>}>();for(const e of events){const family=normalizeQuery(e.searchQuery!);const g=groups.get(family)||{family,queries:new Set(),impressions:0,clicks:0,carts:0,products:new Set(),districts:new Set()};g.queries.add(e.searchQuery!);if(e.type==='IMPRESSION')g.impressions++;if(e.type==='SEARCH_CLICK')g.clicks++;if(e.type==='ADD_TO_CART')g.carts++;g.products.add(e.product.name);g.districts.add(e.product.district);groups.set(family,g);}return{snapshotAt:new Date(),lastAggregatedAt:(await lastRun())?.completedAt??null,items:[...groups.values()].map(g=>({queryFamily:g.family,queries:[...g.queries],impressions:g.impressions,clicks:g.clicks,cartAdds:g.carts,ctr:g.impressions?Number((g.clicks/g.impressions*100).toFixed(1)):0,resultProducts:g.products.size,districts:[...g.districts],state:g.clicks===0?'missed-demand':g.carts===0?'low-conversion':'converting',recommendation:g.clicks===0?'Create or improve products for this search.':g.carts===0?'Improve product title, image or pricing.':'Continue promoting matching products.'})).sort((a,b)=>b.impressions-a.impressions)};}

// ---------------------------------------------------------------------------
// Inventory intelligence
// ---------------------------------------------------------------------------

export type InventorySort = 'revenueAtRisk' | 'daysOfCover' | 'dailyVelocity' | 'stock';
const INVENTORY_SORTS: InventorySort[] = [
  'revenueAtRisk',
  'daysOfCover',
  'dailyVelocity',
  'stock',
];

export interface InventoryQuery {
  days?: unknown;
  page?: unknown;
  pageSize?: unknown;
  /** Delivery district to narrow demand to — set when a map region is clicked. */
  district?: unknown;
  sort?: unknown;
  direction?: unknown;
}

/**
 * Ranking is computed rather than stored, so the candidate set is scored in
 * memory and then paginated. The `district` filter narrows that set at the
 * database first — that is what the choropleth click-through uses.
 */
export async function inventoryIntelligence(userId: string, query: InventoryQuery = {}) {
  await adminAccess(userId, 'analytics:read');

  const now = new Date();
  const days = parseWindow(query.days);
  const windowStart = since(days);
  const district =
    typeof query.district === 'string' && query.district
      ? (query.district as JharkhandDistrict)
      : null;
  const sort: InventorySort = INVENTORY_SORTS.includes(query.sort as InventorySort)
    ? (query.sort as InventorySort)
    : 'revenueAtRisk';
  const direction = query.direction === 'asc' ? 'asc' : 'desc';
  const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));

  const demandWindow: Prisma.VendorOrderWhereInput = {
    createdAt: { gte: windowStart },
    status: { in: DEMAND_STATUSES },
  };

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      ...(district
        ? { orderItems: { some: { vendorOrder: { ...demandWindow, order: { district } } } } }
        : {}),
    },
    select: {
      id: true,
      productId: true,
      label: true,
      sku: true,
      price: true,
      stock: true,
      product: {
        select: {
          name: true,
          district: true,
          vendor: { select: { businessName: true } },
          category: { select: { name: true } },
        },
      },
      orderItems: {
        where: { vendorOrder: demandWindow },
        select: {
          quantity: true,
          vendorOrder: { select: { createdAt: true, order: { select: { district: true } } } },
        },
      },
    },
  });

  const explanation = forecastExplanation(days);
  const items = variants.map((variant) => {
    const lines = variant.orderItems.map((item) => ({
      at: item.vendorOrder.createdAt,
      quantity: item.quantity,
      district: item.vendorOrder.order.district,
    }));

    const forecast = buildForecast({
      stock: variant.stock,
      price: Number(variant.price),
      observations: lines.length,
      tiers: tierUnits(days, lines, now.getTime()),
      lowStockThreshold: COMMERCE.lowStockThreshold,
    });

    const byDistrict = new Map<JharkhandDistrict, number>();
    for (const line of lines) {
      byDistrict.set(line.district, (byDistrict.get(line.district) ?? 0) + line.quantity);
    }

    return {
      variantId: variant.id,
      productId: variant.productId,
      product: variant.product.name,
      vendor: variant.product.vendor.businessName,
      category: variant.product.category.name,
      /** Where the artisan is — not where demand comes from. */
      originDistrict: variant.product.district,
      label: variant.label,
      sku: variant.sku,
      price: variant.price.toFixed(2),
      stock: variant.stock,
      dailyVelocity: forecast.dailyVelocity,
      forecast7: forecast.forecast7,
      forecast30: forecast.forecast30,
      recommendedReorder: forecast.recommendedReorder,
      daysOfCover: forecast.daysOfCover,
      belowThreshold: forecast.belowThreshold,
      stockoutRisk: forecast.stockoutRisk,
      revenueAtRisk: forecast.revenueAtRisk.toFixed(2),
      expectedStockoutAt:
        forecast.daysOfCover === null
          ? null
          : new Date(now.getTime() + forecast.daysOfCover * 86400000),
      confidence: forecast.confidence,
      classification: forecast.classification,
      demandDistricts: [...byDistrict.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([code, units]) => ({ district: code, districtName: districtName(code), units })),
      explanation,
    };
  });

  const rank = (item: (typeof items)[number]) => {
    if (sort === 'daysOfCover') return item.daysOfCover ?? Number.MAX_SAFE_INTEGER;
    if (sort === 'dailyVelocity') return item.dailyVelocity;
    if (sort === 'stock') return item.stock;
    return Number(item.revenueAtRisk);
  };
  items.sort((a, b) => (direction === 'asc' ? rank(a) - rank(b) : rank(b) - rank(a)));

  const total = items.length;
  return {
    snapshotAt: now,
    lastAggregatedAt: (await lastRun())?.completedAt ?? null,
    days,
    lowStockThreshold: COMMERCE.lowStockThreshold,
    district,
    sort,
    direction,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    atRiskCount: items.filter((item) => item.stockoutRisk).length,
    revenueAtRiskTotal: items
      .reduce((sum, item) => sum.plus(item.revenueAtRisk), new Prisma.Decimal(0))
      .toFixed(2),
    averageDaysOfCover: averageDaysOfCover(items),
    items: items.slice(skip, skip + take),
  };
}

function averageDaysOfCover(items: readonly { daysOfCover: number | null }[]) {
  const covered = items.filter((item) => item.daysOfCover !== null);
  if (covered.length === 0) return null;
  const total = covered.reduce((sum, item) => sum + (item.daysOfCover ?? 0), 0);
  return Number((total / covered.length).toFixed(1));
}

// ---------------------------------------------------------------------------
// District analytics — demand by DELIVERY district
// ---------------------------------------------------------------------------

interface DistrictBucket {
  district: JharkhandDistrict;
  unitsSold: number;
  gmv: Prisma.Decimal;
  orders: number;
  rto: number;
  views: number;
  searchDemand: number;
  products: Map<string, number>;
  variants: Set<string>;
}

const emptyBucket = (district: JharkhandDistrict): DistrictBucket => ({
  district,
  unitsSold: 0,
  gmv: new Prisma.Decimal(0),
  orders: 0,
  rto: 0,
  views: 0,
  searchDemand: 0,
  products: new Map(),
  variants: new Set(),
});

/**
 * Demand is keyed on `Order.district` (where it was delivered), not
 * `Product.district` (where the artisan is) — the previous grouping mapped
 * supply, which is misleading on a demand choropleth. Viewer district from
 * analytics events is reported alongside as a secondary signal.
 */
export async function districtAnalytics(userId: string, query: { days?: unknown } = {}) {
  await adminAccess(userId, 'analytics:read');

  const now = new Date();
  const days = parseWindow(query.days);
  const windowStart = since(days);

  const [vendorOrders, events] = await Promise.all([
    prisma.vendorOrder.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        status: true,
        createdAt: true,
        order: { select: { district: true } },
        items: { select: { variantId: true, productName: true, quantity: true, lineTotal: true } },
      },
    }),
    prisma.productAnalyticsEvent.findMany({
      where: { createdAt: { gte: windowStart }, district: { not: null } },
      select: { type: true, district: true, searchQuery: true },
    }),
  ]);

  const buckets = new Map<JharkhandDistrict, DistrictBucket>();
  const bucketFor = (district: JharkhandDistrict) => {
    const existing = buckets.get(district);
    if (existing) return existing;
    const created = emptyBucket(district);
    buckets.set(district, created);
    return created;
  };

  /** Order lines per variant, reused to score stockout risk per district. */
  const linesByVariant = new Map<string, { at: Date; quantity: number }[]>();

  for (const vendorOrder of vendorOrders) {
    if (vendorOrder.status === FulfillmentStatus.CANCELLED) continue;
    const bucket = bucketFor(vendorOrder.order.district);
    bucket.orders += 1;
    if (vendorOrder.status === FulfillmentStatus.RTO) {
      bucket.rto += 1;
      continue;
    }
    for (const item of vendorOrder.items) {
      bucket.unitsSold += item.quantity;
      bucket.gmv = bucket.gmv.plus(item.lineTotal);
      bucket.products.set(
        item.productName,
        (bucket.products.get(item.productName) ?? 0) + item.quantity,
      );
      bucket.variants.add(item.variantId);
      const lines = linesByVariant.get(item.variantId) ?? [];
      lines.push({ at: vendorOrder.createdAt, quantity: item.quantity });
      linesByVariant.set(item.variantId, lines);
    }
  }

  for (const event of events) {
    if (!event.district) continue;
    const bucket = bucketFor(event.district);
    if (event.type === 'VIEW') bucket.views += 1;
    if (event.searchQuery) bucket.searchDemand += 1;
  }

  const atRisk = await stockoutRiskVariantIds(linesByVariant, days, now);

  return {
    snapshotAt: now,
    lastAggregatedAt: (await lastRun())?.completedAt ?? null,
    days,
    items: [...buckets.values()].map((bucket) => ({
      district: bucket.district,
      districtName: districtName(bucket.district),
      unitsSold: bucket.unitsSold,
      gmv: bucket.gmv.toFixed(2),
      orders: bucket.orders,
      rto: bucket.rto,
      rtoRate: bucket.orders ? Number(((bucket.rto / bucket.orders) * 100).toFixed(1)) : 0,
      views: bucket.views,
      searchDemand: bucket.searchDemand,
      conversion: bucket.views ? Number(((bucket.unitsSold / bucket.views) * 100).toFixed(1)) : 0,
      stockoutRiskCount: [...bucket.variants].filter((id) => atRisk.has(id)).length,
      topProducts: [...bucket.products.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, units]) => ({ name, units })),
    })),
  };
}

/** Scores only the variants that actually sold inside the window. */
async function stockoutRiskVariantIds(
  linesByVariant: Map<string, { at: Date; quantity: number }[]>,
  days: AnalyticsWindow,
  now: Date,
) {
  const variantIds = [...linesByVariant.keys()];
  if (variantIds.length === 0) return new Set<string>();

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    select: { id: true, stock: true, price: true },
  });

  const risky = new Set<string>();
  for (const variant of variants) {
    const lines = linesByVariant.get(variant.id) ?? [];
    const forecast = buildForecast({
      stock: variant.stock,
      price: Number(variant.price),
      observations: lines.length,
      tiers: tierUnits(days, lines, now.getTime()),
      lowStockThreshold: COMMERCE.lowStockThreshold,
    });
    if (forecast.stockoutRisk) risky.add(variant.id);
  }
  return risky;
}

// ---------------------------------------------------------------------------
// Aggregation job
// ---------------------------------------------------------------------------

export async function aggregateAnalytics() {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const runKey = `daily:${day.toISOString().slice(0, 10)}`;
  const run = await prisma.analyticsAggregationRun.upsert({
    where: { runKey },
    update: { status: 'RUNNING', startedAt: new Date(), error: null },
    create: { runKey, status: 'RUNNING' },
  });

  try {
    const productRows = await aggregateProductDaily(day);
    const districtRows = await aggregateDistrictDaily(day);
    const forecast = await snapshotDemandForecasts();
    const rows = productRows + districtRows + forecast.rows;

    await prisma.analyticsAggregationRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', completedAt: new Date(), rowsProcessed: rows },
    });
    return {
      runKey,
      rows,
      productRows,
      districtRows,
      forecastRows: forecast.rows,
      stockAlerts: forecast.alerts,
    };
  } catch (error) {
    await prisma.analyticsAggregationRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown aggregation error',
      },
    });
    throw error;
  }
}

async function aggregateProductDaily(day: Date) {
  const products = await prisma.product.findMany({
    include: {
      variants: {
        include: { orderItems: { where: { vendorOrder: { createdAt: { gte: day } } } } },
      },
      analyticsEvents: { where: { createdAt: { gte: day } } },
    },
  });

  let rows = 0;
  for (const product of products) {
    const count = (type: string) =>
      product.analyticsEvents.filter((event) => event.type === type).length;
    const items = product.variants.flatMap((variant) => variant.orderItems);
    const values = {
      impressions: count('IMPRESSION'),
      views: count('VIEW'),
      cartAdds: count('ADD_TO_CART'),
      checkouts: count('CHECKOUT_STARTED'),
      purchases: items.length,
      unitsSold: items.reduce((sum, item) => sum + item.quantity, 0),
      revenue: items.reduce((sum, item) => sum.plus(item.lineTotal), new Prisma.Decimal(0)),
    };
    await prisma.productDailyAggregate.upsert({
      where: { productId_date: { productId: product.id, date: day } },
      update: values,
      create: { productId: product.id, date: day, ...values },
    });
    rows += 1;
  }
  return rows;
}

/**
 * Fills `ProductDistrictDailyAggregate`, which nothing wrote to before. Orders
 * are keyed on the delivery district; views and search demand on the viewer
 * district recorded with the analytics event.
 */
async function aggregateDistrictDaily(day: Date) {
  const [orderItems, events] = await Promise.all([
    prisma.orderItem.findMany({
      where: { vendorOrder: { createdAt: { gte: day } } },
      select: {
        quantity: true,
        lineTotal: true,
        variant: { select: { productId: true } },
        vendorOrder: { select: { status: true, order: { select: { district: true } } } },
      },
    }),
    prisma.productAnalyticsEvent.findMany({
      where: { createdAt: { gte: day }, district: { not: null } },
      select: { productId: true, type: true, district: true, searchQuery: true },
    }),
  ]);

  interface Row {
    productId: string;
    district: JharkhandDistrict;
    views: number;
    cartAdds: number;
    unitsSold: number;
    gmv: Prisma.Decimal;
    rtoCount: number;
    searchDemand: number;
  }

  const rows = new Map<string, Row>();
  const rowFor = (productId: string, district: JharkhandDistrict) => {
    const key = `${productId}:${district}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const created: Row = {
      productId,
      district,
      views: 0,
      cartAdds: 0,
      unitsSold: 0,
      gmv: new Prisma.Decimal(0),
      rtoCount: 0,
      searchDemand: 0,
    };
    rows.set(key, created);
    return created;
  };

  for (const item of orderItems) {
    if (item.vendorOrder.status === FulfillmentStatus.CANCELLED) continue;
    const row = rowFor(item.variant.productId, item.vendorOrder.order.district);
    if (item.vendorOrder.status === FulfillmentStatus.RTO) {
      row.rtoCount += 1;
      continue;
    }
    row.unitsSold += item.quantity;
    row.gmv = row.gmv.plus(item.lineTotal);
  }

  for (const event of events) {
    if (!event.district) continue;
    const row = rowFor(event.productId, event.district);
    if (event.type === 'VIEW') row.views += 1;
    if (event.type === 'ADD_TO_CART') row.cartAdds += 1;
    if (event.searchQuery) row.searchDemand += 1;
  }

  for (const row of rows.values()) {
    const values = {
      views: row.views,
      cartAdds: row.cartAdds,
      unitsSold: row.unitsSold,
      gmv: row.gmv,
      rtoCount: row.rtoCount,
      searchDemand: row.searchDemand,
    };
    await prisma.productDistrictDailyAggregate.upsert({
      where: {
        productId_district_date: { productId: row.productId, district: row.district, date: day },
      },
      update: values,
      create: { productId: row.productId, district: row.district, date: day, ...values },
    });
  }
  return rows.size;
}

/**
 * Writes one `DemandForecastSnapshot` per active variant so forecast history is
 * queryable, and raises a STOCK notification for anything crossing into
 * stockout risk.
 */
async function snapshotDemandForecasts() {
  const now = new Date();
  const days: AnalyticsWindow = 90;
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      sku: true,
      stock: true,
      price: true,
      product: { select: { id: true, name: true } },
      orderItems: {
        where: {
          vendorOrder: { createdAt: { gte: since(days) }, status: { in: DEMAND_STATUSES } },
        },
        select: { quantity: true, vendorOrder: { select: { createdAt: true } } },
      },
    },
  });

  const explanation = forecastExplanation(days);
  const alerts: AdminNotificationInput[] = [];
  let rows = 0;

  for (const variant of variants) {
    const lines = variant.orderItems.map((item) => ({
      at: item.vendorOrder.createdAt,
      quantity: item.quantity,
    }));
    const tiers = tierUnits(days, lines, now.getTime());
    const forecast = buildForecast({
      stock: variant.stock,
      price: Number(variant.price),
      observations: lines.length,
      tiers,
      lowStockThreshold: COMMERCE.lowStockThreshold,
    });

    await prisma.demandForecastSnapshot.create({
      data: {
        variantId: variant.id,
        forecast7: forecast.forecast7,
        forecast30: forecast.forecast30,
        reorderQuantity: forecast.recommendedReorder,
        dailyVelocity: new Prisma.Decimal(forecast.dailyVelocity),
        confidence: forecast.confidence,
        explanation: {
          text: explanation,
          days,
          tiers: tiers.map((tier) => ({
            days: tier.days,
            weight: tier.weight,
            units: tier.units,
          })),
          stock: variant.stock,
          daysOfCover: forecast.daysOfCover,
          lowStockThreshold: COMMERCE.lowStockThreshold,
        },
        calculatedAt: now,
      },
    });
    rows += 1;

    if (forecast.stockoutRisk) alerts.push(stockAlert(variant, forecast));
  }

  return { rows, alerts: await createAdminNotifications(alerts, now) };
}

export function stockAlert(
  variant: {
    id: string;
    label: string;
    sku: string;
    stock: number;
    product: { name: string };
  },
  forecast: Pick<
    ReturnType<typeof buildForecast>,
    'daysOfCover' | 'dailyVelocity' | 'recommendedReorder'
  >,
): AdminNotificationInput {
  const cover =
    forecast.daysOfCover === null
      ? 'no cover estimate'
      : `${forecast.daysOfCover} day${forecast.daysOfCover === 1 ? '' : 's'} of cover left`;
  return {
    severity: stockoutSeverity(forecast.daysOfCover),
    category: AdminNotificationCategory.STOCK,
    title: `Stockout risk: ${variant.product.name}`,
    message:
      `${variant.label} (${variant.sku}) has ${variant.stock} in stock — ${cover} at ` +
      `${forecast.dailyVelocity} a day. Reorder ${forecast.recommendedReorder} to cover ` +
      '30 days plus safety stock.',
    actionHref: '/admin/inventory-intelligence',
    entityType: 'ProductVariant',
    entityId: variant.id,
  };
}

// ---------------------------------------------------------------------------
// CSV export (unchanged)
// ---------------------------------------------------------------------------

const safeCell=(v:unknown)=>{const text=String(v??'');const safe=/^[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replaceAll('"','""')}"`};
export async function productCsv(userId:string,days=30,q=''){await adminAccess(userId,'analytics:export');const {listProductAnalytics}=await import('./product-analytics.service.js');const rows=await listProductAnalytics(userId,{days,...(q?{q}:{})});const header=['Product','Vendor','Category','District','Views','Cart Adds','Units Sold','Conversion %','Revenue','Stock','Health Score','Health Band'];const csv=[header,...rows.map(r=>[r.name,r.vendor,r.category,r.district,r.views,r.cartAdds,r.purchases,r.conversionRate,r.revenue,r.stock,r.health.score,r.health.band])].map(row=>row.map(safeCell).join(',')).join('\r\n');await prisma.adminAuditLog.create({data:{actorId:userId,action:'PRODUCT_ANALYTICS_EXPORT',entityType:'AnalyticsExport',entityId:randomUUID(),permission:'analytics:export',metadata:{days,q,rowCount:rows.length}}});return{csv,rowCount:rows.length};}
