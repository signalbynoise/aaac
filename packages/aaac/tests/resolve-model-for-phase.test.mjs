import { describe, expect, it, beforeEach } from 'vitest';
import { resolveModelForPhase, resolveModelTierDetail } from '../src/run-engine/resolve-model-for-phase.mjs';
import { resetModelRoutingCache } from '../src/run-engine/load-model-routing.mjs';

describe('resolve-model-for-phase', () => {
  beforeEach(() => {
    resetModelRoutingCache();
  });

  it('returns codex for execute phase', () => {
    const result = resolveModelForPhase({ phase: 'execute' });
    expect(result.tier).toBe('codex');
    expect(result.model_slug).toBe('gpt-5.3-codex-high-fast');
    expect(result.source).toBe('phases');
  });

  it('agent_spec code-author overrides phase default', () => {
    const result = resolveModelForPhase({
      phase: 'verify',
      agent_spec_id: 'code-author',
    });
    expect(result.tier).toBe('codex');
    expect(result.model_slug).toBe('gpt-5.3-codex-high-fast');
    expect(result.source).toBe('agent_specs');
  });

  it('falls back to fast tier when unmapped', () => {
    const result = resolveModelForPhase({
      phase: 'unmapped-phase',
      agent_spec_id: 'missing-spec',
      subagent_type: 'missing-subagent-type',
    });
    expect(result.tier).toBe('fast');
    expect(result.model_slug).toBe('composer-2.5-fast');
    expect(result.source).toBe('default_tier');
  });

  it('resolveModelTierDetail includes routing_path', () => {
    const detail = resolveModelTierDetail({ phase: 'execute' });
    expect(Array.isArray(detail.routing_path)).toBe(true);
    expect(detail.routing_path.map((entry) => entry.source)).toEqual([
      'agent_specs',
      'phases',
    ]);
    expect(detail.routing_path[0].matched).toBe(false);
    expect(detail.routing_path[1].matched).toBe(true);
  });

  it('wildcard agent_specs discovery-* matches discovery-inventory', () => {
    const result = resolveModelForPhase({
      phase: 'plan',
      agent_spec_id: 'discovery-inventory',
    });
    expect(result.tier).toBe('fast');
    expect(result.model_slug).toBe('composer-2.5-fast');
    expect(result.source).toBe('agent_specs');
  });
});
