#!/usr/bin/env node
/**
 * Run complexity + swarm target scripts at phase boundaries.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnforcement, loadRunManifest, writeJson, runDir } from "./lib.mjs";
import { applySwarmTargetsToManifest, resolveSwarmTargetDetail } from "./resolve-swarm-target.mjs";
import { loadSwarmSizing } from "./load-swarm-sizing.mjs";
import { applyExpectedAgentSpecs } from "./expected-agent-specs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runScript(name, args) {
  const script = path.join(__dirname, name);
  return spawnSync("node", [script, ...args], { encoding: "utf8" });
}

export function runPhaseComplexityHooks(runId, completedPhase, manifest) {
  const enforcement = loadEnforcement();
  const sizing = loadSwarmSizing(enforcement);
  const mutating =
    (enforcement.mutating_verbs ?? []).includes(manifest.verb) ||
    (enforcement.fix_commands ?? []).includes(manifest.command);

  if (completedPhase === "discover") {
    const result = runScript("compute-scope-complexity.mjs", [
      "--run-id",
      runId,
      "--source",
      "discover",
    ]);
    if (result.status !== 0) {
      return { ok: false, reason: result.stderr?.trim() || "compute-scope-complexity failed" };
    }
  }

  if (completedPhase === "scan" && manifest.command === "remediate-app") {
    const result = runScript("compute-scope-complexity.mjs", [
      "--run-id",
      runId,
      "--source",
      "remediation_scan",
    ]);
    if (result.status !== 0) {
      return { ok: false, reason: result.stderr?.trim() || "remediation scope compute failed" };
    }
  }

  if (completedPhase === "plan" && mutating) {
    const verify = runScript("verify-plan-complexity.mjs", ["--run-id", runId]);
    if (verify.status !== 0 && !process.env.AAAC_SKIP_PLAN_COMPLEXITY_VERIFY) {
      return { ok: false, reason: verify.stderr?.trim() || "verify-plan-complexity failed" };
    }
    const change = runScript("compute-change-complexity.mjs", [
      "--run-id",
      runId,
      "--source",
      "plan",
    ]);
    if (change.status !== 0) {
      return { ok: false, reason: change.stderr?.trim() || "compute-change-complexity failed" };
    }
  }

  if (completedPhase === "impact_analysis" && mutating) {
    const change = runScript("compute-change-complexity.mjs", [
      "--run-id",
      runId,
      "--source",
      "post_impact",
    ]);
    if (change.status !== 0) {
      return { ok: false, reason: change.stderr?.trim() || "post_impact change compute failed" };
    }
  }

  return { ok: true };
}

export function bootstrapSwarmSizing(runId, manifest) {
  const enforcement = loadEnforcement();
  const result = runScript("compute-scope-complexity.mjs", [
    "--run-id",
    runId,
    "--source",
    "bootstrap",
  ]);
  if (result.status !== 0) {
    applyExpectedAgentSpecs(manifest, { phase: manifest.phase });
    return manifest;
  }
  const refreshed = loadRunManifest(runId) ?? manifest;
  const firstPhase = refreshed.phase;
  if (firstPhase) {
    applySwarmTargetsToManifest(refreshed, [firstPhase], enforcement);
    applyExpectedAgentSpecs(refreshed, { phase: firstPhase });
    writeJson(path.join(runDir(runId), "run.json"), refreshed);
  }
  return refreshed;
}

export function applyNextPhaseSwarmTarget(runId, manifest, nextPhase) {
  if (!nextPhase) return manifest;
  const enforcement = loadEnforcement();
  applySwarmTargetsToManifest(manifest, [nextPhase], enforcement);
  applyExpectedAgentSpecs(manifest, { phase: nextPhase });
  const detail = resolveSwarmTargetDetail(nextPhase, manifest, enforcement);
  manifest.phase_metrics = manifest.phase_metrics ?? {};
  manifest.phase_metrics[`${nextPhase}_swarm_target`] = {
    target: detail.target,
    score: detail.score,
    phase_class: detail.phase_class,
  };
  return manifest;
}
