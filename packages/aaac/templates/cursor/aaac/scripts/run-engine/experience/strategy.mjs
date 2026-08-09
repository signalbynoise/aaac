/**
 * V4 — Strategy objects: compressed procedural expertise for a task class.
 */

import { isoNow, readJson, writeJson } from "../lib.mjs";
import { STRATEGIES_PATH } from "./paths.mjs";
import { signatureKey } from "./stats.mjs";

export function emptyStrategiesStore() {
  return { version: 1, updated_at: null, strategies: {} };
}

export function loadStrategiesStore() {
  return readJson(STRATEGIES_PATH, emptyStrategiesStore());
}

export function saveStrategiesStore(store) {
  store.updated_at = isoNow();
  writeJson(STRATEGIES_PATH, store);
}

function median(nums) {
  const arr = nums.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

function strategyIdForSignature(signature) {
  return `strategy-${String(signature).replace(/\|/g, "-")}`;
}

/**
 * Derive workflow / skip hints from a successful trajectory.
 */
export function deriveStrategyDraft(trajectory, lessons = []) {
  const workflow = (trajectory.steps ?? [])
    .filter((s) => s.phase && !String(s.phase).endsWith("_swarm_target"))
    .map((s) => s.phase);

  const avoid = [
    ...new Set(
      lessons.flatMap((l) => l.avoid_paths ?? []).filter(Boolean),
    ),
  ].slice(0, 12);

  const usuallyNotNeeded = [
    "full_repo_scan",
    "unrelated_docs",
    "exhaustive_history",
    ...avoid.map((p) => `path:${p}`),
  ].slice(0, 16);

  return {
    workflow: workflow.length ? workflow : ["discover", "plan", "report"],
    required_context: ["task_intent", "module_scope"],
    usually_not_needed: usuallyNotNeeded,
  };
}

/**
 * Upsert strategy from a quality-ok trajectory (winner mining).
 */
export function upsertStrategyFromTrajectory(store, trajectory, {
  lessons = [],
  profileId = null,
} = {}) {
  if (!trajectory?.quality?.ok) {
    return { updated: false, reason: "quality_gate_failed" };
  }

  const signature = trajectory.signature ?? signatureKey({});
  const id = strategyIdForSignature(signature);
  const draft = deriveStrategyDraft(trajectory, lessons);
  const prev = store.strategies[id] ?? {
    id,
    task_signature: signature,
    applies_to: {
      task_type: signature.split("|")[0] ?? "unknown",
      object: signature.split("|")[1] ?? "_",
      domain: signature.split("|")[2] ?? "_",
    },
    workflow: draft.workflow,
    required_context: draft.required_context,
    usually_not_needed: draft.usually_not_needed,
    performance: {
      quality: [],
      tokens: [],
      duration_ms: [],
      files_read: [],
    },
    evidence: { runs: 0, winning_runs: 0 },
    confidence: 0,
    strategy_id_alias: null,
    profile_affinity: {},
    updated_at: null,
  };

  // Prefer shorter successful workflows when new traj is cheaper
  const prevP50 = prev.performance.tokens_p50;
  const isWinner =
    prevP50 == null ||
    (trajectory.tokens != null && trajectory.tokens <= prevP50);

  if (isWinner) {
    prev.workflow = draft.workflow;
    prev.required_context = draft.required_context;
    prev.usually_not_needed = [
      ...new Set([
        ...(prev.usually_not_needed ?? []),
        ...draft.usually_not_needed,
      ]),
    ].slice(0, 20);
    prev.evidence.winning_runs = (prev.evidence.winning_runs ?? 0) + 1;
  }

  prev.performance.quality = [...(prev.performance.quality ?? []), trajectory.quality.score].slice(-30);
  if (trajectory.tokens != null) {
    prev.performance.tokens = [...(prev.performance.tokens ?? []), trajectory.tokens].slice(-30);
  }
  if (trajectory.duration_ms != null) {
    prev.performance.duration_ms = [
      ...(prev.performance.duration_ms ?? []),
      trajectory.duration_ms,
    ].slice(-30);
  }
  if (trajectory.files_read_total != null) {
    prev.performance.files_read = [
      ...(prev.performance.files_read ?? []),
      trajectory.files_read_total,
    ].slice(-30);
  }

  prev.performance.quality_p50 = median(prev.performance.quality);
  prev.performance.tokens_p50 = median(prev.performance.tokens);
  prev.performance.duration_p50 = median(prev.performance.duration_ms);
  prev.performance.files_read_p50 = median(prev.performance.files_read);

  prev.evidence.runs = (prev.evidence.runs ?? 0) + 1;
  prev.confidence = Math.min(
    0.95,
    (prev.evidence.winning_runs + 1) / (prev.evidence.runs + 2),
  );
  if (profileId) {
    prev.profile_affinity[profileId] =
      (prev.profile_affinity[profileId] ?? 0) + 1;
  }
  prev.updated_at = isoNow();
  store.strategies[id] = prev;
  return { updated: true, strategy: prev, winner: isWinner };
}

export function getStrategyForManifest(store, manifest) {
  const key = signatureKey(manifest);
  return store.strategies[strategyIdForSignature(key)] ?? null;
}

/** Compact card for phase_context injection. */
export function compactStrategyCard(strategy) {
  if (!strategy) return null;
  return {
    id: strategy.id,
    task_signature: strategy.task_signature,
    workflow: strategy.workflow ?? [],
    required_context: strategy.required_context ?? [],
    usually_not_needed: (strategy.usually_not_needed ?? []).slice(0, 8),
    performance: {
      quality_p50: strategy.performance?.quality_p50 ?? null,
      tokens_p50: strategy.performance?.tokens_p50 ?? null,
      duration_p50: strategy.performance?.duration_p50 ?? null,
      files_read_p50: strategy.performance?.files_read_p50 ?? null,
    },
    evidence_runs: strategy.evidence?.runs ?? 0,
    confidence: strategy.confidence ?? 0,
  };
}
