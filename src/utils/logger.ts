import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Base logger for code that runs outside a request.
 *
 * `pino-http` attaches a child logger to each request, which is the right thing
 * to use in a controller. Services and background work have no request, so they
 * log here instead. Same level and same stdout, so both streams land together.
 */
export const logger = pino({ level: env.LOG_LEVEL });
