/**
 * V4 — Capture run trajectory (how work was done) for expertise learning.
 */

import fs from "fs";
import path from "path";
import { isoNow } from "../lib.mjs";
import { signatureKey } from "./stats.mjs";

/**
 * Quality gate: success + no gate fails + required review artifacts present.
 * @returns {{ ok: boolean, score: number, reasons: string[] }}
 */
export function assessRunQuality(manifest, { artifactsDir = null, failures = [] } = {}) {
  const reasons = [];
  const success = manifest?.status === "completed";
  if (!success) reasons.push("not_completed");

  const gateFails = Array.isArray(failures) ? failures.length : 0;
  const logGates = (manifest?.log ?? []).filter(
    (e) =>
      e?.event === "gate_fail" ||
      String(e?.detail ?? "").includes("context_budget_exceeded"),
  ).length;
  const gates = Math.max(gateFails, logGates);
  if (gates > 0) reasons.push(`gate_fails:${gates}`);

  if (artifactsDir && fs.existsSync(artifactsDir)) {
    const verb = manifest?.verb ?? "";
    if (verb === "review" || String(manifest?.command ?? "").includes("review")) {
      for (const name of ["plan.yaml", "report.md"]) {
        if (!fs.existsSync(path.join(artifactsDir, name))) {
          reasons.push(`missing_${name}`);
        }
      }
    }
  }

  const ok = success && gates === 0 && !reasons.some((r) => r.startsWith("missing_"));
  return {
    ok,
    score: ok ? 1 : success && gates === 0 ? 0.5 : 0,
    reasons,
  };
}

function collectAgents(manifest) {
  const agents = [];
  if (Array.isArray(manifest?.swarm?.agents)) {
    agents.push(...manifest.swarm.agents);
  }
  for (const phaseBlock of Object.values(manifest?.swarm_history ?? {})) {
    if (Array.isArray(phaseBlock?.agents)) agents.push(...phaseBlock.agents);
  }
  return agents;
}

function sumFilesRead(agents) {
  return agents.reduce((s, a) => s + (Number(a?.files_read) || 0), 0);
}

/**
 * Build a trajectory snapshot from a terminal run manifest.
 */
export function buildTrajectory(manifest, {
  artifactsDir = null,
  failures = [],
  profileId = null,
} = {}) {
  const quality = assessRunQuality(manifest, { artifactsDir, failures });
  const agents = collectAgents(manifest);
  const completed = Array.isArray(manifest?.completed) ? manifest.completed : [];
  const phaseMetrics = manifest?.phase_metrics ?? {};

  const steps = completed.map((phase) => {
    const pm = phaseMetrics[phase] ?? {};
    const phaseAgents = agents.filter(
      (a) => a?.phase === phase || a?.skill?.includes?.(phase),
    );
    return {
      phase,
      agents: phaseAgents.length || (manifest?.swarm?.task_launches_this_phase && phase === manifest.phase
        ? manifest.swarm.task_launches_this_phase
        : 0),
      tokens: pm.tokens ?? null,
      duration_ms: pm.duration_ms ?? null,
      files_read: sumFilesRead(phaseAgents),
    };
  });

  const tokens =
    manifest?.metrics?.total_tokens ??
    manifest?.metrics?.conversation_tokens ??
    null;
  const durationMs = manifest?.metrics?.duration_ms ?? null;
  const filesReadTotal = sumFilesRead(agents);

  return {
    version: 1,
    run_id: manifest?.run_id ?? null,
    signature: signatureKey(manifest ?? {}),
    command: manifest?.command ?? null,
    verb: manifest?.verb ?? null,
    object: manifest?.object ?? null,
    domain: manifest?.domain ?? null,
    status: manifest?.status ?? null,
    quality,
    tokens,
    duration_ms: durationMs,
    files_read_total: filesReadTotal,
    agent_count: agents.length,
    steps,
    profile_id: profileId,
    prepared_at: isoNow(),
  };
}

/**
 * Efficiency reward after quality gate (V4).
 * Returns null when quality fails (policy must not reward cheap failures).
 */
export function computeEfficiencyReward(trajectory, baselines = {}) {
  if (!trajectory?.quality?.ok) return null;
  let reward = 0.4;
  const {
    baselineTokens = null,
    baselineDurationMs = null,
    baselineFilesRead = null,
  } = baselines;

  if (baselineTokens && trajectory.tokens != null && baselineTokens > 0) {
    reward += Math.max(
      -0.25,
      Math.min(0.25, (baselineTokens - trajectory.tokens) / baselineTokens),
    );
  }
  if (
    baselineDurationMs &&
    trajectory.duration_ms != null &&
    baselineDurationMs > 0
  ) {
    reward += Math.max(
      -0.2,
      Math.min(
        0.2,
        (baselineDurationMs - trajectory.duration_ms) / baselineDurationMs,
      ),
    );
  }
  if (
    baselineFilesRead &&
    trajectory.files_read_total != null &&
    baselineFilesRead > 0
  ) {
    reward += Math.max(
      -0.2,
      Math.min(
        0.2,
        (baselineFilesRead - trajectory.files_read_total) / baselineFilesRead,
      ),
    );
  }
  return Math.max(-1, Math.min(1, Math.round(reward * 1000) / 1000));
}
