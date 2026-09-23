import { AppError } from '@prepforge/shared';
import type { PipelineConfig } from '../config';
import { fixtureLlmResponder } from '../testing/fixture-llm';
import { GeminiProvider } from './gemini';
import { LimitedLlmProvider, type LimitedProviderOptions } from './limited-provider';
import { MockLlmProvider, type MockResponder, type MockScript } from './mock';
import { OpenAiProvider } from './openai';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider';

/** Stands in when no API key is configured, so each case fails with a clear, structured error. */
class UnconfiguredLlmProvider implements LlmProvider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly reason: string,
  ) {}

  async generate(_request: LlmRequest): Promise<LlmResponse> {
    throw new AppError('LLM_NOT_CONFIGURED', this.reason, { retryable: false, status: 503 });
  }
}

export interface CreateLlmOptions {
  /** Script for LLM_PROVIDER=mock; defaults to the deterministic fixture responder. */
  mockScript?: MockScript | MockResponder;
  fetch?: typeof fetch;
  limits?: Partial<LimitedProviderOptions>;
}

function createInnerProvider(config: PipelineConfig, options: CreateLlmOptions): LlmProvider {
  const { llm } = config;
  switch (llm.provider) {
    case 'openai':
      return llm.apiKey
        ? new OpenAiProvider({
            apiKey: llm.apiKey,
            model: llm.model,
            baseUrl: llm.baseUrl,
            timeoutMs: llm.timeoutMs,
            fetch: options.fetch,
          })
        : new UnconfiguredLlmProvider('openai', llm.model, 'OPENAI_API_KEY is not set.');
    case 'gemini':
      return llm.apiKey
        ? new GeminiProvider({
            apiKey: llm.apiKey,
            model: llm.model,
            timeoutMs: llm.timeoutMs,
            fetch: options.fetch,
          })
        : new UnconfiguredLlmProvider('gemini', llm.model, 'GEMINI_API_KEY is not set.');
    case 'mock':
      // deterministic offline replies derived from the prompt data (tests and offline demos)
      return new MockLlmProvider(options.mockScript ?? fixtureLlmResponder);
  }
}

/** Builds the configured provider wrapped in the shared concurrency / rate-limit / retry policy. */
export function createLlmProvider(
  config: PipelineConfig,
  options: CreateLlmOptions = {},
): LlmProvider {
  return new LimitedLlmProvider(createInnerProvider(config, options), {
    maxConcurrency: config.llm.maxConcurrency,
    requestsPerMinute: config.llm.requestsPerMinute,
    maxRetries: config.llm.maxRetries,
    ...options.limits,
  });
}
