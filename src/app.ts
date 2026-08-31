import { randomUUID } from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { apiRouter } from './routes/api.js';
import { openApiDocument } from './openapi.js';

export function createApp(): Express {
  const app = express();
  const origins = new Set(env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean));
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    request.requestId = request.header('x-request-id')?.slice(0, 128) || randomUUID();
    response.setHeader('x-request-id', request.requestId);
    next();
  });
  app.use(pinoHttp({ level: env.LOG_LEVEL, customProps: (request) => ({ requestId: request.requestId }) }));
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.has(origin)) return callback(null, true);
      callback(new Error('Origin is not allowed by CORS policy.'));
    },
  }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.get('/api/openapi.json', (_request, response) => response.json(openApiDocument));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use('/api/v1', apiRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
