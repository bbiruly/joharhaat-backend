import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findByCode, STATUS_CODES } from '../src/config/status-codes.js';

/**
 * Every audit row's `action` must be a registry code.
 *
 * Two write sites used to build it from a template literal — `VENDOR_${status}`
 * and `PRODUCT_${decision}` — so the table held a mix of stable codes and free
 * text. Nothing failed, because nothing read the table back; the audit-log
 * endpoint added in Phase 6 is what surfaced it. A filter built on one
 * convention silently hides every row written in the other, which is the worst
 * possible failure mode for an audit trail.
 */
/**
 * Comments are stripped first. Prose describing an action ("...action: revoke
 * every live session...") is not a code assignment, and matching it made this
 * test fail on its own documentation.
 */
const stripComments = (text: string) =>
  text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '');

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/services/${name}`, import.meta.url)), 'utf8');

const code = (name: string) => stripComments(source(name));

const services = [
  'admin.service.ts',
  'admin-customer.service.ts',
  'advanced-analytics.service.ts',
].map((name) => [name, code(name)] as const);

describe('admin audit trail', () => {
  it('never builds an audit action from a template literal', () => {
    for (const [name, text] of services) {
      // `action: \`...\`` in any adminAuditLog write. Backticks are the tell.
      const offenders = [...text.matchAll(/action\s*:\s*`[^`]*`/g)].map((match) => match[0]);
      expect(offenders, `${name} builds an audit action from a template literal`).toEqual([]);
    }
  });

  it('writes every audit action through codeOf()', () => {
    for (const [name, text] of services) {
      // Each `action:` inside an adminAuditLog/adminActionReason write should
      // read `codeOf(...)`, never a bare string.
      const assignments = [...text.matchAll(/action\s*:\s*([^,}\n]+)/g)].map((match) =>
        match[1]!.trim(),
      );
      expect(assignments.length, `${name} has no audit writes to check`).toBeGreaterThan(0);
      for (const value of assignments)
        expect(value.startsWith('codeOf('), `${name} writes action: ${value}`).toBe(true);
    }
  });

  it('resolves every registry code back to its entry', () => {
    for (const entry of Object.values(STATUS_CODES)) {
      const found = findByCode(entry.code);
      expect(found, `${entry.code} does not resolve`).toBeDefined();
      expect(found?.en).toBe(entry.en);
    }
  });

  it('has no duplicate codes across the five event groups', () => {
    const codes = Object.values(STATUS_CODES).map((entry) => entry.code);
    expect(new Set(codes).size, 'two events share one code').toBe(codes.length);
  });

  it('gates the audit reader on team:manage, not analytics:read', () => {
    // The rows carry previousState/nextState snapshots of team and customer
    // records, so this must not widen to every role that can read reports.
    const text = source('admin-audit.service.ts');
    expect(text).toContain("const VIEW_PERMISSION = 'team:manage' as const");
    expect(text).not.toContain("'analytics:read'");
  });
});
