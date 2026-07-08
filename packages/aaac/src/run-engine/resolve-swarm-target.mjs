#!/usr/bin/env node
/**
 * Resolve parallel agent count for a phase from complexity scores and swarm-sizing tiers.
 */
import {
  loadSwarmSizing,
  getPhaseClass,
  resolveSwarmFloor,
  resolveSwarmCeiling,
  tierLookup,
} from "./load-swarm-sizing.mjs";
import { resolveSwarmWaves } from "./resolve-swarm-waves.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __rtdir = path.dirname(fileURLToPath(import.meta.url));

function readEnforcement() {
  try {
    const root = process.env.AAAC_WORKSPACE_ROOT
      ? path.join(path.resolve(process.env.AAAC_WORKSPACE_ROOT), ".cursor", "aaac")
      : path.resolve(__rtdir, "../../..", "aaac");
    return JSON.parse(fs.readFileSync(path.join(root, "enforcement.json"), "utf8"));
  } catch {
    return { mutating_verbs: ["create", "update", "fix"], fix_commands: [] };
  }
}

function isMutating(manifest, enforcement) {
  const mutating = enforcement.mutating_verbs ?? ["create", "update", "fix"];
  return (
    mutating.includes(manifest.verb) ||
    (enforcement.fix_commands ?? []).includes(manifest.command)
  );
}

function tierPhase(phase, manifest) {
  if (phase === "discover" && manifest.verb === "check") return "check_swarm";
  return phase;
}

/**
 * @returns {{ target: number, floor: number, ceiling: number, score: number|null, phase_class: string, tier: number|null, waves?: number[] }}
 */
export function resolveSwarmTargetDetail(phase, manifest, enforcement = null) {
  const enf = enforcement ?? readEnforcement();
  const sizing = loadSwarmSizing(enf);
  const phaseClass = getPhaseClass(phase, sizing);
  const tierKey = tierPhase(phase, manifest);

  let floor = resolveSwarmFloor(phase, manifest, sizing);
  if (phase === "discover" && manifest.verb === "check") {
    floor =
      sizing.floors.check_swarm ??
      sizing.floors.discover ??
      3;
  }

  const mutating = isMutating(manifest, enf);
  if (phase === "verify" && !mutating && manifest.verb === "test") {
    floor = sizing.floors.verify ?? 3;
  }
  if (phase === "review_swarm" && !mutating) {
    return {
      target: 0,
      floor: 0,
      ceiling: 0,
      score: null,
      phase_class: phaseClass,
      tier: null,
    };
  }
  if (phase === "execute" || phase === "test_execute") {
    if (!mutating && phase === "execute") {
      return { target: 0, floor: 0, ceiling: 0, score: null, phase_class: "fixed", tier: null };
    }
    const fixed = sizing.floors[phase] ?? 1;
    return {
      target: fixed,
      floor: fixed,
      ceiling: fixed,
      score: null,
      phase_class: "fixed",
      tier: fixed,
    };
  }

  const ceiling = resolveSwarmCeiling(phase, sizing);

  if (phaseClass === "fixed") {
    const fixed = sizing.floors[phase] ?? floor ?? 1;
    return {
      target: fixed,
      floor: fixed,
      ceiling: fixed,
      score: null,
      phase_class: phaseClass,
      tier: fixed,
    };
  }

  const complexity = manifest.complexity ?? {};
  let score = null;
  let tier = null;

  if (phaseClass === "scope_driven") {
    score = complexity.scope_score ?? 0;
    tier = tierLookup(sizing.scope_tiers?.[tierKey], score);
  } else if (phaseClass === "change_driven") {
    score = complexity.change_score ?? complexity.scope_score ?? 0;
    tier = tierLookup(sizing.change_tiers?.[phase], score);
  }

  let target = Math.max(floor, tier ?? floor);
  if (ceiling < 99) target = Math.min(target, ceiling);

  const commandOverride = sizing.command_overrides?.[manifest.command]?.[phase];
  if (typeof commandOverride === "number") {
    target = Math.max(target, commandOverride);
  }

  const waveResult = resolveSwarmWaves(target, { phase, manifest });
  return {
    target,
    floor,
    ceiling,
    score,
    phase_class: phaseClass,
    tier: tier ?? target,
    waves: waveResult.waves,
    wave_reason: waveResult.reason,
  };
}

/** Numeric target for enforcement (launch minimum). */
export function resolveSwarmTarget(phase, manifest, enforcement = null) {
  const detail = resolveSwarmTargetDetail(phase, manifest, enforcement);
  return detail.target > 0 ? detail.target : detail.floor > 0 ? detail.floor : null;
}

/** @deprecated use resolveSwarmTarget */
export function resolveSwarmMinimum(completedPhase, manifest, enforcement) {
  return resolveSwarmTarget(completedPhase, manifest, enforcement);
}

/**
 * Write resolved targets onto manifest for upcoming phases.
 * @param {string[]} phases
 */
export function applySwarmTargetsToManifest(manifest, phases, enforcement = null) {
  manifest.swarm = manifest.swarm ?? {};
  manifest.swarm.target_agents = manifest.swarm.target_agents ?? {};
  manifest.swarm.wave_plan = manifest.swarm.wave_plan ?? {};

  for (const phase of phases) {
    const detail = resolveSwarmTargetDetail(phase, manifest, enforcement);
    if (detail.target > 0) {
      manifest.swarm.target_agents[phase] = detail.target;
    }
    if (detail.waves?.length > 1) {
      manifest.swarm.wave_plan[phase] = {
        waves: detail.waves,
        reason: detail.wave_reason ?? "context_budget",
      };
    }
  }
  return manifest;
}
