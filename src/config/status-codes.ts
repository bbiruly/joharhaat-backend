import {
  AdminNotificationCategory,
  AdminNotificationSeverity,
} from '../generated/prisma/client.js';

/**
 * The single registry of business events.
 *
 * Why codes and not free text: an event's wording changes (and gets
 * translated), its identity does not. Writing `O001` into an audit row,
 * a status log or a notification means the label can be reworded in one place
 * without rewriting history, and the Hindi and English strings stay bound to
 * the same event instead of drifting apart in scattered template literals.
 *
 * Deliberately NOT how the database stores status. `Order.paymentStatus` stays
 * the readable Postgres enum (`PENDING`), because a production query that reads
 * `WHERE status = 'O001'` is unreadable to whoever is debugging at 2am, and
 * Postgres already stores an enum as an integer so there is nothing to save.
 * `dbStatus` below is the bridge: it records which enum value an event
 * corresponds to, so the two can never silently disagree.
 *
 * Prefixes: O order · P payment · V vendor/KYC · C catalog · A admin action ·
 * U user/auth · S system.
 */

export type Language = 'en' | 'hi';

export interface StatusCodeEntry {
  /** Stable identifier written to logs, audit rows and notifications. */
  readonly code: string;
  /** The Prisma enum value this event corresponds to, when there is one. */
  readonly dbStatus?: string;
  readonly en: string;
  readonly hi: string;
  readonly severity?: AdminNotificationSeverity;
  readonly category?: AdminNotificationCategory;
}

/** Preserves the key names for lookups while typing every value uniformly, so
 *  `dbStatus` stays visible as optional instead of being narrowed away. */
const entry = <T extends Record<string, StatusCodeEntry>>(
  value: T,
): { [K in keyof T]: StatusCodeEntry } => value;

/* ------------------------------------------------------------------ orders */

export const ORDER_EVENTS = entry({
  ORDER_CREATED: {
    code: 'O001',
    dbStatus: 'PENDING',
    en: 'Order placed by customer',
    hi: 'ग्राहक ने ऑर्डर दिया',
    category: AdminNotificationCategory.ORDER,
  },
  ORDER_PACKED: {
    code: 'O002',
    dbStatus: 'PACKED',
    en: 'Packed by vendor',
    hi: 'विक्रेता ने पैक किया',
    category: AdminNotificationCategory.ORDER,
  },
  ORDER_SHIPPED: {
    code: 'O003',
    dbStatus: 'SHIPPED',
    en: 'Shipped',
    hi: 'भेज दिया गया',
    category: AdminNotificationCategory.ORDER,
  },
  ORDER_DELIVERED: {
    code: 'O004',
    dbStatus: 'DELIVERED',
    en: 'Delivered',
    hi: 'डिलीवर हो गया',
    category: AdminNotificationCategory.ORDER,
  },
  ORDER_RTO: {
    code: 'O005',
    dbStatus: 'RTO',
    en: 'Returned to origin',
    hi: 'वापस भेजा गया',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.ORDER,
  },
  ORDER_CANCELLED: {
    code: 'O006',
    dbStatus: 'CANCELLED',
    en: 'Cancelled',
    hi: 'रद्द कर दिया गया',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.ORDER,
  },
  ORDER_DELAYED: {
    code: 'O007',
    en: 'Not accepted by vendor within 24 hours',
    hi: '24 घंटे में विक्रेता ने स्वीकार नहीं किया',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.ORDER,
  },
});

/* ---------------------------------------------------------------- payments */

export const PAYMENT_EVENTS = entry({
  PAYMENT_CREATED: {
    code: 'P001',
    dbStatus: 'CREATED',
    en: 'Payment attempt started',
    hi: 'भुगतान शुरू हुआ',
    category: AdminNotificationCategory.PAYMENT,
  },
  PAYMENT_PROCESSING: {
    code: 'P002',
    dbStatus: 'PROCESSING',
    en: 'Payment processing',
    hi: 'भुगतान प्रक्रिया में है',
    category: AdminNotificationCategory.PAYMENT,
  },
  PAYMENT_SUCCEEDED: {
    code: 'P003',
    dbStatus: 'SUCCEEDED',
    en: 'Payment successful',
    hi: 'भुगतान सफल',
    category: AdminNotificationCategory.PAYMENT,
  },
  PAYMENT_FAILED: {
    code: 'P004',
    dbStatus: 'FAILED',
    en: 'Payment failed',
    hi: 'भुगतान विफल',
    severity: AdminNotificationSeverity.CRITICAL,
    category: AdminNotificationCategory.PAYMENT,
  },
  PAYMENT_CANCELLED: {
    code: 'P005',
    dbStatus: 'CANCELLED',
    en: 'Payment cancelled',
    hi: 'भुगतान रद्द',
    category: AdminNotificationCategory.PAYMENT,
  },
  PAYMENT_EXPIRED: {
    code: 'P006',
    dbStatus: 'EXPIRED',
    en: 'Payment attempt expired',
    hi: 'भुगतान की समय-सीमा समाप्त',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.PAYMENT,
  },
  ESCROW_RELEASED: {
    code: 'P007',
    en: 'Escrow released to vendor',
    hi: 'विक्रेता को भुगतान जारी',
    category: AdminNotificationCategory.PAYOUT,
  },
});

/* ------------------------------------------------------------ vendor / KYC */

export const VENDOR_EVENTS = entry({
  APPLICATION_SUBMITTED: {
    code: 'V001',
    dbStatus: 'PENDING',
    en: 'Vendor application submitted',
    hi: 'विक्रेता आवेदन जमा हुआ',
    category: AdminNotificationCategory.KYC,
  },
  APPLICATION_APPROVED: {
    code: 'V002',
    dbStatus: 'APPROVED',
    en: 'Vendor approved',
    hi: 'विक्रेता स्वीकृत',
    category: AdminNotificationCategory.KYC,
  },
  APPLICATION_REJECTED: {
    code: 'V003',
    dbStatus: 'REJECTED',
    en: 'Vendor application rejected',
    hi: 'विक्रेता आवेदन अस्वीकृत',
    category: AdminNotificationCategory.KYC,
  },
  APPLICATION_HELD: {
    code: 'V004',
    dbStatus: 'HOLD',
    en: 'Vendor application put on hold',
    hi: 'विक्रेता आवेदन रोका गया',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.KYC,
  },
  PAYOUT_REQUESTED: {
    code: 'V005',
    en: 'Payout requested by vendor',
    hi: 'विक्रेता ने भुगतान माँगा',
    category: AdminNotificationCategory.PAYOUT,
  },
});

/* ------------------------------------------------------------------ catalog */

export const CATALOG_EVENTS = entry({
  PRODUCT_SUBMITTED: {
    code: 'C001',
    dbStatus: 'PENDING_REVIEW',
    en: 'Product submitted for review',
    hi: 'उत्पाद समीक्षा के लिए भेजा गया',
    category: AdminNotificationCategory.PRODUCT,
  },
  PRODUCT_APPROVED: {
    code: 'C002',
    dbStatus: 'APPROVED',
    en: 'Product approved and published',
    hi: 'उत्पाद स्वीकृत और प्रकाशित',
    category: AdminNotificationCategory.PRODUCT,
  },
  PRODUCT_REJECTED: {
    code: 'C003',
    dbStatus: 'REJECTED',
    en: 'Product rejected',
    hi: 'उत्पाद अस्वीकृत',
    category: AdminNotificationCategory.PRODUCT,
  },
  PRODUCT_SUSPENDED: {
    code: 'C004',
    dbStatus: 'SUSPENDED',
    en: 'Product suspended',
    hi: 'उत्पाद निलंबित',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.PRODUCT,
  },
  PRODUCT_DRAFT: {
    code: 'C007',
    dbStatus: 'DRAFT',
    en: 'Product saved as draft',
    hi: 'उत्पाद ड्राफ्ट में सहेजा गया',
    category: AdminNotificationCategory.PRODUCT,
  },
  PRODUCT_ARCHIVED: {
    code: 'C008',
    dbStatus: 'ARCHIVED',
    en: 'Product archived by vendor',
    hi: 'विक्रेता ने उत्पाद संग्रहीत किया',
    category: AdminNotificationCategory.PRODUCT,
  },
  STOCK_LOW: {
    code: 'C005',
    en: 'Stock below threshold',
    hi: 'स्टॉक तय सीमा से कम',
    severity: AdminNotificationSeverity.WARNING,
    category: AdminNotificationCategory.STOCK,
  },
  STOCKOUT_RISK: {
    code: 'C006',
    en: 'Projected to run out of stock',
    hi: 'स्टॉक खत्म होने का अनुमान',
    severity: AdminNotificationSeverity.CRITICAL,
    category: AdminNotificationCategory.STOCK,
  },
});

/* ------------------------------------------------------------ admin actions */

export const ADMIN_EVENTS = entry({
  ORDER_STATUS_CORRECTION: {
    code: 'A001',
    en: 'Order status corrected by admin',
    hi: 'एडमिन ने ऑर्डर स्थिति सुधारी',
  },
  PRODUCT_ANALYTICS_EXPORT: {
    code: 'A002',
    en: 'Product analytics exported',
    hi: 'उत्पाद विश्लेषण निर्यात किया गया',
  },
  CUSTOMER_SESSIONS_REVOKED: {
    code: 'A003',
    en: 'Customer signed out of all sessions',
    hi: 'ग्राहक के सभी सत्र समाप्त किए गए',
  },
  ADMIN_CREATED: {
    code: 'A004',
    en: 'Admin member created',
    hi: 'एडमिन सदस्य बनाया गया',
  },
  ADMIN_ROLE_CHANGED: {
    code: 'A005',
    en: 'Admin role changed',
    hi: 'एडमिन भूमिका बदली गई',
  },
  ADMIN_DISABLED: {
    code: 'A006',
    en: 'Admin access disabled',
    hi: 'एडमिन पहुँच बंद की गई',
  },
  ADMIN_ENABLED: {
    code: 'A007',
    en: 'Admin access restored',
    hi: 'एडमिन पहुँच बहाल की गई',
  },
  TEAM_MEMBER_UPDATED: {
    code: 'A008',
    en: 'Admin member updated',
    hi: 'एडमिन सदस्य अपडेट किया गया',
  },
  // Haats are marketplace configuration, but every change here is made by an
  // admin, so they carry the admin-action prefix.
  HAAT_SAVED: {
    code: 'A009',
    en: 'Haat schedule saved',
    hi: 'हाट शेड्यूल सहेजा गया',
    category: AdminNotificationCategory.HAAT,
  },
  HAAT_TOGGLED: {
    code: 'A010',
    en: 'Haat enabled or disabled',
    hi: 'हाट चालू या बंद किया गया',
    category: AdminNotificationCategory.HAAT,
  },
  HAAT_SET_LIVE: {
    code: 'A011',
    en: 'Haat set live',
    hi: 'हाट लाइव किया गया',
    category: AdminNotificationCategory.HAAT,
  },
  CART_REMINDER_PREPARED: {
    code: 'A012',
    en: 'Cart recovery reminder prepared',
    hi: 'कार्ट रिमाइंडर तैयार किया गया',
  },
  // No `category` on these three: AdminNotificationCategory has no MARKETING
  // member, and coupon changes do not raise an operator notification. They are
  // audit events only.
  COUPON_CREATED: {
    code: 'A013',
    en: 'Coupon created',
    hi: 'कूपन बनाया गया',
  },
  COUPON_UPDATED: {
    code: 'A014',
    en: 'Coupon updated',
    hi: 'कूपन बदला गया',
  },
  COUPON_DELETED: {
    code: 'A015',
    en: 'Coupon deleted',
    hi: 'कूपन हटाया गया',
    severity: AdminNotificationSeverity.WARNING,
  },
  REVIEW_HIDDEN: {
    code: 'A016',
    en: 'Review hidden by moderation',
    hi: 'समीक्षा छिपाई गई',
    severity: AdminNotificationSeverity.WARNING,
  },
  REVIEW_RESTORED: {
    code: 'A017',
    en: 'Review restored',
    hi: 'समीक्षा वापस दिखाई गई',
  },
  REVIEW_REPORTS_DISMISSED: {
    code: 'A018',
    en: 'Review reports dismissed',
    hi: 'समीक्षा की शिकायतें खारिज कीं',
  },
});

/* ------------------------------------------------------------------ lookup */

export const STATUS_CODES = {
  ...ORDER_EVENTS,
  ...PAYMENT_EVENTS,
  ...VENDOR_EVENTS,
  ...CATALOG_EVENTS,
  ...ADMIN_EVENTS,
} as const;

export type StatusEvent = keyof typeof STATUS_CODES;

const byCode = new Map<string, StatusCodeEntry>(
  Object.values(STATUS_CODES).map((item) => [item.code, item]),
);

/** Resolve a raw `O001` back to its entry — for log readers and support tools. */
export const findByCode = (code: string) => byCode.get(code);

/** Human label for an event in the requested language. */
export const describeEvent = (event: StatusEvent, language: Language = 'en') =>
  STATUS_CODES[event][language];

/** `"O001"` — what gets written to an audit row, status log or notification. */
export const codeOf = (event: StatusEvent) => STATUS_CODES[event].code;

/** `"O001 Order placed by customer"` — for a log line or a status-log note. */
export const labelOf = (event: StatusEvent, language: Language = 'en') =>
  `${STATUS_CODES[event].code} ${STATUS_CODES[event][language]}`;
