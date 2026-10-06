import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { writeAudit } from '../utils/audit-log.js';
import { adminAccess } from './admin.service.js';

export interface CategoryInput {
  name: string;
  nameHi?: string;
  description?: string;
  descriptionHi?: string;
  displayOrder: number;
  isFeatured: boolean;
}

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const clean = (value: string | undefined) => value?.trim() || null;

export async function categories(userId: string) {
  await adminAccess(userId, 'moderation:manage');
  return prisma.category.findMany({ orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: true } } } });
}

export async function createCategory(userId: string, requestId: string | undefined, input: CategoryInput) {
  await adminAccess(userId, 'moderation:manage');
  const slug = slugify(input.name);
  if (!slug) throw new ApiError(422, 'Category name must contain letters or numbers.', 'CATEGORY_SLUG_INVALID');
  const duplicate = await prisma.category.findFirst({ where: { OR: [{ slug }, { name: { equals: input.name, mode: 'insensitive' } }] } });
  if (duplicate) throw new ApiError(409, 'A category with this name already exists.', 'CATEGORY_EXISTS');
  const category = await prisma.category.create({ data: { slug, name: input.name.trim(), nameHi: clean(input.nameHi), description: clean(input.description), descriptionHi: clean(input.descriptionHi), displayOrder: input.displayOrder, isFeatured: input.isFeatured } });
  await writeAudit(prisma, { event: 'CATEGORY_CREATED', actorId: userId, entityType: 'Category', entityId: category.id, requestId, permission: 'moderation:manage', nextState: { slug: category.slug, name: category.name } });
  return category;
}

export async function updateCategory(userId: string, id: string, requestId: string | undefined, input: CategoryInput) {
  await adminAccess(userId, 'moderation:manage');
  const previous = await prisma.category.findUnique({ where: { id } });
  if (!previous) throw new ApiError(404, 'Category was not found.', 'CATEGORY_NOT_FOUND');
  const slug = slugify(input.name);
  const duplicate = await prisma.category.findFirst({ where: { id: { not: id }, OR: [{ slug }, { name: { equals: input.name, mode: 'insensitive' } }] } });
  if (duplicate) throw new ApiError(409, 'A category with this name already exists.', 'CATEGORY_EXISTS');
  const category = await prisma.category.update({ where: { id }, data: { slug, name: input.name.trim(), nameHi: clean(input.nameHi), description: clean(input.description), descriptionHi: clean(input.descriptionHi), displayOrder: input.displayOrder, isFeatured: input.isFeatured } });
  await writeAudit(prisma, { event: 'CATEGORY_UPDATED', actorId: userId, entityType: 'Category', entityId: id, requestId, permission: 'moderation:manage', previousState: { slug: previous.slug, name: previous.name }, nextState: { slug: category.slug, name: category.name } });
  return category;
}

export async function setCategoryActive(userId: string, id: string, requestId: string | undefined, isActive: boolean) {
  await adminAccess(userId, 'moderation:manage');
  const previous = await prisma.category.findUnique({ where: { id } });
  if (!previous) throw new ApiError(404, 'Category was not found.', 'CATEGORY_NOT_FOUND');
  const category = await prisma.category.update({ where: { id }, data: { isActive } });
  await writeAudit(prisma, { event: 'CATEGORY_UPDATED', actorId: userId, entityType: 'Category', entityId: id, requestId, permission: 'moderation:manage', previousState: { isActive: previous.isActive }, nextState: { isActive } });
  return category;
}
