import { describe, expect, it } from 'vitest';
import {
  AdminNotificationCategory,
  AdminNotificationSeverity,
  ForecastConfidence,
} from '../src/generated/prisma/client.js';
import {
  buildForecast,
  normalizeQuery,
  parseWindow,
  stockAlert,
  stockoutSeverity,
  tierUnits,
  velocityTiers,
} from '../src/services/advanced-analytics.service.js';

const NOW = Date.UTC(2026, 8, 3);
const daysAgo = (days: number) => new Date(NOW - days * 86400000);

describe('advanced analytics', () => {
  it('groups Hindi marketplace aliases', () => {
    expect(normalizeQuery(' महुआ ')).toBe('mahua');
    expect(normalizeQuery('सोहराय')).toBe('sohrai');
  });
  it('normalizes spacing and casing', () => {
    expect(normalizeQuery('  Wild   Honey ')).toBe('wild honey');
  });
});

describe('analysis window', () => {
  it('accepts only 30, 60 and 90 days', () => {
    expect(parseWindow('60')).toBe(60);
    expect(parseWindow(90)).toBe(90);
  });
  it('falls back to 30 days for anything else', () => {
    expect(parseWindow('45')).toBe(30);
    expect(parseWindow(undefined)).toBe(30);
    expect(parseWindow('; drop table')).toBe(30);
  });
  it('reproduces the original 7 / 30 / 90 tiers at 90 days', () => {
    expect(velocityTiers(90).map((tier) => tier.days)).toEqual([7, 30, 90]);
    expect(velocityTiers(90).map((tier) => tier.weight)).toEqual([0.5, 0.3, 0.2]);
  });
});

describe('tier units', () => {
  it('counts each order line into every window that contains it', () => {
    const lines = [
      { at: daysAgo(1), quantity: 2 },
      { at: daysAgo(20), quantity: 5 },
      { at: daysAgo(80), quantity: 9 },
    ];
    expect(tierUnits(90, lines, NOW).map((tier) => tier.units)).toEqual([2, 7, 16]);
  });
});

describe('demand forecast', () => {
  const tiers = [
    { days: 7, weight: 0.5, units: 14 },
    { days: 30, weight: 0.3, units: 30 },
    { days: 90, weight: 0.2, units: 90 },
  ];

  it('blends the three windows at 50 / 30 / 20', () => {
    // (14/7)*0.5 + (30/30)*0.3 + (90/90)*0.2 = 1 + 0.3 + 0.2
    const forecast = buildForecast({
      stock: 30,
      price: 100,
      observations: 8,
      tiers,
      lowStockThreshold: 5,
    });
    expect(forecast.dailyVelocity).toBe(1.5);
    expect(forecast.forecast7).toBe(11);
    expect(forecast.forecast30).toBe(45);
  });

  it('reports days of cover and flags stockout risk under a week', () => {
    const forecast = buildForecast({
      stock: 6,
      price: 100,
      observations: 8,
      tiers,
      lowStockThreshold: 5,
    });
    expect(forecast.daysOfCover).toBe(4);
    expect(forecast.stockoutRisk).toBe(true);
    expect(forecast.classification).toBe('critical');
  });

  it('flags stock under the low-stock threshold even with weeks of cover', () => {
    const slow = [
      { days: 7, weight: 0.5, units: 0 },
      { days: 30, weight: 0.3, units: 1 },
      { days: 90, weight: 0.2, units: 1 },
    ];
    const forecast = buildForecast({
      stock: 3,
      price: 100,
      observations: 2,
      tiers: slow,
      lowStockThreshold: 5,
    });
    expect(forecast.belowThreshold).toBe(true);
    expect(forecast.daysOfCover).toBeGreaterThan(7);
    expect(forecast.stockoutRisk).toBe(true);
  });

  it('never flags risk for a variant with no demand', () => {
    const forecast = buildForecast({
      stock: 0,
      price: 100,
      observations: 0,
      tiers: tiers.map((tier) => ({ ...tier, units: 0 })),
      lowStockThreshold: 5,
    });
    expect(forecast.dailyVelocity).toBe(0);
    expect(forecast.daysOfCover).toBeNull();
    expect(forecast.stockoutRisk).toBe(false);
    expect(forecast.classification).toBe('dead');
  });

  it('prices revenue at risk from the unmet portion of the 30-day forecast', () => {
    const forecast = buildForecast({
      stock: 30,
      price: 250,
      observations: 8,
      tiers,
      lowStockThreshold: 5,
    });
    // forecast30 45 - stock 30 = 15 units short * 250
    expect(forecast.revenueAtRisk.toFixed(2)).toBe('3750.00');
  });

  it('returns ForecastConfidence enum values', () => {
    const at = (observations: number) =>
      buildForecast({ stock: 1, price: 1, observations, tiers, lowStockThreshold: 5 }).confidence;
    expect(at(20)).toBe(ForecastConfidence.HIGH);
    expect(at(5)).toBe(ForecastConfidence.MEDIUM);
    expect(at(4)).toBe(ForecastConfidence.LOW);
  });
});

describe('stock notifications', () => {
  it('escalates severity below three days of cover', () => {
    expect(stockoutSeverity(2)).toBe(AdminNotificationSeverity.CRITICAL);
    expect(stockoutSeverity(6)).toBe(AdminNotificationSeverity.WARNING);
    expect(stockoutSeverity(null)).toBe(AdminNotificationSeverity.WARNING);
  });

  it('builds a STOCK notification addressed to the variant', () => {
    const alert = stockAlert(
      { id: 'var_1', label: '500g', sku: 'MAHUA-500', stock: 4, product: { name: 'Mahua honey' } },
      { daysOfCover: 2, dailyVelocity: 1.5, recommendedReorder: 52 },
    );
    expect(alert.category).toBe(AdminNotificationCategory.STOCK);
    expect(alert.severity).toBe(AdminNotificationSeverity.CRITICAL);
    expect(alert.entityType).toBe('ProductVariant');
    expect(alert.entityId).toBe('var_1');
    expect(alert.title).toContain('Mahua honey');
    expect(alert.message).toContain('2 days of cover left');
    expect(alert.message).toContain('Reorder 52');
    expect(alert.actionHref).toBe('/admin/inventory-intelligence');
  });
});
