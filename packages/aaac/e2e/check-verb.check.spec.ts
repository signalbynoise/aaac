import { expect, test } from '@playwright/test';
import {
  assertCommandMatchesVerbRuntime,
  getVerbRuntimePhases,
  hasBaseUrl,
  listCommandsForVerb,
  loadAaacRuntime,
  PUBLIC_SMOKE_ROUTES,
} from './fixtures/aaac-runtime.mjs';

const VERB = 'check';
const REPRESENTATIVE_COMMAND = 'check-module';

test.describe('check verb contract', () => {
  test('check-module resolves in runtime-registry with check verb', () => {
    const { registry, verbRuntime } = loadAaacRuntime();
    const { entry } = assertCommandMatchesVerbRuntime(
      registry,
      verbRuntime,
      REPRESENTATIVE_COMMAND,
      { verb: VERB },
    );

    expect(entry.orchestrator).toBe('verb-check');
    expect(entry.pending).toEqual(getVerbRuntimePhases(verbRuntime, VERB));
    expect(entry.pending).not.toContain('execute');
    expect(entry.pending).not.toContain('plan');
    expect(entry.pending).not.toContain('investigate_lite');
    expect(entry.pending).not.toContain('investigate_swarm');
  });

  test('verb_runtime.check is readonly — discover → gates → report', () => {
    const { verbRuntime } = loadAaacRuntime();
    const phases = getVerbRuntimePhases(verbRuntime, VERB);

    expect(phases[0]).toBe('discover');
    expect(phases).toContain('validate');
    expect(phases).toContain('impact_analysis');
    expect(phases).not.toContain('execute');
    expect(phases.at(-1)).toBe('report');
  });

  test('all check-* registry commands share verb_runtime.check pending', () => {
    const { registry, verbRuntime } = loadAaacRuntime();
    const checkCommands = listCommandsForVerb(registry, VERB);

    expect(checkCommands.length).toBeGreaterThan(0);
    expect(checkCommands).toContain(REPRESENTATIVE_COMMAND);

    const expected = getVerbRuntimePhases(verbRuntime, VERB);
    for (const command of checkCommands) {
      expect(registry.commands[command].pending).toEqual(expected);
    }
  });
});

test.describe('check verb browser smoke', () => {
  test.beforeEach(() => {
    test.skip(!hasBaseUrl(), 'PLAYWRIGHT_BASE_URL not set — skipping browser checks');
  });

  for (const route of PUBLIC_SMOKE_ROUTES) {
    test(`public route ${route} loads for readonly check context`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.ok()).toBeTruthy();
    });
  }
});
