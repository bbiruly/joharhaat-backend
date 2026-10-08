import { disconnectPrisma } from './db/prisma.js';
import { runBackgroundCycle } from './services/worker.service.js';

let stopping = false;
async function cycle() {
  if (stopping) return;
  try { await runBackgroundCycle(); }
  catch (error) { console.error({ error }, 'Background cycle failed'); }
}
const timer = setInterval(() => void cycle(), 30_000);
void cycle();
async function shutdown() { stopping = true; clearInterval(timer); await disconnectPrisma(); process.exit(0); }
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
