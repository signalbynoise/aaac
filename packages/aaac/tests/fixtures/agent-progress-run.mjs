import fs from 'node:fs';
import { createModuleManifest } from './sample-manifests.mjs';
import { cleanupRun, seedRun, runManifestPath } from './run-state.mjs';
import { spawnRunEngine } from './run-engine-spawn.mjs';

export function createManifestWithSwarmAgents(conversationId, runId) {
  const manifest = createModuleManifest('discover', runId, conversationId);
  manifest.swarm = {
    task_launches_this_phase: 2,
    phase: 'discover',
    agents: [
      {
        index: 1,
        phase: 'discover',
        subagent_id: 'sub-first',
        at: '2026-06-26T10:00:01.000Z',
        started_at: '2026-06-26T10:00:01.000Z',
      },
      {
        index: 2,
        phase: 'discover',
        subagent_id: 'sub-second',
        at: '2026-06-26T10:00:02.000Z',
        started_at: '2026-06-26T10:00:02.000Z',
      },
    ],
  };
  manifest.log = [];
  return manifest;
}

export function seedTrackedAgentRun({
  conversationId,
  runId,
  runs,
  mutate = () => {},
}) {
  const manifest = createManifestWithSwarmAgents(conversationId, runId);
  mutate(manifest);
  seedRun(manifest, conversationId);
  runs.push({ runId, conversationId });
  return manifest;
}

export async function callAgentHookAndReadManifest(script, runId, payload) {
  const result = await spawnRunEngine(script, [], payload);
  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  return { result, manifest };
}

export function createAgentProgressLock(runId) {
  const manifestPath = runManifestPath(runId);
  fs.writeFileSync(
    `${manifestPath}.agent-progress.lock`,
    JSON.stringify({ pid: process.pid }),
  );
  return manifestPath;
}

export function cleanupTrackedAgentRuns(runs) {
  for (const { runId, conversationId } of runs.splice(0)) {
    cleanupRun(runId, conversationId);
  }
}
