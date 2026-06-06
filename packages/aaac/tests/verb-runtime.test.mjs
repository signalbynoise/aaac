import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { loadVerbRuntimeFromGraph } from './fixtures/graph-verb-runtime.mjs';

const VERB_COMMANDS = {
  create: 'create-module',
  update: 'update-module',
  fix: 'fix-module',
  check: 'check-module',
};

describe('verb_runtime pending phases', () => {
  const graphRuntime = loadVerbRuntimeFromGraph();
  const registry = loadRegistry();

  for (const [verb, command] of Object.entries(VERB_COMMANDS)) {
    it(`${command} pending matches graph.yaml verb_runtime.${verb}`, () => {
      const expected = graphRuntime[verb];
      const entry = registry.commands[command];
      expect(entry?.pending).toEqual(expected);
    });
  }

  it('fix includes investigate_swarm and root_cause; create/update use investigate_lite', () => {
    const create = registry.commands['create-module'].pending;
    const update = registry.commands['update-module'].pending;
    const fix = registry.commands['fix-module'].pending;

    expect(create).toContain('investigate_lite');
    expect(update).toContain('investigate_lite');
    expect(create).not.toContain('investigate_swarm');
    expect(update).not.toContain('investigate_swarm');

    expect(fix).toContain('investigate_swarm');
    expect(fix).toContain('root_cause');
    expect(fix).not.toContain('investigate_lite');

    const swarmIdx = fix.indexOf('investigate_swarm');
    const rootIdx = fix.indexOf('root_cause');
    expect(swarmIdx).toBeGreaterThan(fix.indexOf('discover'));
    expect(rootIdx).toBeGreaterThan(swarmIdx);
  });

  it('check is readonly — no execute, plan, or investigation phases', () => {
    const check = registry.commands['check-module'].pending;

    expect(check[0]).toBe('discover');
    expect(check.at(-1)).toBe('report');
    expect(check).toContain('validate');
    expect(check).not.toContain('execute');
    expect(check).not.toContain('plan');
    expect(check).not.toContain('investigate_lite');
    expect(check).not.toContain('investigate_swarm');
    expect(check).not.toContain('root_cause');
  });
});
