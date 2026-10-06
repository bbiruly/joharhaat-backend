import { prisma } from '../db/prisma.js';
import { expireReservations, reconcileProcessingPayments } from './payment.service.js';
import { dispatchVendorSmsOutbox } from './sms.service.js';
import { aggregateAnalytics } from './advanced-analytics.service.js';
import { dispatchEmailOutbox } from './email.service.js';
let lastAnalyticsRun = 0;

export async function runBackgroundCycle(): Promise<void> {
  await expireReservations();
  await reconcileProcessingPayments();
  const sms = await prisma.notificationOutbox.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 } }, select: { id: true }, take: 50, orderBy: { createdAt: 'asc' } });
  await dispatchVendorSmsOutbox(sms.map((job) => job.id));
  await dispatchEmailOutbox();
  if (Date.now() - lastAnalyticsRun > 15 * 60_000) { lastAnalyticsRun = Date.now(); await aggregateAnalytics(); }
}
