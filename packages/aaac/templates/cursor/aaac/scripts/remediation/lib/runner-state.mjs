/**
 * SSOT helpers for remediation shell runner state.
 */
import fs from "fs";
import path from "path";
import {
  REPO_ROOT,
  isoNow,
  readJson,
  writeJson,
  loadRunManifest,
  runDir,
} from "../../run-engine/lib.mjs";

export const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");
export const RUNNER_VERSION = 1;

/** Runner exit codes (documented in babysit skill + remediate-app command). */
export const EXIT = {
  complete: 0,
  blocked: 1,
  runtime_error: 2,
  yield_agent: 3,
  progressed: 10,
};

export const PHASES = [
  "campaign_init",
  "scan",
  "check_swarm",
  "plan_waves",
  "execute",
  "debt_sweep",
  "satisfaction_gate",
  "report",
];

export function campaignDir(campaignId) {
  return path.join(CAMPAIGNS_ROOT, campaignId);
}

export function iterDir(campaignId, iteration) {
  return path.join(campaignDir(campaignId), "iterations", String(iteration));
}

export function runnerStatePath(campaignId) {
  return path.join(campaignDir(campaignId), "runner-state.json");
}

export function yieldArtifactPath(campaignId) {
  return path.join(campaignDir(campaignId), "runner-yield.json");
}

export function loadCampaign(campaignId) {
  return readJson(path.join(campaignDir(campaignId), "campaign.json"), null);
}

export function saveCampaign(campaign) {
  campaign.updated_at = isoNow();
  writeJson(path.join(campaignDir(campaign.campaign_id), "campaign.json"), campaign);
}

export function defaultRunnerState({ runId, campaignId, iteration = 0, phase = "campaign_init" }) {
  return {
    version: RUNNER_VERSION,
    run_id: runId,
    campaign_id: campaignId,
    status: "running",
    phase,
    substep: null,
    iteration,
    wave_index: 0,
    attempt: 1,
    tick_count: 0,
    stall_count: 0,
    last_score: null,
    last_clone_groups: null,
    last_progress_at: isoNow(),
    yield: null,
    started_at: isoNow(),
    updated_at: isoNow(),
  };
}

export function loadRunnerState(campaignId) {
  return readJson(runnerStatePath(campaignId), null);
}

export function saveRunnerState(state) {
  state.updated_at = isoNow();
  writeJson(runnerStatePath(state.campaign_id), state);
}

export function writeYield(campaignId, yieldPayload) {
  writeJson(yieldArtifactPath(campaignId), {
    ...yieldPayload,
    at: isoNow(),
  });
}

export function clearYield(campaignId) {
  const p = yieldArtifactPath(campaignId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function loadYield(campaignId) {
  return readJson(yieldArtifactPath(campaignId), null);
}

export function syncRunnerFromManifest(state, manifest) {
  if (!manifest) return state;
  state.phase = manifest.phase ?? state.phase;
  state.iteration = manifest.campaign_iteration ?? state.iteration;
  return state;
}

export function loadManifest(runId) {
  return loadRunManifest(runId);
}

export function runArtifactsDir(runId) {
  return path.join(runDir(runId), "artifacts");
}

export function emitResult(state, extra = {}) {
  const payload = {
    ok: true,
    status: state.status,
    phase: state.phase,
    substep: state.substep,
    iteration: state.iteration,
    wave_index: state.wave_index,
    attempt: state.attempt,
    tick_count: state.tick_count,
    yield: state.yield,
    ...extra,
  };
  console.log(JSON.stringify(payload));
  return payload;
}

export function fail(message, code = EXIT.runtime_error) {
  console.error(message);
  process.exit(code);
}
