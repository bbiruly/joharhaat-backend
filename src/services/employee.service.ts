import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { money } from '../utils/money.js';
import { writeAudit } from '../utils/audit-log.js';
import { pagination } from '../utils/pagination.js';
import { adminAccess } from './admin.service.js';

export function payrollAmounts(input: { baseSalary: string | number; allowances: string | number; deductions: string | number }) {
  const baseSalary = money(input.baseSalary);
  const allowances = money(input.allowances);
  const deductions = money(input.deductions);
  if (baseSalary.isNegative() || allowances.isNegative() || deductions.isNegative())
    throw new ApiError(422, 'Payroll amounts cannot be negative.', 'PAYROLL_AMOUNT_INVALID');
  const grossPay = money(baseSalary.plus(allowances));
  const netPay = money(grossPay.minus(deductions));
  if (netPay.isNegative()) throw new ApiError(422, 'Deductions cannot exceed gross pay.', 'PAYROLL_DEDUCTIONS_EXCEED_GROSS');
  return { baseSalary, allowances, deductions, grossPay, netPay };
}

export function assertPayrollPending(status: string) {
  if (status !== 'PENDING') throw new ApiError(409, 'This payroll record is already settled.', 'PAYROLL_ALREADY_SETTLED');
}

export interface EmployeePageQuery {
  page?: unknown; pageSize?: unknown; q?: unknown; employeeId?: unknown;
  isActive?: unknown; periodYear?: unknown; periodMonth?: unknown;
  status?: unknown; from?: unknown; to?: unknown;
}

const queryText = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const queryInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};
const queryDate = (value: unknown) => {
  const text = queryText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function employeeWhere(query: EmployeePageQuery): Prisma.EmployeeWhereInput {
  const q = queryText(query.q);
  const isActive = queryText(query.isActive);
  return {
    ...(isActive === 'true' || isActive === 'false' ? { isActive: isActive === 'true' } : {}),
    ...(q ? { OR: [
      { employeeCode: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { department: { contains: q, mode: 'insensitive' } },
      { designation: { contains: q, mode: 'insensitive' } },
    ] } : {}),
  };
}

export function payrollWhere(query: EmployeePageQuery): Prisma.EmployeePayrollWhereInput {
  const employeeId = queryText(query.employeeId);
  const year = queryInt(query.periodYear);
  const month = queryInt(query.periodMonth);
  const status = queryText(query.status);
  const q = queryText(query.q);
  return {
    ...(employeeId ? { employeeId } : {}),
    ...(year && year >= 2000 && year <= 2200 ? { periodYear: year } : {}),
    ...(month && month >= 1 && month <= 12 ? { periodMonth: month } : {}),
    ...(status === 'PENDING' || status === 'PAID' ? { status } : {}),
    ...(q ? { employee: { OR: [
      { fullName: { contains: q, mode: 'insensitive' } },
      { employeeCode: { contains: q, mode: 'insensitive' } },
    ] } } : {}),
  };
}

export function goalWhere(query: EmployeePageQuery): Prisma.EmployeeGoalWhereInput {
  const employeeId = queryText(query.employeeId);
  const status = queryText(query.status);
  const q = queryText(query.q);
  return {
    ...(employeeId ? { employeeId } : {}),
    ...(status === 'ACTIVE' || status === 'COMPLETED' || status === 'CANCELLED' ? { status } : {}),
    ...(q ? { OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { employee: { fullName: { contains: q, mode: 'insensitive' } } },
      { employee: { employeeCode: { contains: q, mode: 'insensitive' } } },
    ] } : {}),
  };
}

export function reviewWhere(query: EmployeePageQuery): Prisma.EmployeeReviewWhereInput {
  const employeeId = queryText(query.employeeId);
  const from = queryDate(query.from);
  const to = queryDate(query.to);
  const q = queryText(query.q);
  return {
    ...(employeeId ? { employeeId } : {}),
    ...(from || to ? { reviewedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { employee: { OR: [
      { fullName: { contains: q, mode: 'insensitive' } },
      { employeeCode: { contains: q, mode: 'insensitive' } },
    ] } } : {}),
  };
}

function pageValues(query: EmployeePageQuery) {
  const { page, pageSize, skip, take } = pagination(queryInt(query.page), queryInt(query.pageSize));
  return { page, pageSize, skip, take };
}

export async function summary(userId: string) {
  await adminAccess(userId, 'employees:manage');
  const now = new Date();
  const [activeEmployees, pendingPayroll, pendingPayrollTotal] = await Promise.all([
    prisma.employee.count({ where: { isActive: true } }),
    prisma.employeePayroll.count({ where: { periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, status: 'PENDING' } }),
    prisma.employeePayroll.aggregate({ where: { periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, status: 'PENDING' }, _sum: { netPay: true } }),
  ]);
  return { activeEmployees, pendingPayroll, pendingPayrollTotal: pendingPayrollTotal._sum.netPay?.toString() ?? '0.00', periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1 };
}

export async function listEmployees(userId: string, query: EmployeePageQuery = {}) {
  await adminAccess(userId, 'employees:manage');
  const { page, pageSize, skip, take } = pageValues(query);
  const where = employeeWhere(query);
  const [items, total] = await Promise.all([
    prisma.employee.findMany({ where, include: { _count: { select: { payroll: true, goals: true, reviews: true } } }, orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }], skip, take }),
    prisma.employee.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function employeeDetail(userId: string, id: string) {
  await adminAccess(userId, 'employees:manage');
  const employee = await prisma.employee.findUnique({ where: { id }, include: { _count: { select: { payroll: true, goals: true, reviews: true } }, payroll: { orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 1 }, reviews: { orderBy: { reviewedAt: 'desc' }, take: 1 } } });
  if (!employee) throw new ApiError(404, 'Employee was not found.', 'EMPLOYEE_NOT_FOUND');
  return employee;
}

export async function listPayroll(userId: string, query: EmployeePageQuery = {}) {
  await adminAccess(userId, 'employees:manage');
  const { page, pageSize, skip, take } = pageValues(query);
  const where = payrollWhere(query);
  const [items, total] = await Promise.all([
    prisma.employeePayroll.findMany({ where, include: { employee: { select: { id: true, employeeCode: true, fullName: true, department: true, designation: true } } }, orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { employee: { fullName: 'asc' } }], skip, take }),
    prisma.employeePayroll.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function listGoals(userId: string, query: EmployeePageQuery = {}) {
  await adminAccess(userId, 'employees:manage');
  const { page, pageSize, skip, take } = pageValues(query);
  const where = goalWhere(query);
  const [items, total] = await Promise.all([
    prisma.employeeGoal.findMany({ where, include: { employee: { select: { id: true, employeeCode: true, fullName: true, department: true, designation: true } } }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], skip, take }),
    prisma.employeeGoal.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function listReviews(userId: string, query: EmployeePageQuery = {}) {
  await adminAccess(userId, 'employees:manage');
  const { page, pageSize, skip, take } = pageValues(query);
  const where = reviewWhere(query);
  const [items, total] = await Promise.all([
    prisma.employeeReview.findMany({ where, include: { employee: { select: { id: true, employeeCode: true, fullName: true, department: true, designation: true } } }, orderBy: [{ reviewedAt: 'desc' }, { employee: { fullName: 'asc' } }], skip, take }),
    prisma.employeeReview.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function saveEmployee(userId: string, requestId: string | undefined, input: { id?: string; employeeCode?: string; fullName: string; email?: string | null; mobile?: string | null; department: string; designation: string; joinedAt: string; isActive?: boolean }) {
  await adminAccess(userId, 'employees:manage');
  const data = { fullName: input.fullName, email: input.email ?? null, mobile: input.mobile ?? null, department: input.department, designation: input.designation, joinedAt: new Date(input.joinedAt), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  const before = input.id ? await prisma.employee.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new ApiError(404, 'Employee was not found.', 'EMPLOYEE_NOT_FOUND');
  const employee = input.id
    ? await prisma.employee.update({ where: { id: input.id }, data })
    : await prisma.employee.create({ data: { ...data, employeeCode: input.employeeCode! } });
  await writeAudit(prisma, { event: input.id ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED', actorId: userId, entityType: 'Employee', entityId: employee.id, requestId, permission: 'employees:manage', ...(before ? { previousState: { employeeCode: before.employeeCode, fullName: before.fullName, department: before.department, designation: before.designation, isActive: before.isActive } } : {}), nextState: { employeeCode: employee.employeeCode, fullName: employee.fullName, department: employee.department, designation: employee.designation, isActive: employee.isActive } });
  return employee;
}

export async function createPayroll(userId: string, requestId: string | undefined, input: { employeeId: string; periodYear: number; periodMonth: number; baseSalary: number; allowances: number; deductions: number; notes?: string }) {
  await adminAccess(userId, 'employees:manage');
  const amount = payrollAmounts(input);
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
  if (!employee) throw new ApiError(404, 'Employee was not found.', 'EMPLOYEE_NOT_FOUND');
  const payroll = await prisma.employeePayroll.create({ data: { ...input, ...amount, notes: input.notes ?? null } });
  await writeAudit(prisma, { event: 'PAYROLL_RECORDED', actorId: userId, entityType: 'EmployeePayroll', entityId: payroll.id, requestId, permission: 'employees:manage', nextState: { employeeId: payroll.employeeId, periodYear: payroll.periodYear, periodMonth: payroll.periodMonth, status: payroll.status } });
  return payroll;
}

export async function markPayrollPaid(userId: string, requestId: string | undefined, id: string, input: { paidAt: string; paymentReference: string }) {
  await adminAccess(userId, 'employees:manage');
  const before = await prisma.employeePayroll.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, 'Payroll record was not found.', 'PAYROLL_NOT_FOUND');
  assertPayrollPending(before.status);
  const payroll = await prisma.employeePayroll.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(input.paidAt), paymentReference: input.paymentReference } });
  await writeAudit(prisma, { event: 'PAYROLL_PAID', actorId: userId, entityType: 'EmployeePayroll', entityId: id, requestId, permission: 'employees:manage', previousState: { status: before.status }, nextState: { status: payroll.status, paidAt: payroll.paidAt!.toISOString() } });
  return payroll;
}

export async function saveGoal(userId: string, requestId: string | undefined, input: { id?: string; employeeId?: string; title: string; description?: string | null; dueAt?: string | null; status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' }) {
  await adminAccess(userId, 'employees:manage');
  const data = { title: input.title, description: input.description ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null, ...(input.status ? { status: input.status } : {}) };
  const goal = input.id
    ? await prisma.employeeGoal.update({ where: { id: input.id }, data })
    : await prisma.employeeGoal.create({ data: { ...data, employeeId: input.employeeId! } });
  await writeAudit(prisma, { event: 'EMPLOYEE_GOAL_SAVED', actorId: userId, entityType: 'EmployeeGoal', entityId: goal.id, requestId, permission: 'employees:manage', nextState: { employeeId: goal.employeeId, title: goal.title, status: goal.status } });
  return goal;
}

export async function createReview(userId: string, requestId: string | undefined, input: { employeeId: string; periodStart: string; periodEnd: string; rating: number; notes: string }) {
  await adminAccess(userId, 'employees:manage');
  if (new Date(input.periodStart) > new Date(input.periodEnd)) throw new ApiError(422, 'Review period start must be before its end.', 'REVIEW_PERIOD_INVALID');
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
  if (!employee) throw new ApiError(404, 'Employee was not found.', 'EMPLOYEE_NOT_FOUND');
  const review = await prisma.employeeReview.create({ data: { ...input, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd) } });
  await writeAudit(prisma, { event: 'EMPLOYEE_REVIEW_RECORDED', actorId: userId, entityType: 'EmployeeReview', entityId: review.id, requestId, permission: 'employees:manage', nextState: { employeeId: review.employeeId, periodStart: review.periodStart.toISOString(), periodEnd: review.periodEnd.toISOString(), rating: review.rating } });
  return review;
}
