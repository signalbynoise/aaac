/**
 * Human-readable progress snapshots for remediation CLI / Cursor monitoring.
 */
import fs from "fs";
import path from "path";
import { campaignDir, loadRunnerState, loadYield } from "./runner-state.mjs";
import { isoNow, readJson, writeJson } from "../../run-engine/lib.mjs";

export function loadSatisfaction(campaignId, iteration) {
  const p = path.join(campaignDir(campaignId), "iterations", String(iteration), "satisfaction.json");
  return fs.existsSync(p) ? readJson(p, null) : null;
}

export function buildProgressSnapshot(campaignId, runId, extra = {}) {
  const campaign = readJson(path.join(campaignDir(campaignId), "campaign.json"), null);
  const runner = loadRunnerState(campaignId);
  const yieldPayload = loadYield(campaignId);
  const iteration = campaign?.iteration ?? runner?.iteration ?? 0;
  const satisfaction = loadSatisfaction(campaignId, iteration);

  return {
    at: isoNow(),
    campaign_id: campaignId,
    run_id: runId,
    iteration,
    phase: runner?.phase ?? null,
    substep: runner?.substep ?? null,
    wave_index: runner?.wave_index ?? null,
    runner_status: runner?.status ?? null,
    yield_type: yieldPayload?.type ?? null,
    satisfaction_score: satisfaction?.score ?? campaign?.current?.satisfaction_score ?? null,
    satisfaction_threshold: campaign?.config?.satisfaction_threshold ?? null,
    health_score: campaign?.current?.fallow_health_score ?? null,
    clone_groups: campaign?.current?.fallow_dupes_clone_groups ?? null,
    intent: campaign?.intent ?? null,
    ...extra,
  };
}

export function writeProgressArtifact(campaignId, snapshot) {
  const out = path.join(campaignDir(campaignId), "progress.json");
  writeJson(out, snapshot);
  return out;
}

export function formatProgressLine(snapshot, event) {
  const score = snapshot.satisfaction_score ?? "?";
  const threshold = snapshot.satisfaction_threshold ?? "?";
  const health = snapshot.health_score ?? "?";
  const phase = [snapshot.phase, snapshot.substep].filter(Boolean).join("/") || "—";
  const wave = snapshot.wave_index != null && snapshot.phase === "execute" ? ` wave ${snapshot.wave_index}` : "";
  const yieldHint = snapshot.yield_type ? ` → yield ${snapshot.yield_type}` : "";
  const eventHint = event ? ` [${event}]` : "";
  return (
    `[remediate] iter ${snapshot.iteration} | ${phase}${wave} | ` +
    `score ${score}/${threshold} | health ${health}${yieldHint}${eventHint}`
  );
}
