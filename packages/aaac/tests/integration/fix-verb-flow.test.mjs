import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { uniqueConversationId } from '../fixtures/hook-payloads.mjs';
import { RUNS_ROOT } from '../fixtures/paths.mjs';
import { cleanupRun, simulateVerbFlow } from './flow-helper.mjs';

describe('fix-module verb flow', () => {
  let runId = null;
  let conversationId = null;

  afterEach(() => {
    if (runId && conversationId) {
      cleanupRun(runId, conversationId);
      runId = null;
      conversationId = null;
    }
  });

  it('runs swarm investigation, root_cause artifacts, and verify_fix swarm', async () => {
    conversationId = uniqueConversationId('fix-flow');
    const { runId: id, manifest } = await simulateVerbFlow(
      '/fix-module ui "Docs nav active state"',
      conversationId,
    );
    runId = id;

    expect(manifest.status).toBe('completed');
    expect(manifest.verb).toBe('fix');
    expect(manifest.completed).toEqual(
      expect.arrayContaining(['investigate_swarm', 'root_cause', 'verify']),
    );
    expect(manifest.completed).not.toContain('investigate_lite');

    const runDir = path.join(RUNS_ROOT, runId);
    expect(fs.existsSync(path.join(runDir, 'artifacts/investigation.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'artifacts/root_cause.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'artifacts/plan.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'artifacts/report.md'))).toBe(true);
  });
});
