import { loadPipelineConfig, type PipelineConfig } from '@prepforge/pipeline';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? String(fallback) : value),
    z
      .string()
      .toLowerCase()
      .pipe(z.enum(['true', 'false', '1', '0']))
      .transform((value) => value === 'true' || value === '1'),
  );

const int = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().min(min).max(max),
  );

const ApiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1, 65_535),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/prepforge'),
  SESSION_TTL_DAYS: int(7, 1, 90),
  COOKIE_SECURE: bool(false),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  GENERATION_CONCURRENCY: int(1, 1, 8),
  /** Number of proxy hops to trust for client IPs (rate limiting), e.g. 1 behind a load balancer. */
  TRUST_PROXY: int(0, 0, 10),
  AUTH_RATE_LIMIT: int(20, 1, 10_000),
});

export interface ApiConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  mongodbUri: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  corsOrigins: string[];
  generationConcurrency: number;
  trustProxy: number;
  /** Max auth attempts per IP per 15 minutes. */
  authRateLimit: number;
  pipeline: PipelineConfig;
}

export function loadApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const e = ApiEnvSchema.parse(env);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    mongodbUri: e.MONGODB_URI,
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    cookieSecure: e.COOKIE_SECURE,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    generationConcurrency: e.GENERATION_CONCURRENCY,
    trustProxy: e.TRUST_PROXY,
    authRateLimit: e.AUTH_RATE_LIMIT,
    pipeline: loadPipelineConfig(env),
  };
}
