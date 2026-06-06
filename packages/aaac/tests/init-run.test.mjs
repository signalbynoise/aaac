import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import { loadRegistry } from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { beforeSubmitPromptHook, uniqueConversationId } from './fixtures/hook-payloads.mjs';
import {
  cleanupRun,
  runManifestPath,
  conversationActivePath,
} from './fixtures/run-state.mjs';
import { initRun } from './fixtures/run-engine-spawn.mjs';

const VERB_CASES = [
  {
    prompt: '/create-module ui "New skill module"',
    command: 'create-module',
    verb: 'create',
    object: 'module',
    firstPhase: 'discover',
    includes: ['investigate_lite'],
    excludes: ['investigate_swarm', 'root_cause'],
  },
  {
    prompt: '/update-module cms "Refresh orchestrator"',
    command: 'update-module',
    verb: 'update',
    object: 'module',
    firstPhase: 'discover',
    includes: ['investigate_lite'],
    excludes: ['investigate_swarm'],
  },
  {
    prompt: '/fix-module ui "Nav regression"',
    command: 'fix-module',
    verb: 'fix',
    object: 'module',
    firstPhase: 'discover',
    includes: ['investigate_swarm', 'root_cause'],
    excludes: ['investigate_lite'],
  },
  {
    prompt: '/check-module ui "Can nav persist?"',
    command: 'check-module',
    verb: 'check',
    object: 'module',
    firstPhase: 'discover',
    includes: ['validate'],
    excludes: ['execute', 'plan', 'investigate_lite', 'investigate_swarm'],
  },
];

describe('init-run', () => {
  const created = [];

  afterEach(() => {
    for (const { runId, conversationId } of created.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('returns aaac:false for non-command prompts', async () => {
    const result = await initRun(beforeSubmitPromptHook('hello world'));
    expect(result.json?.aaac).toBe(false);
  });

  it('requires conversation_id for AAAC commands', async () => {
    const result = await initRun({ prompt: '/create-module ui test' });
    expect(result.json?.ok).toBe(false);
    expect(result.json?.error).toMatch(/conversation_id/);
  });

  for (const spec of VERB_CASES) {
    it(`creates manifest for ${spec.command}`, async () => {
      const conversationId = uniqueConversationId(spec.command);
      const result = await initRun(beforeSubmitPromptHook(spec.prompt, conversationId));
      expect(result.json?.ok).toBe(true);
      expect(result.json?.aaac).toBe(true);

      const runId = result.json.run_id;
      created.push({ runId, conversationId });

      expect(result.json.command).toBe(spec.command);
      expect(result.json.phase).toBe(spec.firstPhase);

      const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
      const registry = loadRegistry();
      const expectedPending = registry.commands[spec.command].pending;

      expect(manifest.verb).toBe(spec.verb);
      expect(manifest.object).toBe(spec.object);
      expect(manifest.phase).toBe(spec.firstPhase);
      expect(manifest.pending).toEqual(expectedPending.slice(1));
      expect(manifest.enforcement.edit_allowed).toBe(false);
      expect(manifest.conversation_id).toBe(conversationId);

      for (const phase of spec.includes) {
        expect(expectedPending).toContain(phase);
      }
      for (const phase of spec.excludes) {
        expect(expectedPending).not.toContain(phase);
      }

      const active = JSON.parse(
        fs.readFileSync(conversationActivePath(conversationId), 'utf8'),
      );
      expect(active.run_id).toBe(runId);
      expect(active.edit_allowed).toBe(false);
    });
  }
});
