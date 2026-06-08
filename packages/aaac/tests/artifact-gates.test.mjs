import { describe, expect, it, afterEach } from 'vitest';
import {
  hasYamlField,
  planRequiresTests,
  readYamlListField,
  validatePhaseArtifactContent,
} from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { writeArtifact, nextRunId, seedRun, cleanupRun } from './fixtures/run-state.mjs';
import { createModuleManifest } from './fixtures/sample-manifests.mjs';
import { loadEnforcement } from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';

describe('artifact content gates', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('readYamlListField parses list items', () => {
    const yaml = 'tests_to_add:\n  - behavior: one\n  - behavior: two\nsteps: []\n';
    expect(readYamlListField(yaml, 'tests_to_add')).toEqual(['behavior: one', 'behavior: two']);
  });

  it('planRequiresTests is true when tests_to_add has entries', () => {
    const yaml = 'tests_to_add:\n  - behavior: cache hit\n';
    expect(planRequiresTests(yaml)).toBe(true);
  });

  it('validatePhaseArtifactContent rejects deferred test_plan', () => {
    const conversationId = uniqueConversationId('artifact-gate');
    const runId = nextRunId('artifact-gate');
    const manifest = createModuleManifest('test_execute', runId, conversationId);
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      'artifacts/plan.yaml',
      'tests_to_add:\n  - behavior: required\n',
    );
    writeArtifact(
      runId,
      'artifacts/test_plan.yaml',
      'status: deferred\n',
    );

    const enforcement = loadEnforcement();
    const result = validatePhaseArtifactContent(
      runId,
      'test_execute',
      manifest,
      enforcement,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/defer/i);
  });
});
