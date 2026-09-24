import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // one in-memory MongoDB per test file
    fileParallelism: false,
  },
});
