/**
 * V4 — Execution profiles: learned policy for how the swarm should work
 * inside a fixed AAAC graph (depth, budget, reuse, inspect priorities).
 */

import { isoNow, readJson, writeJson } from "../lib.mjs";
import { EXECUTION_PROFILES_PATH } from "./paths.mjs";
import { signatureKey } from "./stats.mjs";

export const DEPTH_PRESETS = {
  shallow: { context_budget: 8000, lessons: 2 },
  medium: { context_budget: 12000, lessons: 3 },
  deep: { context_budget: 16000, lessons: 5 },
};

export function emptyProfilesStore() {
  return {
    version: 1,
    updated_at: null,
    profiles: {},
    bandit: {}, // signature -> { profileId: { alpha, beta, pulls, reward_sum } }
  };
}

export function loadProfilesStore() {
  return readJson(EXECUTION_PROFILES_PATH, emptyProfilesStore());
}

export function saveProfilesStore(store) {
  store.updated_at = isoNow();
  writeJson(EXECUTION_PROFILES_PATH, store);
}

function profileId(signature, depth) {
  return `profile-${String(signature).replace(/\|/g, "-")}-${depth}`;
}

export function defaultProfileForSignature(signature, depth = "medium") {
  const preset = DEPTH_PRESETS[depth] ?? DEPTH_PRESETS.medium;
  return {
    id: profileId(signature, depth),
    task_signature: signature,
    strategy_id: `strategy-${String(signature).replace(/\|/g, "-")}`,
    depth,
    context_budget: preset.context_budget,
    reuse: {
      repo_map: true,
      module_summary: true,
      dependency_map: true,
    },
    inspect: {
      changed_files: depth === "shallow" ? "medium" : "high",
      public_api: "high",
      tests: depth === "deep" ? "high" : "medium",
      unrelated_modules: "low",
    },
    context: {
      strategy: true,
      repo_facts: "targeted",
      lessons: preset.lessons,
    },
    learned_from: { runs: 0 },
    expected: {
      quality: null,
      tokens: null,
      files_read: null,
    },
    created_at: isoNow(),
  };
}

/** Ensure shallow/medium/deep arms exist for a signature. */
export function ensureProfileArms(store, signature) {
  for (const depth of Object.keys(DEPTH_PRESETS)) {
    const id = profileId(signature, depth);
    if (!store.profiles[id]) {
      store.profiles[id] = defaultProfileForSignature(signature, depth);
    }
    store.bandit[signature] = store.bandit[signature] ?? {};
    if (!store.bandit[signature][id]) {
      store.bandit[signature][id] = {
        alpha: 1,
        beta: 1,
        pulls: 0,
        reward_sum: 0,
      };
    }
  }
  return store;
}

function sampleBeta(alpha, beta) {
  // Gamma ratio via Marsaglia-ish using sum of exponentials approximation
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

function sampleGamma(shape) {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Thompson sample a profile for this task signature.
 * Epsilon-greedy explore: 10% random arm.
 */
export function selectExecutionProfile(store, manifest, { epsilon = 0.1 } = {}) {
  const signature = signatureKey(manifest);
  ensureProfileArms(store, signature);
  const arms = store.bandit[signature] ?? {};
  const ids = Object.keys(arms);
  let chosenId;
  if (Math.random() < epsilon) {
    chosenId = ids[Math.floor(Math.random() * ids.length)];
  } else {
    let best = -1;
    chosenId = ids[0];
    for (const id of ids) {
      const a = arms[id];
      const sample = sampleBeta(a.alpha ?? 1, a.beta ?? 1);
      if (sample > best) {
        best = sample;
        chosenId = id;
      }
    }
  }
  const profile = store.profiles[chosenId];
  return {
    profile,
    env: profileToEnv(profile),
    signature,
  };
}

export function profileToEnv(profile) {
  if (!profile) return {};
  return {
    AAAC_FINAL_LESSONS: String(profile.context?.lessons ?? 3),
    AAAC_CONTEXT_BUDGET: String(profile.context_budget ?? 12000),
    AAAC_EXECUTION_PROFILE: profile.id,
    AAAC_EXECUTION_DEPTH: profile.depth ?? "medium",
  };
}

/**
 * Update profile bandit + expected stats from a run reward.
 * @param {number|null} reward — null means quality failed; treat as negative.
 */
export function updateExecutionProfile(store, profileId, {
  reward,
  trajectory = null,
}) {
  const profile = store.profiles[profileId];
  if (!profile) return store;
  const signature = profile.task_signature;
  ensureProfileArms(store, signature);
  const arm = store.bandit[signature][profileId];
  const r = reward == null ? -0.6 : reward;
  const successProb = (Math.max(-1, Math.min(1, r)) + 1) / 2;
  arm.alpha = (arm.alpha ?? 1) + successProb;
  arm.beta = (arm.beta ?? 1) + (1 - successProb);
  arm.pulls = (arm.pulls ?? 0) + 1;
  arm.reward_sum = (arm.reward_sum ?? 0) + r;
  arm.last_reward = r;
  arm.updated_at = isoNow();
  store.bandit[signature][profileId] = arm;

  profile.learned_from.runs = (profile.learned_from.runs ?? 0) + 1;
  if (trajectory?.quality?.ok) {
    profile.expected.quality = trajectory.quality.score;
    if (trajectory.tokens != null) {
      profile.expected.tokens = Math.round(
        ((profile.expected.tokens ?? trajectory.tokens) + trajectory.tokens) / 2,
      );
    }
    if (trajectory.files_read_total != null) {
      profile.expected.files_read = Math.round(
        ((profile.expected.files_read ?? trajectory.files_read_total) +
          trajectory.files_read_total) /
          2,
      );
    }
  }
  profile.updated_at = isoNow();
  store.profiles[profileId] = profile;
  return store;
}

/**
 * Binding inspect priorities for phase_context.execution
 */
export function bindingExecutionPacket(profile, strategyCard = null) {
  if (!profile) return null;
  const inspect = profile.inspect ?? {};
  const rank = { high: 0, medium: 1, low: 2 };
  const prioritize = Object.entries(inspect)
    .filter(([, v]) => v === "high" || v === "medium")
    .sort((a, b) => (rank[a[1]] ?? 9) - (rank[b[1]] ?? 9))
    .map(([k]) => k);
  const skip = Object.entries(inspect)
    .filter(([, v]) => v === "low")
    .map(([k]) => k);

  return {
    profile_id: profile.id,
    depth: profile.depth,
    context_budget: profile.context_budget,
    strategy_id: profile.strategy_id,
    reuse: profile.reuse ?? {},
    inspect: profile.inspect ?? {},
    prioritize,
    skip,
    usually_not_needed: strategyCard?.usually_not_needed ?? [],
    workflow: strategyCard?.workflow ?? [],
    instructions:
      "Honor execution.prioritize and execution.skip. Prefer reuse of repo_facts over rediscovery. Stay within context_budget bytes of injected experience. Do not expand into unrelated_modules when marked low.",
  };
}

/** Resolve active profile from env or select new. */
export function resolveActiveProfile(store, manifest) {
  const envId = process.env.AAAC_EXECUTION_PROFILE;
  if (envId && store.profiles[envId]) {
    return { profile: store.profiles[envId], from: "env" };
  }
  const { profile } = selectExecutionProfile(store, manifest, { epsilon: 0.15 });
  return { profile, from: "selected" };
}
