import { env } from './env.js';
export const COMMERCE = { adminCommissionRate: env.ADMIN_COMMISSION_RATE, cgstRate: env.CGST_RATE, sgstRate: env.SGST_RATE, lowStockThreshold: env.LOW_STOCK_THRESHOLD } as const;
export const PAGINATION = { defaultSize: env.DEFAULT_PAGE_SIZE, maxSize: env.MAX_PAGE_SIZE } as const;
