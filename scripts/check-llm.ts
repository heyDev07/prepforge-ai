/**
 * Live smoke test of the configured LLM provider: runs requirement extraction on two fixture
 * job descriptions and prints what was kept and dropped.
 *
 *   npm run check:llm
 */
import { readFileSync } from 'node:fs';
import { isAppError } from '@prepforge/shared';
import { createLlmProvider, extractRequirements, loadPipelineConfig } from '@prepforge/pipeline';
import { loadEnv } from './lib/env';

loadEnv();
const config = loadPipelineConfig();
const llm = createLlmProvider(config);
console.log(`Provider: ${config.llm.provider} · model: ${config.llm.model}\n`);

let failed = false;
for (const file of ['jd-thin.txt', 'jd-backend.txt']) {
  const jd = readFileSync(new URL(`../fixtures/cases/${file}`, import.meta.url), 'utf8');
  const started = Date.now();
  try {
    const result = await extractRequirements(jd, llm);
    console.log(`── ${file} (${Date.now() - started} ms)`);
    console.log(
      `   role: ${result.roleTitle} · seniority: ${result.seniority} · location: ${result.location}`,
    );
    for (const r of result.requirements) {
      console.log(`   ${r.id.padEnd(4)} ${r.priority.padEnd(5)} ${r.kind.padEnd(12)} ${r.text}`);
    }
    for (const d of result.dropped) console.log(`   dropped (${d.reason}): ${d.text}`);
    for (const l of result.limitations) console.log(`   note: ${l}`);
    console.log();
  } catch (error) {
    failed = true;
    console.error(`── ${file}: FAILED`);
    console.error(isAppError(error) ? error.toJSON() : error);
  }
}
process.exit(failed ? 1 : 0);
