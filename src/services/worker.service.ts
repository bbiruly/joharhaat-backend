import { prisma } from '../db/prisma.js';
import { expireReservations } from './payment.service.js';
import { dispatchVendorSmsOutbox } from './sms.service.js';

export async function runBackgroundCycle(): Promise<void> {
  await expireReservations();
  const sms = await prisma.notificationOutbox.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 } }, select: { id: true }, take: 50, orderBy: { createdAt: 'asc' } });
  await dispatchVendorSmsOutbox(sms.map((job) => job.id));
  const emails = await prisma.emailOutbox.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 } }, take: 50, orderBy: { createdAt: 'asc' } });
  for (const email of emails) {
    console.info({ outboxId: email.id, recipient: email.recipient, template: email.template }, 'Mock email dispatched');
    await prisma.emailOutbox.update({ where: { id: email.id }, data: { status: 'SENT', attempts: { increment: 1 }, processedAt: new Date(), lastError: null } });
  }
}
