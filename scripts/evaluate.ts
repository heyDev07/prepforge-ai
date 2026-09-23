/**
 * Batch evaluator.
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Options:
 *   --concurrency <n>   cases processed in parallel (default: BATCH_CONCURRENCY or 2)
 *   --timeout <ms>      time budget per case (default: CASE_TIMEOUT_MS or 480000)
 *
 * Exit codes: 0 = output written (individual cases may have failed; see their status),
 *             2 = bad arguments, unreadable or malformed input, invalid configuration,
 *             1 = unexpected error.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadPipelineConfig } from '@prepforge/pipeline';
import { loadEnv } from './lib/env';
import { BatchInputError, createEvaluatorDeps, evaluateCases } from './lib/evaluator';

const USAGE = 'Usage: npm run evaluate -- --input <cases.json> --output <kits.json>';
const log = (line: string) => console.error(line);

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({
      options: {
        input: { type: 'string' },
        output: { type: 'string' },
        concurrency: { type: 'string' },
        timeout: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (error) {
    log(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (!args.input || !args.output) {
    log(USAGE);
    return 2;
  }

  loadEnv();
  let config;
  try {
    config = loadPipelineConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      log(error.message);
      return 2;
    }
    throw error;
  }

  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  let cases: unknown;
  try {
    cases = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error) {
    log(`Could not read ${inputPath}: ${(error as Error).message}`);
    return 2;
  }

  const concurrency = Number(args.concurrency ?? config.pipeline.batchConcurrency);
  const caseTimeoutMs = Number(args.timeout ?? config.pipeline.caseTimeoutMs);
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isInteger(caseTimeoutMs) ||
    caseTimeoutMs < 1
  ) {
    log('--concurrency and --timeout must be positive integers.');
    return 2;
  }

  const started = Date.now();
  const model =
    config.llm.provider === 'mock'
      ? 'mock (offline)'
      : `${config.llm.provider}/${config.llm.model}`;
  log(
    `Evaluating ${Array.isArray(cases) ? cases.length : '?'} case(s) with ${model}, concurrency ${concurrency}…`,
  );

  let output;
  try {
    output = await evaluateCases(cases, createEvaluatorDeps(config), {
      concurrency,
      caseTimeoutMs,
      log,
    });
  } catch (error) {
    if (error instanceof BatchInputError) {
      log(error.message);
      return 2;
    }
    throw error;
  }

  // atomic write: never leave a half-written output file
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await rename(temporary, outputPath);

  const ok = output.kits.filter((k) => k.status === 'ok').length;
  log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${ok} ok, ${output.kits.length - ok} failed → ${outputPath}`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
