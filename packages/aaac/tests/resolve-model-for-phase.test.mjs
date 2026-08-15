import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveModelForPhase, resolveModelTierDetail } from '../src/run-engine/resolve-model-for-phase.mjs';
import {
  resetModelRoutingCache,
  loadModelRouting,
  isAllowedAaacModelSlug,
  toCursorCliModelSlug,
  AAAC_MODEL_FAMILY,
  AAAC_MODEL_PROVIDER,
  DEFAULT_AAAC_MODEL_SLUG,
} from '../src/run-engine/load-model-routing.mjs';

describe('resolve-model-for-phase', () => {
  beforeEach(() => {
    resetModelRoutingCache();
  });

  it('returns cursor-grok-4.6-high for execute phase', () => {
    const result = resolveModelForPhase({ phase: 'execute' });
    expect(result.tier).toBe('codex');
    expect(result.model_slug).toBe('cursor-grok-4.6-high');
    expect(result.source).toBe('phases');
  });

  it('agent_spec code-author overrides phase default', () => {
    const result = resolveModelForPhase({
      phase: 'verify',
      agent_spec_id: 'code-author',
    });
    expect(result.tier).toBe('codex');
    expect(result.model_slug).toBe('cursor-grok-4.6-high');
    expect(result.source).toBe('agent_specs');
  });

  it('falls back to fast Grok 4.6 when unmapped', () => {
    const result = resolveModelForPhase({
      phase: 'unmapped-phase',
      agent_spec_id: 'missing-spec',
      subagent_type: 'missing-subagent-type',
    });
    expect(result.tier).toBe('fast');
    expect(result.model_slug).toBe('cursor-grok-4.6-medium-fast');
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
    expect(result.model_slug).toBe('cursor-grok-4.6-medium-fast');
    expect(result.source).toBe('agent_specs');
  });

  it('returns cursor-grok-4.6-xhigh for reasoning phases', () => {
    const result = resolveModelForPhase({ phase: 'plan' });
    expect(result.tier).toBe('reasoning');
    expect(result.model_slug).toBe('cursor-grok-4.6-xhigh');
  });

  it('maps AAAC shorthand onto Cursor CLI slugs', () => {
    expect(toCursorCliModelSlug('grok-4.6-fast')).toBe('cursor-grok-4.6-medium-fast');
    expect(toCursorCliModelSlug('grok-4.6-high')).toBe('cursor-grok-4.6-high');
    expect(toCursorCliModelSlug('grok-4.6-xhigh')).toBe('cursor-grok-4.6-xhigh');
    expect(toCursorCliModelSlug('cursor-grok-4.6-fast')).toBe('cursor-grok-4.6-medium-fast');
    expect(toCursorCliModelSlug('cursor-grok-4.6-high-fast')).toBe('cursor-grok-4.6-high-fast');
    expect(toCursorCliModelSlug('composer-2.5-fast')).toBe(DEFAULT_AAAC_MODEL_SLUG);
  });

  it('allows only Grok 4.6 slugs', () => {
    expect(isAllowedAaacModelSlug('grok-4.6-fast')).toBe(true);
    expect(isAllowedAaacModelSlug('cursor-grok-4.6-xhigh-fast')).toBe(true);
    expect(isAllowedAaacModelSlug('grok-4.5-fast')).toBe(false);
    expect(isAllowedAaacModelSlug('composer-2.5-fast')).toBe(false);
    expect(isAllowedAaacModelSlug('gpt-5.3-codex-high-fast')).toBe(false);
    expect(isAllowedAaacModelSlug('claude-sonnet-5-thinking-high')).toBe(false);
  });

  it('coerces non-Grok YAML slugs to Grok 4.6 defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-routing-'));
    const aaacDir = path.join(dir, '.cursor', 'aaac');
    fs.mkdirSync(aaacDir, { recursive: true });
    fs.writeFileSync(
      path.join(aaacDir, 'model-routing.yaml'),
      [
        'version: 1',
        'tiers:',
        '  fast: composer-2.5-fast',
        '  codex: gpt-5.3-codex-high-fast',
        '  reasoning: claude-sonnet-5-thinking-high',
        'default_tier: fast',
        '',
      ].join('\n'),
    );
    const previous = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = dir;
    resetModelRoutingCache();
    try {
      const routing = loadModelRouting();
      expect(routing.provider).toBe(AAAC_MODEL_PROVIDER);
      expect(routing.family).toBe(AAAC_MODEL_FAMILY);
      expect(routing.tiers.fast).toBe('cursor-grok-4.6-medium-fast');
      expect(routing.tiers.codex).toBe('cursor-grok-4.6-high');
      expect(routing.tiers.reasoning).toBe('cursor-grok-4.6-xhigh');
      expect(resolveModelForPhase({ phase: 'execute' }).model_slug).toBe('cursor-grok-4.6-high');
    } finally {
      if (previous == null) delete process.env.AAAC_WORKSPACE_ROOT;
      else process.env.AAAC_WORKSPACE_ROOT = previous;
      resetModelRoutingCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('coerces installed shorthand YAML slugs to Cursor CLI ids', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-routing-shorthand-'));
    const aaacDir = path.join(dir, '.cursor', 'aaac');
    fs.mkdirSync(aaacDir, { recursive: true });
    fs.writeFileSync(
      path.join(aaacDir, 'model-routing.yaml'),
      [
        'version: 1',
        'tiers:',
        '  fast: grok-4.6-fast',
        '  codex: grok-4.6-high',
        '  reasoning: grok-4.6-xhigh',
        'default_tier: fast',
        '',
      ].join('\n'),
    );
    const previous = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = dir;
    resetModelRoutingCache();
    try {
      const routing = loadModelRouting();
      expect(routing.tiers.fast).toBe('cursor-grok-4.6-medium-fast');
      expect(routing.tiers.codex).toBe('cursor-grok-4.6-high');
      expect(routing.tiers.reasoning).toBe('cursor-grok-4.6-xhigh');
      expect(resolveModelForPhase({ phase: 'discover' }).model_slug).toBe(
        'cursor-grok-4.6-medium-fast',
      );
    } finally {
      if (previous == null) delete process.env.AAAC_WORKSPACE_ROOT;
      else process.env.AAAC_WORKSPACE_ROOT = previous;
      resetModelRoutingCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
