import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    exclude: ['tests/log.test.mjs'],
    testTimeout: 60_000,
    setupFiles: ['tests/fixtures/test-workspace.mjs'],
  },
  resolve: {
    alias: {
      '@aaac-engine': path.resolve(__dirname, 'src/run-engine'),
    },
  },
});
