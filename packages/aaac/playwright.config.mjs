import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(packageRoot, 'e2e'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'aaac-verb-checks',
      testMatch: '**/*.check.spec.ts',
    },
  ],
});
