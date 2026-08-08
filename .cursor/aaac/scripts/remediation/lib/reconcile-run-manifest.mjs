/**
 * Reconcile AAAC run manifest pending queue with remediation runner state.
 * Prevents advance-phase from jumping to report when pending was drained by a prior chat session.
 */
import path from "path";
import { isoNow, loadRunManifest, runDir, writeJson } from "../../run-engine/lib.mjs";
import { PHASES } from "./runner-state.mjs";

export function phasesFrom(phase) {
  const idx = PHASES.indexOf(phase);
  if (idx < 0) return [...PHASES];
  return PHASES.slice(idx);
}

export function reconcileRemediationRun(runId, runnerState) {
  const manifestPath = path.join(runDir(runId), "run.json");
  const manifest = loadRunManifest(runId);
  if (!manifest || manifest.command !== "remediate-app") {
    return { ok: false, reason: "not_remediate_run" };
  }

  const targetPhase = runnerState?.phase ?? manifest.phase ?? "scan";
  const pending = phasesFrom(targetPhase);

  manifest.phase = targetPhase;
  manifest.pending = pending.slice(1);
  manifest.status = "running";
  manifest.campaign_iteration = runnerState?.iteration ?? manifest.campaign_iteration;
  manifest.updated_at = isoNow();
  manifest.swarm = manifest.swarm ?? {};
  manifest.swarm.task_launches_this_phase = 0;
  manifest.swarm.phase = targetPhase;

  writeJson(manifestPath, manifest);
  return {
    ok: true,
    phase: targetPhase,
    pending: manifest.pending,
    iteration: manifest.campaign_iteration,
  };
}
