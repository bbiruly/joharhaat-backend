import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertCategoryCanDelete } from '../src/services/admin-category.service.js';

const source = readFileSync(
  fileURLToPath(new URL('../src/services/admin-category.service.ts', import.meta.url)),
  'utf8',
);

describe('admin category deletion', () => {
  it('allows deletion only when no products reference the category', () => {
    expect(() => assertCategoryCanDelete(0)).not.toThrow();
    try {
      assertCategoryCanDelete(1);
      throw new Error('Expected category with products to be refused');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, code: 'CATEGORY_HAS_PRODUCTS' });
    }
  });

  it('checks the product relation, deletes and audits inside one transaction', () => {
    expect(source).toContain("await adminAccess(userId, 'moderation:manage')");
    expect(source).toContain('assertCategoryCanDelete(category._count.products)');
    expect(source).toContain("event: 'CATEGORY_DELETED'");
    expect(source).toContain('await writeAudit(tx,');
    expect(source).toContain("error.code === 'P2003'");
  });
});
