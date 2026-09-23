import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_USER_AGENT, loadPipelineConfig } from '../src';

describe('loadPipelineConfig', () => {
  it('applies the documented defaults to an empty environment', () => {
    const config = loadPipelineConfig({});
    expect(config.llm).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: undefined,
      maxConcurrency: 2,
    });
    expect(config.crawler).toEqual({
      maxPages: 12,
      maxDepth: 2,
      requestTimeoutMs: 10_000,
      maxPageBytes: 1_000_000,
      maxConcurrency: 2,
      maxRetries: 3,
      crawlDelayMs: 200,
      allowPrivateUrls: false,
      userAgent: DEFAULT_USER_AGENT,
    });
    expect(config.pipeline.maxCoveragePasses).toBe(3);
    expect(config.search.provider).toBe('hn');
  });

  it('treats empty values from .env as unset', () => {
    const config = loadPipelineConfig({ LLM_MODEL: '', LLM_BASE_URL: '', MAX_PAGES: '' });
    expect(config.llm.model).toBe('gpt-4.1-mini');
    expect(config.llm.baseUrl).toBeUndefined();
    expect(config.crawler.maxPages).toBe(12);
  });

  it('picks the API key that matches the provider', () => {
    const env = { OPENAI_API_KEY: 'sk-openai', GEMINI_API_KEY: 'g-key' };
    expect(loadPipelineConfig(env).llm.apiKey).toBe('sk-openai');
    const gemini = loadPipelineConfig({ ...env, LLM_PROVIDER: 'gemini' });
    expect(gemini.llm.apiKey).toBe('g-key');
    expect(gemini.llm.model).toBe('gemini-2.5-flash');
  });

  it.each(['OPEN_AI', 'OpenAI', ' open-ai '])('accepts %j as the openai provider', (value) => {
    expect(loadPipelineConfig({ LLM_PROVIDER: value }).llm.provider).toBe('openai');
  });

  it('parses numbers and booleans from strings', () => {
    const config = loadPipelineConfig({ MAX_PAGES: '5', ALLOW_PRIVATE_URLS: 'TRUE' });
    expect(config.crawler.maxPages).toBe(5);
    expect(config.crawler.allowPrivateUrls).toBe(true);
    expect(loadPipelineConfig({ ALLOW_PRIVATE_URLS: '0' }).crawler.allowPrivateUrls).toBe(false);
  });

  it.each([
    [{ LLM_PROVIDER: 'unknown' }],
    [{ MAX_PAGES: 'many' }],
    [{ MAX_PAGES: '0' }],
    [{ MAX_DEPTH: '1.5' }],
    [{ ALLOW_PRIVATE_URLS: 'yes' }],
  ])('rejects invalid values %o with a readable error', (env) => {
    expect(() => loadPipelineConfig(env)).toThrow(ConfigError);
  });
});
