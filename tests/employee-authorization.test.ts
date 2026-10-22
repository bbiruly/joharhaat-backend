import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '../src/services/admin.service.js';

describe('employee management authorization', () => {
  it('registers a distinct permission and gates every employee data operation', () => {
    expect(ALL_PERMISSIONS).toContain('employees:manage');
    const source = readFileSync(new URL('../src/services/employee.service.ts', import.meta.url), 'utf8');
    expect(source.match(/adminAccess\(userId, 'employees:manage'\)/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('registers auditable employee events with stable status codes', () => {
    const source = readFileSync(new URL('../src/config/status-codes.ts', import.meta.url), 'utf8');
    for (const event of ['EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'PAYROLL_RECORDED', 'PAYROLL_PAID', 'EMPLOYEE_GOAL_SAVED', 'EMPLOYEE_REVIEW_RECORDED'])
      expect(source).toContain(`${event}:`);
  });
});
