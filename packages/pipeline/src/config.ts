/**
 * Typed pipeline configuration, read from environment variables.
 * Every limit the crawler and LLM layer enforce is configurable here; defaults follow the spec.
 */
import { z } from 'zod';

export const LLM_PROVIDERS = ['openai', 'gemini', 'mock'] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

export const SEARCH_PROVIDERS = ['tavily', 'hn', 'brave', 'none'] as const;
export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: 'gpt-4.1-mini',
  // an alias that follows Google's model retirements
  gemini: 'gemini-flash-lite-latest',
  mock: 'mock',
};

/** "OPEN_AI", "OpenAI" and "open-ai" all mean "openai". */
const normalizeName = (value: unknown) =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : value;

/** Treats empty strings (e.g. `LLM_BASE_URL=`) as "not set". */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const int = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().min(min).max(max),
  );

const bool = (fallback: boolean) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? String(fallback) : value),
    z
      .string()
      .toLowerCase()
      .pipe(z.enum(['true', 'false', '1', '0']))
      .transform((value) => value === 'true' || value === '1'),
  );

const EnvSchema = z.object({
  LLM_PROVIDER: z.preprocess(
    // Gemini is the default: it has a genuine free tier (OpenAI does not)
    (value) => (value === undefined || value === '' ? 'gemini' : normalizeName(value)),
    z.enum(LLM_PROVIDERS),
  ),
  LLM_MODEL: optionalString,
  OPENAI_MODEL: optionalString,
  GEMINI_MODEL: optionalString,
  LLM_BASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  LLM_MAX_CONCURRENCY: int(2, 1, 16),
  LLM_REQUESTS_PER_MINUTE: int(15, 1, 10_000), // Gemini free tier: 15 requests/minute
  LLM_MAX_RETRIES: int(4, 0, 10),
  LLM_TIMEOUT_MS: int(60_000, 1_000, 600_000),

  SEARCH_PROVIDER: z.preprocess(
    (value) => (value === undefined || value === '' ? 'tavily' : normalizeName(value)),
    z.enum(SEARCH_PROVIDERS),
  ),
  BRAVE_API_KEY: optionalString,
  TAVILY_API_KEY: optionalString,

  MAX_PAGES: int(12, 1, 100),
  MAX_DEPTH: int(2, 0, 5),
  REQUEST_TIMEOUT_MS: int(10_000, 500, 120_000),
  MAX_PAGE_BYTES: int(1_000_000, 10_000, 20_000_000),
  MAX_CONCURRENCY: int(2, 1, 16),
  MAX_RETRIES: int(3, 0, 10),
  CRAWL_DELAY_MS: int(200, 0, 10_000),
  ALLOW_PRIVATE_URLS: bool(false),
  CRAWLER_USER_AGENT: optionalString,

  MAX_COVERAGE_PASSES: int(3, 1, 10),
  BATCH_CONCURRENCY: int(2, 1, 16),
  CASE_TIMEOUT_MS: int(480_000, 10_000, 3_600_000),
});

export interface PipelineConfig {
  llm: {
    provider: LlmProviderName;
    model: string;
    apiKey: string | undefined;
    baseUrl: string | undefined;
    maxConcurrency: number;
    requestsPerMinute: number;
    maxRetries: number;
    timeoutMs: number;
  };
  search: {
    provider: SearchProviderName;
    braveApiKey: string | undefined;
    tavilyApiKey: string | undefined;
  };
  crawler: {
    maxPages: number;
    maxDepth: number;
    requestTimeoutMs: number;
    maxPageBytes: number;
    maxConcurrency: number;
    maxRetries: number;
    /** Minimum spacing between requests to the company site (robots.txt Crawl-delay wins). */
    crawlDelayMs: number;
    /** Permit localhost/private-network targets. Off for the web app; the evaluator turns it on. */
    allowPrivateUrls: boolean;
    userAgent: string;
  };
  pipeline: {
    maxCoveragePasses: number;
    batchConcurrency: number;
    caseTimeoutMs: number;
  };
}

export const DEFAULT_USER_AGENT = 'PrepForgeBot/1.0 (+https://github.com/heyDev07/prepforge-ai)';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Parses configuration from an environment map (defaults to process.env). Throws ConfigError. */
export function loadPipelineConfig(
  env: Record<string, string | undefined> = process.env,
): PipelineConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  const apiKey =
    e.LLM_PROVIDER === 'openai'
      ? e.OPENAI_API_KEY
      : e.LLM_PROVIDER === 'gemini'
        ? e.GEMINI_API_KEY
        : undefined;

  return {
    llm: {
      provider: e.LLM_PROVIDER,
      // LLM_MODEL overrides; otherwise the model configured for the selected provider
      model:
        e.LLM_MODEL ??
        (e.LLM_PROVIDER === 'openai'
          ? e.OPENAI_MODEL
          : e.LLM_PROVIDER === 'gemini'
            ? e.GEMINI_MODEL
            : undefined) ??
        DEFAULT_MODELS[e.LLM_PROVIDER],
      apiKey,
      baseUrl: e.LLM_BASE_URL,
      maxConcurrency: e.LLM_MAX_CONCURRENCY,
      requestsPerMinute: e.LLM_REQUESTS_PER_MINUTE,
      maxRetries: e.LLM_MAX_RETRIES,
      timeoutMs: e.LLM_TIMEOUT_MS,
    },
    search: {
      provider: e.SEARCH_PROVIDER,
      braveApiKey: e.BRAVE_API_KEY,
      tavilyApiKey: e.TAVILY_API_KEY,
    },
    crawler: {
      maxPages: e.MAX_PAGES,
      maxDepth: e.MAX_DEPTH,
      requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
      maxPageBytes: e.MAX_PAGE_BYTES,
      maxConcurrency: e.MAX_CONCURRENCY,
      maxRetries: e.MAX_RETRIES,
      crawlDelayMs: e.CRAWL_DELAY_MS,
      allowPrivateUrls: e.ALLOW_PRIVATE_URLS,
      userAgent: e.CRAWLER_USER_AGENT ?? DEFAULT_USER_AGENT,
    },
    pipeline: {
      maxCoveragePasses: e.MAX_COVERAGE_PASSES,
      batchConcurrency: e.BATCH_CONCURRENCY,
      caseTimeoutMs: e.CASE_TIMEOUT_MS,
    },
  };
}
