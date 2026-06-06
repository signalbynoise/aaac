import { describe, expect, it } from 'vitest';
import {
  loadRegistry,
  parseAaacPrompt,
} from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';

describe('parseAaacPrompt', () => {
  it('parses /create-module with domain and quoted intent', () => {
    const parsed = parseAaacPrompt('/create-module ui "Add nav helper"');
    expect(parsed).toEqual({
      command: 'create-module',
      domain: 'ui',
      intent: 'Add nav helper',
      raw: '/create-module ui "Add nav helper"',
    });
  });

  it('parses /update-module with unquoted intent', () => {
    const parsed = parseAaacPrompt('/update-module cms refresh orchestrator');
    expect(parsed?.command).toBe('update-module');
    expect(parsed?.domain).toBe('cms');
    expect(parsed?.intent).toBe('refresh orchestrator');
  });

  it('parses /fix-module with domain only', () => {
    const parsed = parseAaacPrompt('/fix-module ui');
    expect(parsed).toMatchObject({
      command: 'fix-module',
      domain: 'ui',
      intent: '',
    });
  });

  it('parses /check-module with domain and quoted intent', () => {
    const parsed = parseAaacPrompt('/check-module ui "Can nav persist?"');
    expect(parsed).toEqual({
      command: 'check-module',
      domain: 'ui',
      intent: 'Can nav persist?',
      raw: '/check-module ui "Can nav persist?"',
    });
  });

  it('resolves alias module-fix to fix-module', () => {
    const parsed = parseAaacPrompt('/module-fix ui "broken nav"');
    expect(parsed?.command).toBe('fix-module');
    expect(parsed?.domain).toBe('ui');
    expect(parsed?.intent).toBe('broken nav');
  });

  it('resolves alias create-skill to create-module', () => {
    const parsed = parseAaacPrompt('/create-skill aaac "new skill"');
    expect(parsed?.command).toBe('create-module');
  });

  it('resolves alias update-agent to update-module', () => {
    const parsed = parseAaacPrompt('/update-agent ui');
    expect(parsed?.command).toBe('update-module');
  });

  it('returns null for non-AAAC prompts', () => {
    expect(parseAaacPrompt('fix the nav bug')).toBeNull();
    expect(parseAaacPrompt('/unknown-command')).toBeNull();
    expect(parseAaacPrompt('')).toBeNull();
    expect(parseAaacPrompt(null)).toBeNull();
  });

  it('resolves alias check-inventory to check-module', () => {
    const parsed = parseAaacPrompt('/check-inventory cms');
    expect(parsed?.command).toBe('check-module');
  });

  it('registers create, update, fix, and check commands in runtime registry', () => {
    const registry = loadRegistry();
    for (const cmd of ['create-module', 'update-module', 'fix-module', 'check-module']) {
      expect(registry.commands[cmd]).toBeDefined();
    }
  });
});
