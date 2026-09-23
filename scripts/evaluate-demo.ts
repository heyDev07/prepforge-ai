/**
 * One-command demo of the batch evaluator against the fixture company websites:
 *
 *   npm run evaluate:demo                       # sample-cases.json → kits.json
 *   npm run evaluate:demo -- --input fixtures/cases/mixed-cases.json --output out.json
 *
 * Starts the mock sites on their fixed ports (4010+), runs the real CLI
 * (`npm run evaluate -- --input … --output …`) as a child process, then stops the sites.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MOCK_SITE_NAMES, startMockSites, type MockSiteName } from '@prepforge/pipeline/testing';

const { values } = parseArgs({
  options: { input: { type: 'string' }, output: { type: 'string' } },
  strict: true,
});
const input = values.input ?? 'fixtures/cases/sample-cases.json';
const output = values.output ?? 'kits.json';
const basePort = Number(process.env.MOCK_SITES_BASE_PORT ?? 4010);

let sites;
try {
  sites = await startMockSites({
    ports: Object.fromEntries(MOCK_SITE_NAMES.map((name, i) => [name, basePort + i])) as Record<
      MockSiteName,
      number
    >,
  });
} catch (error) {
  if ((error as { code?: string }).code === 'EADDRINUSE') {
    console.error(
      `Port ${basePort}+ is already in use. If \`npm run mock-sites\` is running, use ` +
        '`npm run evaluate -- --input <cases.json> --output <kits.json>` directly.',
    );
    process.exit(2);
  }
  throw error;
}
console.error(`Mock sites running on ports ${basePort}–${basePort + MOCK_SITE_NAMES.length - 1}.`);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const code = await new Promise<number>((done) => {
  const child = spawn(
    npm,
    ['run', '--silent', 'evaluate', '--', '--input', input, '--output', output],
    {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: 'inherit',
    },
  );
  child.on('close', (exitCode) => done(exitCode ?? 1));
});

await sites.close();
process.exit(code);
