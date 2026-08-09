/**
 * V5 — Learned swarm graph policy (agent targets per signature).
 * Readonly verbs only; steps down below YAML floors with absolute safety mins.
 */
import { isoNow, readJson, writeJson } from "../lib.mjs";
import { GRAPH_POLICY_PATH } from "./paths.mjs";
import { signatureKey } from "./stats.mjs";

export const READONLY_VERBS = new Set(["review", "check"]);

/** Absolute safety mins — never go below these for required phases. */
export const SAFETY_FLOORS = {
  discover: 2,
  investigate_lite: 2,
  plan: 1,
  report: 1,
  validate: 2,
  impact_analysis: 1,
  dependency_graph: 1,
  fitness_functions: 2,
  rollback: 1,
  check_swarm: 2,
  investigate_swarm: 3,
  research_swarm: 3,
  verify: 2,
  review_swarm: 2,
  root_cause: 1,
};

/** Phases eligible for experience step-down on review/check paths. */
export const ELIGIBLE_PHASES = ["discover", "investigate_lite", "plan", "report"];

export const STREAK_TO_STEP = 3;

/** Default YAML floors used when caller does not supply them (review path). */
export const DEFAULT_YAML_FLOORS = {
  discover: 4,
  investigate_lite: 3,
  plan: 2,
  report: 2,
};

export function emptyGraphPolicyStore() {
  return {
    version: 1,
    updated_at: null,
    signatures: {},
  };
}

export function loadGraphPolicyStore() {
  return readJson(GRAPH_POLICY_PATH, emptyGraphPolicyStore());
}

export function saveGraphPolicyStore(store) {
  store.updated_at = isoNow();
  writeJson(GRAPH_POLICY_PATH, store);
}

export function isGraphLearningEnabled() {
  const v = process.env.AAAC_GRAPH_LEARNING;
  if (v == null || v === "") return true;
  return !/^(0|false|off|no)$/i.test(String(v));
}

export function isReadonlyVerb(manifest) {
  return READONLY_VERBS.has(String(manifest?.verb ?? ""));
}

export function safetyFloorFor(phase) {
  return SAFETY_FLOORS[phase] ?? 1;
}

/**
 * Clamp learned target into [safety, yamlFloor].
 * @param {number} learned
 * @param {number} safety
 * @param {number} yamlFloor
 */
export function clampLearnedTarget(learned, safety, yamlFloor) {
  const s = Math.max(1, Number(safety) || 1);
  const y = Math.max(s, Number(yamlFloor) || s);
  const n = Number(learned);
  if (!Number.isFinite(n)) return y;
  return Math.max(s, Math.min(y, Math.floor(n)));
}

function ensureSignature(store, key) {
  if (!store.signatures[key]) {
    store.signatures[key] = {
      streak_ok: 0,
      pulls: 0,
      last_quality_ok: null,
      phases: {},
      updated_at: isoNow(),
    };
  }
  return store.signatures[key];
}

function ensurePhase(sig, phase, yamlFloor) {
  const safety = safetyFloorFor(phase);
  const y = Math.max(safety, Number(yamlFloor) || DEFAULT_YAML_FLOORS[phase] || safety);
  if (!sig.phases[phase]) {
    sig.phases[phase] = {
      target: y,
      yaml_floor: y,
      safety_floor: safety,
    };
  } else {
    sig.phases[phase].yaml_floor = y;
    sig.phases[phase].safety_floor = safety;
    sig.phases[phase].target = clampLearnedTarget(
      sig.phases[phase].target,
      safety,
      y,
    );
  }
  return sig.phases[phase];
}

/**
 * @returns {Record<string, number>} phase → learned target
 */
export function selectGraphTargets(manifest, store = null) {
  if (!isGraphLearningEnabled() || !isReadonlyVerb(manifest)) return {};
  const s = store ?? loadGraphPolicyStore();
  const key = signatureKey(manifest);
  const sig = s.signatures?.[key];
  if (!sig?.phases) return {};
  const out = {};
  for (const [phase, entry] of Object.entries(sig.phases)) {
    if (entry?.target == null) continue;
    out[phase] = clampLearnedTarget(
      entry.target,
      entry.safety_floor ?? safetyFloorFor(phase),
      entry.yaml_floor ?? DEFAULT_YAML_FLOORS[phase] ?? entry.target,
    );
  }
  return out;
}

/**
 * Apply one quality outcome to the graph policy.
 * @returns {{ stepped_down: string[], stepped_up: string[], streak_ok: number }}
 */
export function updateGraphPolicyFromTrajectory(
  store,
  trajectory,
  manifest,
  { yamlFloors = DEFAULT_YAML_FLOORS } = {},
) {
  const result = { stepped_down: [], stepped_up: [], streak_ok: 0 };
  if (!isReadonlyVerb(manifest)) return result;

  const key = signatureKey(manifest);
  const sig = ensureSignature(store, key);
  sig.pulls = (sig.pulls ?? 0) + 1;
  const qualityOk = Boolean(trajectory?.quality?.ok);

  for (const phase of ELIGIBLE_PHASES) {
    const y =
      yamlFloors[phase] ?? DEFAULT_YAML_FLOORS[phase] ?? safetyFloorFor(phase);
    ensurePhase(sig, phase, y);
  }

  if (qualityOk) {
    sig.streak_ok = (sig.streak_ok ?? 0) + 1;
    sig.last_quality_ok = isoNow();
    if (sig.streak_ok >= STREAK_TO_STEP) {
      for (const phase of ELIGIBLE_PHASES) {
        const entry = sig.phases[phase];
        if (!entry) continue;
        const safety = entry.safety_floor ?? safetyFloorFor(phase);
        if (entry.target > safety) {
          entry.target -= 1;
          result.stepped_down.push(phase);
        }
      }
      sig.streak_ok = 0;
    }
  } else {
    sig.streak_ok = 0;
    sig.last_quality_ok = false;
    for (const phase of ELIGIBLE_PHASES) {
      const entry = sig.phases[phase];
      if (!entry) continue;
      const y = entry.yaml_floor ?? DEFAULT_YAML_FLOORS[phase] ?? entry.target;
      if (entry.target < y) {
        entry.target += 1;
        result.stepped_up.push(phase);
      }
    }
  }

  result.streak_ok = sig.streak_ok;
  sig.updated_at = isoNow();
  return result;
}

/**
 * Merge learned target into a resolved swarm detail.
 * @returns {{ target: number, applied: boolean, learned: number|null }}
 */
export function applyLearnedTargetToDetail(detail, phase, learnedTargets) {
  const learned = learnedTargets?.[phase];
  if (learned == null || !Number.isFinite(Number(learned))) {
    return { target: detail.target, applied: false, learned: null };
  }
  const safety = safetyFloorFor(phase);
  const yamlFloor = detail.floor > 0 ? detail.floor : safety;
  const next = clampLearnedTarget(learned, safety, yamlFloor);
  // Only apply when it reduces (or equals) cost vs baseline target
  const baseline = detail.target > 0 ? detail.target : yamlFloor;
  const target = Math.min(baseline, next);
  const clamped = Math.max(safety, target);
  return {
    target: clamped,
    applied: clamped !== baseline,
    learned: next,
  };
}
