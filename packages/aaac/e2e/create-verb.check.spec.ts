import { expect, test } from '@playwright/test';
import {
  assertCommandMatchesVerbRuntime,
  getVerbRuntimePhases,
  hasBaseUrl,
  loadAaacRuntime,
  PUBLIC_SMOKE_ROUTES,
} from './fixtures/aaac-runtime.mjs';

const VERB = 'create';
const REPRESENTATIVE_COMMAND = 'create-module';

test.describe('create verb contract', () => {
  test('create-module resolves in runtime-registry with create verb', () => {
    const { registry, verbRuntime } = loadAaacRuntime();
    const { entry } = assertCommandMatchesVerbRuntime(
      registry,
      verbRuntime,
      REPRESENTATIVE_COMMAND,
      { verb: VERB },
    );

    expect(entry.orchestrator).toBeTruthy();
    expect(entry.pending).toEqual(getVerbRuntimePhases(verbRuntime, VERB));
    expect(entry.pending).toContain('verify');
    expect(entry.pending).toContain('execute');
    expect(entry.pending).not.toContain('investigate_swarm');
  });

  test('verb_runtime.create is the SSOT for create pending phases', () => {
    const { verbRuntime } = loadAaacRuntime();
    const phases = getVerbRuntimePhases(verbRuntime, VERB);

    expect(phases[0]).toBe('discover');
    expect(phases).toContain('investigate_lite');
    expect(phases).toContain('plan');
    expect(phases.indexOf('execute')).toBeGreaterThan(phases.indexOf('plan'));
    expect(phases.at(-1)).toBe('report');
  });
});

test.describe('create verb browser smoke', () => {
  test.beforeEach(() => {
    test.skip(!hasBaseUrl(), 'PLAYWRIGHT_BASE_URL not set — skipping browser checks');
  });

  for (const route of PUBLIC_SMOKE_ROUTES) {
    test(`public route ${route} loads after create/update/fix work`, async ({
      page,
    }) => {
      const response = await page.goto(route);
      expect(response?.ok()).toBeTruthy();
    });
  }
});
