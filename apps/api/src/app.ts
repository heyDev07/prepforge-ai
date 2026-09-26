import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { ApiConfig } from './config';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { corsPolicy, originCheck, securityHeaders } from './middleware/security';
import { authRouter } from './routes/auth';
import { kitsRouter } from './routes/kits';
import type { JobRunner } from './services/job-runner';

export interface AppContext {
  config: ApiConfig;
  jobs: JobRunner;
}

/** Builds the Express app without listening, so tests can drive it with Supertest. */
export function createApp({ config, jobs }: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders());
  app.use(corsPolicy(config.corsOrigins));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(originCheck(config.corsOrigins));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // API responses are per-user: never let a browser or a shared cache keep them
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/auth', authRouter(config));
  app.use('/api/kits', kitsRouter(config, jobs));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
