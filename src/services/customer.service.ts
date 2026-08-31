import { CartAbandonmentStatus, Prisma, VerificationStatus } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';

const safeUser = { id: true, name: true, email: true, mobile: true, role: true, createdAt: true } as const;
const cartInclude = { items: { include: { variant: { include: { product: { include: { vendor: { select: { businessName: true, verificationStatus: true } }, category: true } } } } } } } satisfies Prisma.CartInclude;

export const getProfile = (userId: string) => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: safeUser });
export async function updateProfile(userId: string, data: { name: string; email: string; mobile: string }) { return prisma.user.update({ where: { id: userId }, data, select: safeUser }); }
export const listAddresses = (userId: string) => prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
export async function saveAddress(userId: string, id: string | undefined, data: Prisma.AddressUncheckedCreateWithoutUserInput) {
  return prisma.$transaction(async (tx) => {
    if (id && !(await tx.address.findFirst({ where: { id, userId } }))) throw new ApiError(404, 'Address was not found.', 'ADDRESS_NOT_FOUND');
    const count = await tx.address.count({ where: { userId } });
    const makeDefault = data.isDefault || count === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    return id ? tx.address.update({ where: { id }, data: { ...data, isDefault: makeDefault } }) : tx.address.create({ data: { ...data, userId, isDefault: makeDefault } });
  });
}
export async function deleteAddress(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const address = await tx.address.findFirst({ where: { id, userId } });
    if (!address) throw new ApiError(404, 'Address was not found.', 'ADDRESS_NOT_FOUND');
    await tx.address.delete({ where: { id } });
    if (address.isDefault) { const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }); if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } }); }
  });
}
export async function setDefaultAddress(userId: string, id: string) { return prisma.$transaction(async (tx) => { if (!(await tx.address.findFirst({ where: { id, userId } }))) throw new ApiError(404, 'Address was not found.', 'ADDRESS_NOT_FOUND'); await tx.address.updateMany({ where: { userId }, data: { isDefault: false } }); return tx.address.update({ where: { id }, data: { isDefault: true } }); }); }

async function activeCart(userId: string) { const existing = await prisma.cart.findFirst({ where: { customerId: userId, order: null }, include: cartInclude }); return existing ?? prisma.cart.create({ data: { customerId: userId }, include: cartInclude }); }
export const getCart = activeCart;
export async function addCartItem(userId: string, variantId: string, quantity: number) {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: { include: { vendor: true } } } });
  if (!variant || !variant.isActive || !variant.product.isPublished || variant.product.vendor.verificationStatus !== VerificationStatus.VERIFIED) throw new ApiError(422, 'Product variant is unavailable.', 'VARIANT_UNAVAILABLE');
  if (variant.stock < quantity) throw new ApiError(409, `Only ${variant.stock} item(s) are available.`, 'INSUFFICIENT_STOCK');
  const cart = await activeCart(userId);
  await prisma.cartItem.upsert({ where: { cartId_variantId: { cartId: cart.id, variantId } }, create: { cartId: cart.id, variantId, quantity }, update: { quantity } });
  return prisma.cart.update({ where: { id: cart.id }, data: { abandonmentStatus: CartAbandonmentStatus.ACTIVE }, include: cartInclude });
}
export async function updateCartItem(userId: string, itemId: string, quantity: number) { const item = await prisma.cartItem.findFirst({ where: { id: itemId, cart: { customerId: userId, order: null } }, include: { variant: true } }); if (!item) throw new ApiError(404, 'Cart item was not found.', 'CART_ITEM_NOT_FOUND'); if (item.variant.stock < quantity) throw new ApiError(409, `Only ${item.variant.stock} item(s) are available.`, 'INSUFFICIENT_STOCK'); await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } }); return activeCart(userId); }
export async function removeCartItem(userId: string, itemId: string) { const deleted = await prisma.cartItem.deleteMany({ where: { id: itemId, cart: { customerId: userId, order: null } } }); if (!deleted.count) throw new ApiError(404, 'Cart item was not found.', 'CART_ITEM_NOT_FOUND'); return activeCart(userId); }

export const listWishlist = (userId: string) => prisma.wishlistItem.findMany({ where: { userId }, include: { product: { include: { variants: { where: { isActive: true } }, vendor: { select: { businessName: true } }, category: true } } }, orderBy: { createdAt: 'desc' } });
export async function toggleWishlist(userId: string, productId: string) { if (!(await prisma.product.findFirst({ where: { id: productId, isPublished: true } }))) throw new ApiError(404, 'Product was not found.', 'PRODUCT_NOT_FOUND'); const existing = await prisma.wishlistItem.findUnique({ where: { userId_productId: { userId, productId } } }); if (existing) { await prisma.wishlistItem.delete({ where: { id: existing.id } }); return { wishlisted: false }; } await prisma.wishlistItem.create({ data: { userId, productId } }); return { wishlisted: true }; }
export const listOrders = (userId: string) => prisma.order.findMany({ where: { customerId: userId }, include: { vendorOrders: { include: { items: true, statusLogs: { orderBy: { createdAt: 'asc' } } } }, paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' } });
export async function getOrder(userId: string, id: string) { const order = await prisma.order.findFirst({ where: { id, customerId: userId }, include: { vendorOrders: { include: { items: true, statusLogs: { orderBy: { createdAt: 'asc' } } } }, paymentIntents: true } }); if (!order) throw new ApiError(404, 'Order was not found.', 'ORDER_NOT_FOUND'); return order; }
