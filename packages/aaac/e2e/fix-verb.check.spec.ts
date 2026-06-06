import { expect, test } from '@playwright/test';
import {
  assertCommandMatchesVerbRuntime,
  getVerbRuntimePhases,
  hasBaseUrl,
  loadAaacRuntime,
  PUBLIC_SMOKE_ROUTES,
} from './fixtures/aaac-runtime.mjs';

const VERB = 'fix';
const REPRESENTATIVE_COMMAND = 'fix-module';

test.describe('fix verb contract', () => {
  test('fix-module resolves in runtime-registry with fix verb', () => {
    const { registry, verbRuntime } = loadAaacRuntime();
    const { entry } = assertCommandMatchesVerbRuntime(
      registry,
      verbRuntime,
      REPRESENTATIVE_COMMAND,
      { verb: VERB },
    );

    expect(entry.pending).toEqual(getVerbRuntimePhases(verbRuntime, VERB));
    expect(entry.pending).toContain('investigate_swarm');
    expect(entry.pending).toContain('root_cause');
    expect(entry.pending.indexOf('investigate_swarm')).toBeLessThan(
      entry.pending.indexOf('root_cause'),
    );
    expect(entry.pending.indexOf('root_cause')).toBeLessThan(
      entry.pending.indexOf('plan'),
    );
  });

  test('fix-bug workflow matches verb_runtime.fix (exception command)', () => {
    const { registry, verbRuntime } = loadAaacRuntime();
    assertCommandMatchesVerbRuntime(registry, verbRuntime, 'fix-bug', {
      verb: VERB,
    });
  });

  test('verb_runtime.fix includes deep investigation phases', () => {
    const { verbRuntime } = loadAaacRuntime();
    const phases = getVerbRuntimePhases(verbRuntime, VERB);

    expect(phases).toContain('investigate_swarm');
    expect(phases).toContain('root_cause');
    expect(phases).not.toContain('investigate_lite');
    expect(phases).toContain('verify');
  });
});

test.describe('fix verb browser smoke', () => {
  test.beforeEach(() => {
    test.skip(!hasBaseUrl(), 'PLAYWRIGHT_BASE_URL not set — skipping browser checks');
  });

  for (const route of PUBLIC_SMOKE_ROUTES) {
    test(`public route ${route} loads after fix work`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.ok()).toBeTruthy();
    });
  }
});
