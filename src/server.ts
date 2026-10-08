import { createServer } from 'node:http';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { createApp } from './app.js';

const server = createServer(createApp());
server.listen(env.PORT, () => console.info(`JoharHaat API listening on port ${env.PORT}`));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; shutting down.`);
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async (error) => {
    clearTimeout(timeout);
    await disconnectPrisma();
    if (error) { console.error(error); process.exit(1); }
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => console.error({ error }, 'Unhandled rejection'));
process.on('uncaughtException', (error) => { console.error({ error }, 'Uncaught exception'); void shutdown('uncaughtException'); });
