import { NotificationStatus } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';

export async function dispatchVendorSmsOutbox(outboxIds: string[]): Promise<void> {
  await Promise.allSettled(outboxIds.map(async (id) => {
    const claimed = await prisma.notificationOutbox.updateMany({
      where: { id, status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] } },
      data: { status: NotificationStatus.PROCESSING, attempts: { increment: 1 }, lastError: null },
    });
    if (!claimed.count) return;
    try {
      const job = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id } });
      console.info({ outboxId: id, recipient: job.recipient }, 'Mock vendor SMS dispatched');
      await prisma.notificationOutbox.update({ where: { id }, data: { status: NotificationStatus.SENT, processedAt: new Date() } });
    } catch (error) {
      await prisma.notificationOutbox.update({
        where: { id },
        data: { status: NotificationStatus.FAILED, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown SMS error' },
      });
      throw error;
    }
  }));
}
