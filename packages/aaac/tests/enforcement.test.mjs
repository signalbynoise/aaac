import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  loadEnforcement,
  loadRegistry,
} from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { ENFORCEMENT_PATH } from './fixtures/paths.mjs';

describe('enforcement.json', () => {
  const enforcement = loadEnforcement();
  const raw = JSON.parse(fs.readFileSync(ENFORCEMENT_PATH, 'utf8'));

  it('loads edit_phases for code change phases', () => {
    expect(enforcement.edit_phases).toEqual([
      'execute',
      'sync_inventory',
      'persist',
      'write',
    ]);
  });

  it('defines swarm minimums for discover and investigate_swarm', () => {
    expect(enforcement.swarm_min_agents.discover).toBe(4);
    expect(enforcement.swarm_min_agents.check_swarm).toBe(3);
    expect(enforcement.swarm_min_agents.investigate_swarm).toBe(7);
    expect(enforcement.swarm_min_agents.research_swarm).toBe(6);
  });

  it('requires fix-specific verify swarm count', () => {
    expect(enforcement.swarm_min_agents.verify_fix).toBe(3);
  });

  it('requires investigation and root_cause artifacts for fix swarm phases', () => {
    expect(enforcement.phase_artifacts.investigate_swarm).toEqual([
      'artifacts/investigation.md',
    ]);
    expect(enforcement.phase_artifacts.root_cause).toEqual([
      'artifacts/root_cause.yaml',
    ]);
  });

  it('requires plan and report artifacts for all verb flows', () => {
    expect(enforcement.phase_artifacts.plan).toEqual(['artifacts/plan.yaml']);
    expect(enforcement.phase_artifacts.verify).toEqual(['artifacts/verify.yaml']);
    expect(enforcement.phase_artifacts.report).toEqual(['artifacts/report.md']);
  });

  it('requires gate phase artifacts before advance', () => {
    expect(enforcement.phase_artifacts.validate).toEqual(['artifacts/validate.yaml']);
    expect(enforcement.phase_artifacts.impact_analysis).toEqual(['artifacts/impact.yaml']);
    expect(enforcement.phase_artifacts.dependency_graph).toEqual([
      'artifacts/dependency_graph.yaml',
    ]);
    expect(enforcement.phase_artifacts.fitness_functions).toEqual(['artifacts/fitness.yaml']);
    expect(enforcement.phase_artifacts.rollback).toEqual(['artifacts/rollback.yaml']);
  });

  it('requires website verify gate for create update fix verbs', () => {
    expect(enforcement.verify_verbs).toEqual(['create', 'update', 'fix']);
  });

  it('lists fix commands for verify_fix swarm routing', () => {
    expect(raw.fix_commands).toEqual(
      expect.arrayContaining(['fix-module', 'fix-bug', 'module-fix', 'bug-fix']),
    );
  });

  it('allows artifact writes under run state paths', () => {
    expect(enforcement.allowed_path_prefixes.run_artifacts).toEqual(
      expect.arrayContaining(['.cursor/aaac/state/runs/']),
    );
  });

  it('check verb has no execute phase — edit_phases exclude check-only flow', () => {
    const registry = loadRegistry();
    const checkPending = registry.commands['check-module'].pending;
    expect(checkPending).not.toContain('execute');
    for (const phase of checkPending) {
      expect(enforcement.edit_phases).not.toContain(phase);
    }
  });
});
