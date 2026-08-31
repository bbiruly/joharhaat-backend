import { randomUUID } from 'node:crypto';
import {
  CartAbandonmentStatus,
  FulfillmentStatus,
  NotificationType,
  Prisma,
  VerificationStatus,
} from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import type { CheckoutInput } from '../schemas/checkout.schema.js';
import { ApiError } from '../utils/api-error.js';
import { allocateMoney, decimal, money, sumMoney } from '../utils/money.js';

const orderInclude = {
  vendorOrders: { include: { items: true, statusLogs: true } },
} satisfies Prisma.OrderInclude;

type CheckoutOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export type CheckoutResult = {
  order: CheckoutOrder;
  replayed: boolean;
  outboxIds: string[];
};

export function calculateCheckoutTotals(gmv: Prisma.Decimal, discount: Prisma.Decimal, courier: Prisma.Decimal) {
  if (discount.greaterThan(gmv)) throw new ApiError(422, 'Discount cannot exceed merchandise value.', 'INVALID_DISCOUNT');
  const taxable = money(gmv.minus(discount));
  const cgst = money(taxable.mul(env.CGST_RATE));
  const sgst = money(taxable.mul(env.SGST_RATE));
  return { gmv: money(gmv), discount: money(discount), taxable, cgst, sgst, courier: money(courier), total: money(taxable.plus(cgst).plus(sgst).plus(courier)) };
}

export function calculateCourierCharge(gmv: Prisma.Decimal) {
  return gmv.greaterThanOrEqualTo(1500) ? money(0) : money(79);
}

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

async function runSerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      if (!isRetryable(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
  throw new ApiError(409, 'Checkout could not be completed because inventory changed. Please retry.', 'TRANSACTION_CONFLICT');
}

export async function processCheckout(customerId: string, idempotencyKey: string, input: CheckoutInput): Promise<CheckoutResult> {
  const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
  if (existing) {
    if (existing.customerId !== customerId) throw new ApiError(409, 'This idempotency key belongs to another checkout.', 'IDEMPOTENCY_KEY_CONFLICT');
    return { order: existing, replayed: true, outboxIds: [] };
  }

  return runSerializable(() => prisma.$transaction(async (tx) => {
    const replay = await tx.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
    if (replay) {
      if (replay.customerId !== customerId) throw new ApiError(409, 'This idempotency key belongs to another checkout.', 'IDEMPOTENCY_KEY_CONFLICT');
      return { order: replay, replayed: true, outboxIds: [] };
    }

    const [cart, address] = await Promise.all([
      tx.cart.findFirst({ where: { id: input.cartId, customerId }, include: { items: true, order: true } }),
      tx.address.findFirst({ where: { id: input.deliveryAddressId, userId: customerId } }),
    ]);
    if (!cart) throw new ApiError(404, 'Cart was not found for this customer.', 'CART_NOT_FOUND');
    if (cart.order) throw new ApiError(409, 'This cart has already been checked out.', 'CART_ALREADY_CONVERTED');
    if (!address) throw new ApiError(404, 'Delivery address was not found for this customer.', 'ADDRESS_NOT_FOUND');

    const requested = new Map(input.items.map((item) => [item.variantId, item.quantity]));
    if (cart.items.length !== requested.size || cart.items.some((item) => requested.get(item.variantId) !== item.quantity)) {
      throw new ApiError(409, 'Requested items do not match the current cart. Refresh the cart and retry.', 'CART_CHANGED');
    }

    const variantIds = [...requested.keys()].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM product_variants WHERE id IN (${Prisma.join(variantIds)}) ORDER BY id FOR UPDATE`);
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { include: { vendor: { include: { owner: true } }, category: true } } },
    });
    if (variants.length !== variantIds.length) throw new ApiError(422, 'One or more product variants no longer exist.', 'VARIANT_UNAVAILABLE');

    const lines = variants.map((variant) => {
      const quantity = requested.get(variant.id)!;
      if (!variant.isActive || !variant.product.isPublished || variant.product.vendor.verificationStatus !== VerificationStatus.VERIFIED) {
        throw new ApiError(422, `${variant.product.name} is not available for checkout.`, 'PRODUCT_UNAVAILABLE');
      }
      if (variant.stock < quantity) throw new ApiError(409, `Only ${variant.stock} unit(s) of ${variant.product.name} (${variant.label}) remain.`, 'INSUFFICIENT_STOCK');
      return { variant, quantity, lineTotal: money(variant.price.mul(quantity)) };
    });

    const gmv = sumMoney(lines.map((line) => line.lineTotal));
    let coupon: Prisma.CouponGetPayload<object> | null = null;
    let discount = money(input.discountAmount);
    if (input.couponCode) {
      coupon = await tx.coupon.findUnique({ where: { code: input.couponCode } });
      const now = new Date();
      if (!coupon || !coupon.isActive || coupon.startsAt > now || coupon.expiresAt <= now || (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) || gmv.lessThan(coupon.minOrderValue)) throw new ApiError(422, 'Coupon is invalid, expired or not applicable.', 'COUPON_NOT_APPLICABLE');
      const userUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, userId: customerId } });
      if (userUses >= coupon.perUserLimit) throw new ApiError(409, 'Coupon usage limit has been reached.', 'COUPON_LIMIT_REACHED');
      discount = money(Prisma.Decimal.min(gmv.mul(coupon.percent), coupon.maxDiscount));
    }
    const courierCharge = calculateCourierCharge(gmv);
    const totals = calculateCheckoutTotals(gmv, discount, courierCharge);
    const groupedLines = new Map<string, typeof lines>();
    for (const line of lines) {
      const vendorId = line.variant.product.vendorId;
      groupedLines.set(vendorId, [...(groupedLines.get(vendorId) ?? []), line]);
    }
    const groups = [...groupedLines.entries()].map(([vendorId, vendorLines]) => ({ vendorId, lines: vendorLines, gmv: sumMoney(vendorLines.map((line) => line.lineTotal)) }));
    const weights = groups.map((group) => group.gmv);
    const discounts = allocateMoney(totals.discount, weights);
    const cgstShares = allocateMoney(totals.cgst, weights);
    const sgstShares = allocateMoney(totals.sgst, weights);
    const courierShares = allocateMoney(totals.courier, weights);

    const order = await tx.order.create({
      data: {
        orderNumber: `JH-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        idempotencyKey,
        customerId,
        cartId: cart.id,
        deliveryAddressId: address.id,
        gmv: totals.gmv,
        discount: totals.discount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        courierCharge: totals.courier,
        totalPayable: totals.total,
        recipientName: address.fullName,
        recipientMobile: address.mobile,
        addressLine1: address.line1,
        addressLine2: address.line2,
        district: address.district,
        postalCode: address.postalCode,
      },
    });
    if (coupon) {
      await tx.couponRedemption.create({ data: { couponId: coupon.id, userId: customerId, orderId: order.id, discountAmount: totals.discount } });
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }

    const outboxIds: string[] = [];
    for (const [index, group] of groups.entries()) {
      const commission = money(group.gmv.mul(env.ADMIN_COMMISSION_RATE));
      const vendorOrder = await tx.vendorOrder.create({
        data: {
          orderId: order.id,
          vendorId: group.vendorId,
          trackingId: `JHT-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
          gmv: group.gmv,
          adminCommission: commission,
          cgst: cgstShares[index]!,
          sgst: sgstShares[index]!,
          courierCharge: courierShares[index]!,
          netVendorPayout: money(group.gmv.minus(commission)),
          items: { create: group.lines.map(({ variant, quantity, lineTotal }) => ({
            variantId: variant.id,
            productName: variant.product.name,
            variantLabel: variant.label,
            sku: variant.sku,
            quantity,
            unitPrice: variant.price,
            lineTotal,
          })) },
          statusLogs: { create: { status: FulfillmentStatus.PENDING, actorUserId: customerId, note: 'Order placed by customer.' } },
        },
      });
      const vendor = group.lines[0]!.variant.product.vendor;
      const notification = await tx.notificationOutbox.create({
        data: {
          vendorId: vendor.id,
          vendorOrderId: vendorOrder.id,
          type: NotificationType.VENDOR_NEW_ORDER_SMS,
          recipient: vendor.owner.mobile,
          payload: { vendorOrderId: vendorOrder.id, orderNumber: order.orderNumber, itemCount: group.lines.length, amount: group.gmv.toFixed(2) },
        },
      });
      outboxIds.push(notification.id);
    }

    for (const { variant, quantity } of lines) {
      const remainingStock = variant.stock - quantity;
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock: remainingStock, lowStock: remainingStock < env.LOW_STOCK_THRESHOLD, version: { increment: 1 } },
      });
    }
    await tx.cart.update({ where: { id: cart.id }, data: { abandonmentStatus: CartAbandonmentStatus.CONVERTED } });
    const completeOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    return { order: completeOrder, replayed: false, outboxIds };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 5_000 }));
}
