import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/api.ts', import.meta.url), 'utf8');
const vendor = readFileSync(new URL('../src/services/vendor.service.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/services/admin-category.service.ts', import.meta.url), 'utf8');

describe('universal product catalog contract', () => {
  it('allows a product without an origin district or weekly Haat', () => {
    expect(schema).toMatch(/district\s+JharkhandDistrict\?/);
    expect(schema).toMatch(/weeklyHaatDay\s+WeeklyHaatDay\?/);
    expect(routes).toContain('weeklyHaatId: z.string().min(1).optional()');
    expect(routes).toContain('district: z.enum(JharkhandDistrict).optional()');
    expect(routes).not.toContain('weeklyHaatDay: z.enum(WeeklyHaatDay)');
  });

  it('derives Haat scheduling on the server and validates active categories', () => {
    expect(vendor).toContain('resolveProductPlacement');
    expect(vendor).toContain('isEnabled: true');
    expect(vendor).toContain('isActive: true');
    expect(vendor).toContain('weeklyHaatDay: placement.weeklyHaatDay');
  });

  it('permission-checks and audits category management', () => {
    expect(admin).toContain("adminAccess(userId, 'moderation:manage')");
    expect(admin).toContain("permission: 'moderation:manage'");
    expect(routes).toContain("'/admin/categories'");
  });
});
