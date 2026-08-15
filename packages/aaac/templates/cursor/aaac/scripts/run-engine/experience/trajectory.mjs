/**
 * V4 — Capture run trajectory (how work was done) for expertise learning.
 */

import fs from "fs";
import path from "path";
import { isoNow } from "../lib.mjs";
import { signatureKey } from "./stats.mjs";
import { harvestPathsTouched } from "./repo-learn.mjs";

function isGateFailResult(result) {
  return result === "fail" || result?.result === "fail" || result?.status === "fail";
}

/**
 * Quality gate: completed + no unresolved failure.
 * Recovered gate retries and context-budget warnings are recorded, not blocking.
 * @returns {{ ok: boolean, score: number, reasons: string[] }}
 */
export function assessRunQuality(manifest, { artifactsDir = null, failures = [] } = {}) {
  const reasons = [];
  const success = manifest?.status === "completed";
  if (!success) reasons.push("not_completed");

  const gateResults = manifest?.gates?.results ?? {};
  const unresolvedGates = Object.entries(gateResults)
    .filter(([, result]) => isGateFailResult(result))
    .map(([name]) => name);
  if (unresolvedGates.length) {
    reasons.push(`unresolved_gates:${unresolvedGates.join(",")}`);
  }

  if (manifest?.blocked_reason) reasons.push("unresolved_block");
  if (manifest?.awaiting_approval) reasons.push("awaiting_approval");

  const recovered = (manifest?.log ?? []).filter((e) => e?.event === "gate_fail").length;
  if (recovered > 0) reasons.push(`recovered_gate_fails:${recovered}`);

  const budgetWarns = (manifest?.log ?? []).filter((e) =>
    String(e?.detail ?? "").includes("context_budget_exceeded"),
  ).length;
  if (budgetWarns > 0) reasons.push(`context_budget_warnings:${budgetWarns}`);

  // Historical extractFailures are informational only — recovered retries must not block.
  void failures;

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

  const blocking = reasons.some(
    (r) =>
      r === "not_completed" ||
      r.startsWith("unresolved_gates:") ||
      r === "unresolved_block" ||
      r === "awaiting_approval" ||
      r.startsWith("missing_"),
  );
  const ok = !blocking;
  return {
    ok,
    score: ok ? 1 : success && unresolvedGates.length === 0 ? 0.5 : 0,
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
  const pathsTouched = harvestPathsTouched(artifactsDir);

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
    paths_touched: pathsTouched,
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
