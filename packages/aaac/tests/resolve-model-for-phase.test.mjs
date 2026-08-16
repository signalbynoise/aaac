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

  it('returns high-fast for execute', () => {
    const result = resolveModelForPhase({ phase: 'execute' });
    expect(result.tier).toBe('high');
    expect(result.model_slug).toBe('cursor-grok-4.6-high-fast');
    expect(result.source).toBe('phases');
  });

  it('agent_spec code-author overrides phase default', () => {
    const result = resolveModelForPhase({
      phase: 'verify',
      agent_spec_id: 'code-author',
    });
    expect(result.tier).toBe('high');
    expect(result.model_slug).toBe('cursor-grok-4.6-high-fast');
    expect(result.source).toBe('agent_specs');
  });

  it('falls back to low-fast when unmapped', () => {
    const result = resolveModelForPhase({
      phase: 'unmapped-phase',
      agent_spec_id: 'missing-spec',
      subagent_type: 'missing-subagent-type',
    });
    expect(result.tier).toBe('low');
    expect(result.model_slug).toBe('cursor-grok-4.6-low-fast');
    expect(result.source).toBe('default_tier');
  });

  it('resolveModelTierDetail includes routing_path', () => {
    const detail = resolveModelTierDetail({ phase: 'execute' });
    expect(Array.isArray(detail.routing_path)).toBe(true);
    expect(detail.routing_path.map((entry) => entry.source)).toEqual([
      'critical_phase',
      'agent_specs',
      'phases',
    ]);
    expect(detail.routing_path[0].matched).toBe(false);
    expect(detail.routing_path[1].matched).toBe(false);
    expect(detail.routing_path[2].matched).toBe(true);
  });

  it('wildcard agent_specs discovery-* matches discovery-inventory', () => {
    const result = resolveModelForPhase({
      phase: 'plan',
      agent_spec_id: 'discovery-inventory',
    });
    expect(result.tier).toBe('medium');
    expect(result.model_slug).toBe('cursor-grok-4.6-medium-fast');
    expect(result.source).toBe('agent_specs');
  });

  it('uses medium-fast for plan unless the command marks it critical', () => {
    const result = resolveModelForPhase({ phase: 'plan' });
    expect(result.tier).toBe('medium');
    expect(result.model_slug).toBe('cursor-grok-4.6-medium-fast');
  });

  it('uses xhigh-fast for check discover even when discovery-* would apply', () => {
    const result = resolveModelForPhase({
      phase: 'discover',
      verb: 'check',
      command: 'check-architecture',
      agent_spec_id: 'discovery-inventory',
    });
    expect(result.tier).toBe('critical');
    expect(result.model_slug).toBe('cursor-grok-4.6-xhigh-fast');
    expect(result.source).toBe('verb_critical_phases');
  });

  it('keeps check validate on low-fast', () => {
    const result = resolveModelForPhase({
      phase: 'validate',
      verb: 'check',
      command: '/check-architecture',
    });
    expect(result.tier).toBe('low');
    expect(result.model_slug).toBe('cursor-grok-4.6-low-fast');
  });

  it('uses xhigh-fast for fix plan', () => {
    const result = resolveModelForPhase({
      phase: 'plan',
      verb: 'fix',
      command: 'fix-module',
    });
    expect(result.tier).toBe('critical');
    expect(result.model_slug).toBe('cursor-grok-4.6-xhigh-fast');
    expect(result.source).toBe('verb_critical_phases');
  });

  it('infers check from command when verb is missing', () => {
    const result = resolveModelForPhase({
      phase: 'discover',
      command: '/check-architecture',
    });
    expect(result.source).toBe('verb_critical_phases');
    expect(result.model_slug).toBe('cursor-grok-4.6-xhigh-fast');
  });

  it('command_critical_phases beats verb_critical_phases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-routing-cmd-'));
    const aaacDir = path.join(dir, '.cursor', 'aaac');
    fs.mkdirSync(aaacDir, { recursive: true });
    fs.writeFileSync(
      path.join(aaacDir, 'model-routing.yaml'),
      [
        'version: 1',
        'command_critical_phases:',
        '  check-architecture: report',
        '',
      ].join('\n'),
    );
    const previous = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = dir;
    resetModelRoutingCache();
    try {
      const discover = resolveModelForPhase({
        phase: 'discover',
        verb: 'check',
        command: 'check-architecture',
      });
      const report = resolveModelForPhase({
        phase: 'report',
        verb: 'check',
        command: 'check-architecture',
      });
      expect(discover.model_slug).toBe('cursor-grok-4.6-medium-fast');
      expect(report.source).toBe('command_critical_phases');
      expect(report.model_slug).toBe('cursor-grok-4.6-xhigh-fast');
    } finally {
      if (previous == null) delete process.env.AAAC_WORKSPACE_ROOT;
      else process.env.AAAC_WORKSPACE_ROOT = previous;
      resetModelRoutingCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
      expect(routing.tiers.codex).toBe('cursor-grok-4.6-high-fast');
      expect(routing.tiers.reasoning).toBe('cursor-grok-4.6-xhigh-fast');
      expect(resolveModelForPhase({ phase: 'execute' }).model_slug).toBe(
        'cursor-grok-4.6-high-fast',
      );
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
