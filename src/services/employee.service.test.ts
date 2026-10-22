import { describe, expect, it } from 'vitest';
import { assertPayrollPending, payrollAmounts } from './employee.service.js';

describe('employee payroll rules', () => {
  it('calculates gross and net with paise precision', () => {
    const amounts = payrollAmounts({ baseSalary: '25000.10', allowances: '1250.25', deductions: '250.15' });
    expect(amounts.grossPay.toString()).toBe('26250.35');
    expect(amounts.netPay.toString()).toBe('26000.2');
  });

  it('rejects deductions larger than gross pay', () => {
    expect(() => payrollAmounts({ baseSalary: 100, allowances: 0, deductions: 100.01 })).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_DEDUCTIONS_EXCEED_GROSS' }),
    );
  });

  it('rejects negative payroll amounts', () => {
    expect(() => payrollAmounts({ baseSalary: -1, allowances: 0, deductions: 0 })).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_AMOUNT_INVALID' }),
    );
  });

  it('allows only pending payroll to be marked paid', () => {
    expect(() => assertPayrollPending('PENDING')).not.toThrow();
    expect(() => assertPayrollPending('PAID')).toThrowError(
      expect.objectContaining({ code: 'PAYROLL_ALREADY_SETTLED' }),
    );
  });
});

import { employeeWhere, goalWhere, payrollWhere, reviewWhere } from './employee.service.js';

describe('employee list filters', () => {
  it('builds case-insensitive employee search and active state filters', () => {
    expect(employeeWhere({ q: 'Mira', isActive: 'false' })).toEqual({
      isActive: false,
      OR: [
        { employeeCode: { contains: 'Mira', mode: 'insensitive' } },
        { fullName: { contains: 'Mira', mode: 'insensitive' } },
        { email: { contains: 'Mira', mode: 'insensitive' } },
        { department: { contains: 'Mira', mode: 'insensitive' } },
        { designation: { contains: 'Mira', mode: 'insensitive' } },
      ],
    });
  });

  it('filters payroll by employee, period, status and joined employee identity', () => {
    expect(payrollWhere({ employeeId: 'emp-1', periodYear: '2026', periodMonth: '10', status: 'PENDING', q: 'Mira' })).toEqual({
      employeeId: 'emp-1', periodYear: 2026, periodMonth: 10, status: 'PENDING',
      employee: { OR: [
        { fullName: { contains: 'Mira', mode: 'insensitive' } },
        { employeeCode: { contains: 'Mira', mode: 'insensitive' } },
      ] },
    });
  });

  it('filters goals and review date ranges', () => {
    expect(goalWhere({ employeeId: 'emp-1', status: 'ACTIVE', q: 'onboard' })).toMatchObject({ employeeId: 'emp-1', status: 'ACTIVE' });
    expect(reviewWhere({ from: '2026-01-01', to: '2026-03-31', employeeId: 'emp-1' })).toEqual({
      employeeId: 'emp-1', reviewedAt: { gte: new Date('2026-01-01'), lte: new Date('2026-03-31') },
    });
  });
});
