import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Books list authorization', () => {
  it('checks finance permission before querying any list resource', () => {
    const source = readFileSync(new URL('../src/services/books-listing.ts', import.meta.url), 'utf8');
    const gate = source.indexOf("await adminAccess(userId, 'payouts:manage')");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(source.indexOf('switch (resource)'));
  });
});
