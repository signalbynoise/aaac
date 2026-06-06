import { expect, test } from '@playwright/test';
import {
  assertCommandMatchesVerbRuntime,
  getVerbRuntimePhases,
  hasBaseUrl,
  loadAaacRuntime,
  PUBLIC_SMOKE_ROUTES,
} from './fixtures/aaac-runtime.mjs';

const VERB = 'update';
const REPRESENTATIVE_COMMAND = 'update-module';

test.describe('update verb contract', () => {
  test('update-module resolves in runtime-registry with update verb', () => {
    const { registry, verbRuntime } = loadAaacRuntime();
    const { entry } = assertCommandMatchesVerbRuntime(
      registry,
      verbRuntime,
      REPRESENTATIVE_COMMAND,
      { verb: VERB },
    );

    expect(entry.resolver).toBe('update-module-by-slug');
    expect(entry.pending).toEqual(getVerbRuntimePhases(verbRuntime, VERB));
    expect(entry.pending).toContain('investigate_lite');
    expect(entry.pending).not.toContain('investigate_swarm');
    expect(entry.pending).not.toContain('root_cause');
  });

  test('verb_runtime.update matches graph SSOT shape', () => {
    const { verbRuntime } = loadAaacRuntime();
    const phases = getVerbRuntimePhases(verbRuntime, VERB);

    expect(phases).toEqual(getVerbRuntimePhases(verbRuntime, 'create'));
    expect(phases).toContain('rollback');
    expect(phases).toContain('verify');
  });
});

test.describe('update verb browser smoke', () => {
  test.beforeEach(() => {
    test.skip(!hasBaseUrl(), 'PLAYWRIGHT_BASE_URL not set — skipping browser checks');
  });

  for (const route of PUBLIC_SMOKE_ROUTES) {
    test(`public route ${route} loads after update work`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.ok()).toBeTruthy();
    });
  }
});
