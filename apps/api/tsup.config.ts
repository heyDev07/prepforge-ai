import { defineConfig } from 'tsup';

/** Bundles the API and the workspace packages into one self-contained dist/server.js. */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@prepforge\//],
});
