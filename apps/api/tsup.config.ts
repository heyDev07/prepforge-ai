import { defineConfig } from 'tsup';

/**
 * Bundles the API with the workspace packages (@prepforge/*), which ship as TypeScript source.
 * Third-party packages stay external and load from node_modules at runtime: several are
 * CommonJS and would break inside an ESM bundle.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  skipNodeModulesBundle: true,
  noExternal: [/^@prepforge\//],
});
