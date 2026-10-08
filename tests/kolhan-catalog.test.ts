import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  kolhanSoapCategories,
  kolhanSoapProducts,
  legacyMarketplaceCategorySlugs,
} from '../prisma/kolhan-soap-catalog.js';

describe('Kolhan soap catalog seed data', () => {
  it('defines every supplied soap with its current price, 100g size, and category', () => {
    expect(kolhanSoapProducts).toEqual([
      expect.objectContaining({
        name: 'Kolhan Clay Soap',
        categorySlug: 'clay-soaps',
        price: '100.00',
        label: '100g',
      }),
      expect.objectContaining({
        name: 'Active bamboo Charcoal & Menthol Soap',
        categorySlug: 'honey-soaps',
        price: '130.00',
        label: '100g',
      }),
      expect.objectContaining({
        name: 'Goat Milk Soap',
        categorySlug: 'goat-milk-soaps',
        price: '110.00',
        label: '100g',
      }),
      expect.objectContaining({
        name: 'Honey Goat Milk Soap',
        categorySlug: 'honey-soaps',
        price: '110.00',
        label: '100g',
      }),
      expect.objectContaining({
        name: 'Mix Clay Soap',
        categorySlug: 'clay-soaps',
        price: '210.00',
        label: '100g',
      }),
      expect.objectContaining({
        name: 'Kojic Coffee Soap',
        categorySlug: 'handmade-soaps',
        price: '140.00',
        label: '100g',
      }),
    ]);
  });

  it('has all selected soap categories, including Handmade Soaps', () => {
    expect(kolhanSoapCategories.map(({ slug }) => slug)).toEqual([
      'clay-soaps',
      'honey-soaps',
      'goat-milk-soaps',
      'herbal-soaps',
      'botanical-soaps',
      'gift-sets',
      'handmade-soaps',
    ]);
  });

  it('does not publish soaps with unknown stock and no submitted product photo', () => {
    expect(kolhanSoapProducts.every((item) => item.initialStock === 0)).toBe(true);
    expect(kolhanSoapProducts.every((item) => item.initiallyPublished === false)).toBe(true);
  });

  it('only seeds soap drafts under a verified Kolhan vendor profile', () => {
    const seed = readFileSync(new URL('../prisma/seed.ts', import.meta.url), 'utf8');
    expect(seed).toContain("businessName: { equals: 'Kolhan', mode: 'insensitive' }");
    expect(seed).toContain('verificationStatus: VerificationStatus.VERIFIED');
    expect(seed).toContain('if (kolhanVendor)');
    expect(seed).toContain('vendorId: kolhanVendor.id');
  });

  it('keeps legacy categories identifiable for archival without deleting records', () => {
    expect(legacyMarketplaceCategorySlugs).toEqual([
      'forest-foods',
      'tribal-crafts',
      'handloom',
      'natural-wellness',
    ]);
  });

  it('archives old live listings and preserves their product records', () => {
    const migration = readFileSync(
      new URL(
        '../prisma/migrations/20261006120000_kolhan_soap_catalog/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('"is_published" = false');
    expect(migration).toContain('"lifecycle_status" = \'ARCHIVED\'');
    expect(migration).toContain("'forest-foods', 'tribal-crafts', 'handloom', 'natural-wellness', 'organic-produce'");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"products"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"categories"/i);
    expect(migration).not.toMatch(/UPDATE\s+"categories"/i);

    const search = readFileSync(
      new URL('../src/services/product-search.service.ts', import.meta.url),
      'utf8',
    );
    expect(search).toContain('isPublished: true');
    expect(search).toContain("'isActive'");
    expect(search).not.toContain('stock: { gt: 0 }');
  });
});
