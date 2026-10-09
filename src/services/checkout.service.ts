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
import { allocateMoney, money, sumMoney } from '../utils/money.js';
import { aggregateTaxLines, allocateVendorTaxShares, extractExclusiveDeliveryTax, extractInclusiveTax, requireProductTaxConfiguration } from './checkout-tax.js';
import { createOrderCommissionSnapshots } from './influencer-commission.service.js';
import { effectiveCommissionRate } from './influencer-commission.rules.js';
import { deliveryFeeForPin, deliveryQuoteStatus } from './delivery-rules.js';

const orderInclude = {
  vendorOrders: { include: { items: true, statusLogs: true } },
} satisfies Prisma.OrderInclude;

type CheckoutOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export type CheckoutResult = {
  order: CheckoutOrder;
  replayed: boolean;
  outboxIds: string[];
};

export function calculateCheckoutTaxTotals(
  lines: Array<{ amount: Prisma.Decimal; hsnCode: string; rate: Prisma.Decimal }>,
  discount: Prisma.Decimal,
  courier: Prisma.Decimal,
  deliveryRate: Prisma.Decimal,
  interstate: boolean,
) {
  const gmv = sumMoney(lines.map((line) => line.amount));
  if (discount.greaterThan(gmv)) throw new ApiError(422, 'Discount cannot exceed merchandise value.', 'INVALID_DISCOUNT');
  const discountShares = allocateMoney(discount, lines.map((line) => line.amount));
  const itemTaxes = lines.map((line, index) => ({
    ...extractInclusiveTax(line.amount.minus(discountShares[index]!), line.rate, interstate),
    rate: line.rate,
    hsnCode: line.hsnCode,
    discount: discountShares[index]!,
  }));
  const delivery = extractExclusiveDeliveryTax(courier, deliveryRate, interstate);
  const cgst = sumMoney([...itemTaxes.map((item) => item.cgst), delivery.cgst]);
  const sgst = sumMoney([...itemTaxes.map((item) => item.sgst), delivery.sgst]);
  const igst = sumMoney([...itemTaxes.map((item) => item.igst), delivery.igst]);
  const taxLines = aggregateTaxLines(itemTaxes, { rate: deliveryRate, cgst: delivery.cgst, sgst: delivery.sgst, igst: delivery.igst });
  const total = money(gmv.minus(discount).plus(delivery.total));
  return { gmv: money(gmv), discount: money(discount), cgst, sgst, igst, courier: money(courier), delivery, itemTaxes, taxLines, total };
}

async function resolveCoupon(tx: Prisma.TransactionClient, customerId: string, code: string | undefined, gmv: Prisma.Decimal) {
  if (!code) return { coupon: null, discount: money(0) };
  const coupon = await tx.coupon.findUnique({ where: { code } });
  const now = new Date();
  if (!coupon || !coupon.isActive || coupon.startsAt > now || coupon.expiresAt <= now || (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) || gmv.lessThan(coupon.minOrderValue)) throw new ApiError(422, 'Coupon is invalid, expired or not applicable.', 'COUPON_NOT_APPLICABLE');
  const userUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, userId: customerId } });
  if (userUses >= coupon.perUserLimit) throw new ApiError(409, 'Coupon usage limit has been reached.', 'COUPON_LIMIT_REACHED');
  return { coupon, discount: money(Prisma.Decimal.min(gmv.mul(coupon.percent), coupon.maxDiscount)) };
}

export function checkoutCouponEligible(coupon: {
  isActive: boolean;
  showInCheckoutOffers: boolean;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  minOrderValue: number;
}, now: Date, gmv: number, userUses: number) {
  return coupon.showInCheckoutOffers && coupon.isActive && gmv >= coupon.minOrderValue && coupon.startsAt <= now &&
    coupon.expiresAt > now && (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit) &&
    userUses < coupon.perUserLimit;
}

export function shapeCheckoutCouponOffer(coupon: {
  code: string;
  percent: Prisma.Decimal;
  maxDiscount: Prisma.Decimal;
  minOrderValue: Prisma.Decimal;
  startsAt: Date;
  expiresAt: Date;
  usageLimit: number | null;
  perUserLimit: number;
}, gmv: Prisma.Decimal) {
  return {
    code: coupon.code,
    percent: coupon.percent.mul(100).toNumber(),
    discount: money(Prisma.Decimal.min(gmv.mul(coupon.percent), coupon.maxDiscount)).toNumber(),
    maxDiscount: coupon.maxDiscount.toNumber(),
    minOrderValue: coupon.minOrderValue.toNumber(),
    startsAt: coupon.startsAt.toISOString(),
    expiresAt: coupon.expiresAt.toISOString(),
    usageLimit: coupon.usageLimit,
    perUserLimit: coupon.perUserLimit,
  };
}

export function offersWithSavings<T extends { discount: number }>(offers: T[]) {
  return offers.filter((offer) => offer.discount > 0);
}

export async function checkoutOffers(customerId: string) {
  const baseQuote = await quoteCheckout(customerId);
  const gmv = new Prisma.Decimal(baseQuote.totals.grossValue);
  const now = new Date();
  const candidates = await prisma.coupon.findMany({
    where: {
      showInCheckoutOffers: true,
      isActive: true,
      startsAt: { lte: now },
      expiresAt: { gt: now },
      minOrderValue: { lte: gmv },
    },
    select: {
      id: true, code: true, percent: true, maxDiscount: true, startsAt: true,
      isActive: true, showInCheckoutOffers: true,
      expiresAt: true, usageLimit: true, usedCount: true, perUserLimit: true, minOrderValue: true,
    },
  });
  const candidatesEligible = candidates.filter((coupon) =>
    checkoutCouponEligible({ ...coupon, minOrderValue: coupon.minOrderValue.toNumber() }, now, gmv.toNumber(), 0) &&
    (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit),
  );
  const usageRows = candidatesEligible.length
    ? await prisma.couponRedemption.groupBy({
        by: ['couponId'],
        where: { userId: customerId, couponId: { in: candidatesEligible.map((coupon) => coupon.id) } },
        _count: { _all: true },
      })
    : [];
  const usesByCoupon = new Map(usageRows.map((row) => [row.couponId, row._count._all]));
  const offers = candidatesEligible
    .filter((coupon) => checkoutCouponEligible(
      { ...coupon, minOrderValue: coupon.minOrderValue.toNumber() },
      now,
      gmv.toNumber(),
      usesByCoupon.get(coupon.id) ?? 0,
    ))
    .map((coupon) => shapeCheckoutCouponOffer(coupon, gmv));
  return offersWithSavings(offers)
    .sort((a, b) => b.discount - a.discount || a.code.localeCompare(b.code));
}

export async function quoteCheckout(customerId: string, couponCode?: string, addressId?: string) {
  return prisma.$transaction(async (tx) => {
    const [cart, address] = await Promise.all([
      tx.cart.findFirst({ where: { customerId, order: null }, include: { items: { include: { variant: { include: { product: { include: { vendor: true } } } } } } }, orderBy: { updatedAt: 'desc' } }),
      addressId ? tx.address.findFirst({ where: { id: addressId, userId: customerId, isArchived: false } }) : tx.address.findFirst({ where: { userId: customerId, isArchived: false, isDefault: true } }),
    ]);
    if (addressId && !address) throw new ApiError(404, 'Delivery address was not found for this customer.', 'ADDRESS_NOT_FOUND');
    if (!cart || !cart.items.length) throw new ApiError(422, 'Your cart is empty.', 'EMPTY_CART');
    const items = cart.items.map((item) => {
      const { variant } = item;
      if (!variant.isActive || !variant.product.isPublished || variant.product.vendor.verificationStatus !== VerificationStatus.VERIFIED || variant.stock < item.quantity) throw new ApiError(409, `${variant.product.name} is unavailable or has insufficient stock.`, 'CART_CHANGED');
      const tax = requireProductTaxConfiguration(variant.product.name, variant.product.taxHsnCode, variant.product.gstRate);
      return { cartItemId: item.id, productId: variant.productId, variantId: variant.id, productName: variant.product.name, variantLabel: variant.label, vendorName: variant.product.vendor.businessName, quantity: item.quantity, stock: variant.stock, unitPrice: money(variant.price), lineTotal: money(variant.price.mul(item.quantity)), taxHsnCode: tax.hsnCode, gstRate: tax.rate };
    });
    const gmv = sumMoney(items.map((item) => item.lineTotal));
    const { coupon, discount } = await resolveCoupon(tx, customerId, couponCode, gmv);
    const settings = await tx.deliverySettings.findUnique({ where: { id: 'default' } });
    const pin = address ? await tx.deliveryPincode.findUnique({ where: { postalCode: address.postalCode } }) : null;
    const deliveryStatus = deliveryQuoteStatus(settings?.isPinPricingEnabled === true, Boolean(address), Boolean(pin?.isServiceable));
    const deliveryUnavailable = deliveryStatus === 'RATES_NOT_CONFIGURED' || deliveryStatus === 'PIN_NOT_SERVICEABLE';
    const addressRequired = deliveryStatus === 'ADDRESS_REQUIRED';
    const courier = deliveryUnavailable || addressRequired
      ? money(0)
      : deliveryFeeForPin({ merchandiseAfterDiscount: gmv.minus(discount), freeDeliveryThreshold: settings!.freeDeliveryThreshold, pin });
    const destinationState = settings?.isPinPricingEnabled && pin ? pin.state : address?.state;
    const interstate = destinationState ? destinationState.trim().toLowerCase() !== env.GST_REGISTRATION_STATE.trim().toLowerCase() : false;
    const totals = calculateCheckoutTaxTotals(items.map((item) => ({ amount: item.lineTotal, hsnCode: item.taxHsnCode, rate: new Prisma.Decimal(item.gstRate) })), discount, courier, new Prisma.Decimal(env.DELIVERY_GST_RATE), interstate);
    const unavailable = deliveryUnavailable || addressRequired;
    return { cartId: cart.id, items, coupon: coupon ? {
      code: coupon.code,
      discount,
      percent: coupon.percent.mul(100).toNumber(),
      maxDiscount: coupon.maxDiscount.toNumber(),
      minOrderValue: coupon.minOrderValue.toNumber(),
      startsAt: coupon.startsAt.toISOString(),
      expiresAt: coupon.expiresAt.toISOString(),
      usageLimit: coupon.usageLimit,
      perUserLimit: coupon.perUserLimit,
    } : null, deliveryStatus, totals: { grossValue: totals.gmv, discount: totals.discount, deliveryFee: unavailable ? null : totals.courier, cgst: unavailable ? money(0) : totals.cgst, sgst: unavailable ? money(0) : totals.sgst, igst: unavailable ? money(0) : totals.igst, taxLines: unavailable ? [] : totals.taxLines, finalTotal: unavailable ? null : totals.total }, codEligible: !unavailable && totals.total.lessThanOrEqualTo(5000) };
  });
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
      tx.address.findFirst({ where: { id: input.deliveryAddressId, userId: customerId, isArchived: false } }),
    ]);
    if (!cart) throw new ApiError(404, 'Cart was not found for this customer.', 'CART_NOT_FOUND');
    if (cart.order) throw new ApiError(409, 'This cart has already been checked out.', 'CART_ALREADY_CONVERTED');
    if (!address) throw new ApiError(404, 'Delivery address was not found for this customer.', 'ADDRESS_NOT_FOUND');

    if (!cart.items.length) throw new ApiError(422, 'Your cart is empty.', 'EMPTY_CART');
    const requested = new Map(cart.items.map((item) => [item.variantId, item.quantity]));

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
    const { coupon, discount } = await resolveCoupon(tx, customerId, input.couponCode, gmv);
    const influencerRate = coupon?.influencerId
      ? effectiveCommissionRate((await tx.influencer.findUniqueOrThrow({ where: { id: coupon.influencerId } })).defaultRate, coupon.commissionRate)
      : null;
    const deliverySettings = await tx.deliverySettings.findUnique({ where: { id: 'default' } });
    if (deliverySettings?.isPinPricingEnabled !== true)
      throw new ApiError(503, 'Delivery pricing is temporarily unavailable. Please try again later.', 'DELIVERY_RATES_UNAVAILABLE');
    const deliveryPin = await tx.deliveryPincode.findUnique({ where: { postalCode: address.postalCode } });
    const courierCharge = deliveryFeeForPin({ merchandiseAfterDiscount: gmv.minus(discount), freeDeliveryThreshold: deliverySettings.freeDeliveryThreshold, pin: deliveryPin });
    const destinationState = deliveryPin?.state ?? address.state;
    const destinationDistrict = deliveryPin?.district ?? address.district;
    const interstate = destinationState.trim().toLowerCase() !== env.GST_REGISTRATION_STATE.trim().toLowerCase();
    const totals = calculateCheckoutTaxTotals(lines.map(({ variant, lineTotal }) => {
      const product = variant.product;
      const tax = requireProductTaxConfiguration(product.name, product.taxHsnCode, product.gstRate);
      return { amount: lineTotal, hsnCode: tax.hsnCode, rate: tax.rate };
    }), discount, courierCharge, new Prisma.Decimal(env.DELIVERY_GST_RATE), interstate);
    const groupedLines = new Map<string, typeof lines>();
    for (const line of lines) {
      const vendorId = line.variant.product.vendorId;
      groupedLines.set(vendorId, [...(groupedLines.get(vendorId) ?? []), line]);
    }
    const groups = [...groupedLines.entries()].map(([vendorId, vendorLines]) => ({ vendorId, lines: vendorLines, gmv: sumMoney(vendorLines.map((line) => line.lineTotal)) }));
    const weights = groups.map((group) => group.gmv);
    // A coupon discount is deliberately NOT split across vendors: VendorOrder
    // has no discount column, gmv stays the undiscounted line total and
    // netVendorPayout is gmv minus commission. So the platform absorbs the
    // whole discount and the maker is paid in full on what they sold. Changing
    // that is a business decision, not a wiring fix.
    const vendorTaxShares = allocateVendorTaxShares(groups.map((group) => group.lines.map((line) => lines.findIndex((candidate) => candidate.variant.id === line.variant.id))), totals.itemTaxes, totals.delivery, weights);
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
        igst: totals.igst,
        courierCharge: totals.courier,
        deliveryTaxRate: new Prisma.Decimal(env.DELIVERY_GST_RATE),
        deliveryTaxable: totals.delivery.taxableValue,
        deliveryCgst: totals.delivery.cgst,
        deliverySgst: totals.delivery.sgst,
        deliveryIgst: totals.delivery.igst,
        taxBreakdown: totals.taxLines as unknown as Prisma.InputJsonValue,
        totalPayable: totals.total,
        couponCode: coupon?.code ?? null,
        ...(coupon?.influencerId && influencerRate ? { influencerId: coupon.influencerId, influencerRate } : {}),
        recipientName: address.fullName,
        recipientMobile: address.mobile,
        addressLine1: address.line1,
        addressLine2: address.line2,
        district: destinationDistrict,
        recipientState: destinationState,
        postalCode: address.postalCode,
      },
    });
    if (coupon) {
      await tx.couponRedemption.create({ data: { couponId: coupon.id, userId: customerId, orderId: order.id, discountAmount: totals.discount } });
    }

    const outboxIds: string[] = [];
    const commissionConsignments: { id: string; productSubtotal: Prisma.Decimal; allocatedDiscount: Prisma.Decimal }[] = [];
    for (const [index, group] of groups.entries()) {
      const commission = money(group.gmv.mul(env.ADMIN_COMMISSION_RATE));
      const vendorOrder = await tx.vendorOrder.create({
        data: {
          orderId: order.id,
          vendorId: group.vendorId,
          trackingId: `JHT-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
          gmv: group.gmv,
          adminCommission: commission,
          cgst: vendorTaxShares[index]!.cgst,
          sgst: vendorTaxShares[index]!.sgst,
          igst: vendorTaxShares[index]!.igst,
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
            taxHsnCode: variant.product.taxHsnCode,
            gstRate: variant.product.gstRate,
            ...(() => {
              const lineIndex = lines.findIndex((line) => line.variant.id === variant.id);
              const taxes = totals.itemTaxes[lineIndex]!;
              return { discountAmount: taxes.discount, taxableValue: taxes.taxableValue, cgst: taxes.cgst, sgst: taxes.sgst, igst: taxes.igst };
            })(),
          })) },
          statusLogs: { create: { status: FulfillmentStatus.PENDING, actorUserId: customerId, note: 'Order placed by customer.' } },
        },
      });
      const groupTaxableBeforeDiscount: Prisma.Decimal[] = [];
      const groupTaxableDiscounts: Prisma.Decimal[] = [];
      for (const line of group.lines) {
        const lineIndex = lines.findIndex((candidate) => candidate.variant.id === line.variant.id);
        const rate = new Prisma.Decimal(line.variant.product.gstRate!);
        const before = extractInclusiveTax(line.lineTotal, rate, interstate);
        const after = totals.itemTaxes[lineIndex]!;
        groupTaxableBeforeDiscount.push(before.taxableValue);
        groupTaxableDiscounts.push(money(before.taxableValue.minus(after.taxableValue)));
      }
      commissionConsignments.push({ id: vendorOrder.id, productSubtotal: sumMoney(groupTaxableBeforeDiscount), allocatedDiscount: sumMoney(groupTaxableDiscounts) });
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
    if (influencerRate && coupon?.influencerId) await createOrderCommissionSnapshots(tx, coupon.influencerId, influencerRate, commissionConsignments);

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
