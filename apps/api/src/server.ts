/**
 * API entry point: connects to MongoDB, recovers interrupted generation jobs, starts HTTP.
 *   npm run dev -w @prepforge/api      (loads the repository .env)
 */
import {
  ConfigError,
  createLlmProvider,
  createSearchProvider,
  HttpClient,
} from '@prepforge/pipeline';
import mongoose from 'mongoose';
import { createApp } from './app';
import { loadApiConfig } from './config';
import { JobRunner } from './services/job-runner';
import { MongoCacheStore } from './services/mongo-cache';

async function main() {
  let config;
  try {
    config = loadApiConfig();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(2);
  }

  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });
  console.warn(`[api] connected to MongoDB`);

  const http = new HttpClient();
  const jobs = new JobRunner(config, {
    llm: createLlmProvider(config.pipeline),
    http,
    search: createSearchProvider(config.pipeline, http),
    policy: { allowPrivateNetwork: config.pipeline.crawler.allowPrivateUrls },
    cache: new MongoCacheStore(),
  });
  await jobs.recover();

  const server = createApp({ config, jobs }).listen(config.port, () => {
    console.warn(
      `[api] listening on :${config.port} (${config.env}, LLM ${config.pipeline.llm.provider}/${config.pipeline.llm.model})`,
    );
  });

  const shutdown = async (signal: string) => {
    console.warn(`[api] ${signal} received, shutting down`);
    server.close();
    await Promise.race([jobs.idle(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
