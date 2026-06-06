import { describe, expect, it } from 'vitest';
import {
  loadRegistry,
  phaseKind,
  isGatePhase,
} from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';

describe('phaseKind', () => {
  const registry = loadRegistry();

  it('marks gate phases from registry.gate_phases', () => {
    for (const phase of [
      'validate',
      'impact_analysis',
      'dependency_graph',
      'fitness_functions',
      'rollback',
    ]) {
      expect(isGatePhase(phase, registry)).toBe(true);
      expect(phaseKind(phase, registry)).toBe('gate');
    }
  });

  it('marks work phases for discover, execute, and report', () => {
    for (const phase of [
      'discover',
      'investigate_lite',
      'investigate_swarm',
      'root_cause',
      'plan',
      'execute',
      'verify',
      'report',
    ]) {
      expect(isGatePhase(phase, registry)).toBe(false);
      expect(phaseKind(phase, registry)).toBe('work');
    }
  });
});
