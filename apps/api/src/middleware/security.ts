import { AppError } from '@prepforge/shared';
import cors from 'cors';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

export function securityHeaders(): RequestHandler {
  return helmet();
}

export function corsPolicy(allowedOrigins: string[]): RequestHandler {
  return cors({
    origin: (origin, callback) => {
      // same-origin and non-browser requests carry no Origin header
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (the session cookie is also SameSite=Lax): a state-changing request
 * that carries an Origin header must come from an allowed origin or the API's own host.
 */
export function originCheck(allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || !origin) return next();
    const sameHost = (() => {
      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    })();
    if (allowedOrigins.includes(origin) || sameHost) return next();
    next(new AppError('UNAUTHORIZED', 'Cross-site request blocked.', { status: 403 }));
  };
}

export function authRateLimit(limit: number): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          'RATE_LIMITED',
          'Too many attempts. Please wait a few minutes and try again.',
          {
            status: 429,
            retryable: true,
          },
        ),
      ),
  });
}
