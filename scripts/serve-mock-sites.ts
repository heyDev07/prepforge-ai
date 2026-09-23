/**
 * Serves the fixture company websites on fixed localhost ports so the batch evaluator can be
 * run against them by hand:
 *
 *   npm run mock-sites
 *   npm run evaluate -- --input fixtures/cases/sample-cases.json --output kits.json
 */
import { MOCK_SITE_NAMES, startMockSites, type MockSiteName } from '@prepforge/pipeline/testing';

const BASE_PORT = Number(process.env.MOCK_SITES_BASE_PORT ?? 4010);

const ports = Object.fromEntries(
  MOCK_SITE_NAMES.map((name, index) => [name, BASE_PORT + index]),
) as Record<MockSiteName, number>;

const handle = await startMockSites({ ports });
console.log('Mock company websites:');
for (const name of MOCK_SITE_NAMES) console.log(`  ${name.padEnd(18)} ${handle.urls[name]}`);
console.log('\nPress Ctrl+C to stop.');

const shutdown = async () => {
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
