import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    exclude: ['tests/log.test.mjs'],
    testTimeout: 10_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@aaac-engine': path.resolve(
        __dirname,
        '../../.cursor/aaac/scripts/run-engine',
      ),
    },
  },
});
