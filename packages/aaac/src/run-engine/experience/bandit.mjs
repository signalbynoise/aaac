/**
 * Stage 5 — Contextual bandit over experience knobs (Thompson Sampling).
 *
 * Arms discretize:
 *   final_lessons ∈ {3,5,8}
 *   artifact_warning_ratio ∈ {0.60, 0.75, 0.90}  (relative to hard 16KB limit)
 *   mmr_lambda ∈ {0.4, 0.7, 0.9}
 */

import path from "path";
import { isoNow, readJson, writeJson, STATE_ROOT } from "../lib.mjs";

export const BANDIT_PATH = path.join(STATE_ROOT, "experience-bandit.json");
export const ARTIFACT_HARD_LIMIT = 16000;

export const ARM_GRID = {
  final_lessons: [3, 5, 8],
  artifact_warning_ratio: [0.6, 0.75, 0.9],
  mmr_lambda: [0.4, 0.7, 0.9],
};

function allArms() {
  const arms = [];
  for (const final_lessons of ARM_GRID.final_lessons) {
    for (const artifact_warning_ratio of ARM_GRID.artifact_warning_ratio) {
      for (const mmr_lambda of ARM_GRID.mmr_lambda) {
        arms.push({
          id: `fl${final_lessons}_aw${artifact_warning_ratio}_mmr${mmr_lambda}`,
          final_lessons,
          artifact_warning_ratio,
          mmr_lambda,
          artifact_char_warn: Math.floor(
            ARTIFACT_HARD_LIMIT * artifact_warning_ratio,
          ),
        });
      }
    }
  }
  return arms;
}

export function emptyBanditStore() {
  return {
    version: 1,
    updated_at: null,
    arms: Object.fromEntries(
      allArms().map((a) => [
        a.id,
        {
          ...a,
          alpha: 1,
          beta: 1,
          pulls: 0,
          reward_sum: 0,
        },
      ]),
    ),
  };
}

export function loadBanditStore() {
  return readJson(BANDIT_PATH, emptyBanditStore());
}

export function saveBanditStore(store) {
  store.updated_at = isoNow();
  writeJson(BANDIT_PATH, store);
}

/** Sample Beta(alpha, beta) via gamma ratio (Marsaglia-like simple method). */
function sampleBeta(alpha, beta) {
  // Johnk's algorithm for small a,b; fallback sum of exponentials via gamma
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

function sampleGamma(shape) {
  // Marsaglia and Tsang for shape >= 1; for shape < 1 boost
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
 * Thompson sample an arm. Optional contextKey reserved for future contextual priors.
 */
export function selectBanditArm(store = loadBanditStore(), _contextKey = "default") {
  let best = null;
  let bestSample = -1;
  for (const arm of Object.values(store.arms)) {
    const sample = sampleBeta(arm.alpha ?? 1, arm.beta ?? 1);
    if (sample > bestSample) {
      bestSample = sample;
      best = arm;
    }
  }
  return {
    arm: best,
    sample: bestSample,
    env: armToEnv(best),
  };
}

export function armToEnv(arm) {
  if (!arm) return {};
  return {
    AAAC_FINAL_LESSONS: String(arm.final_lessons),
    AAAC_MMR_LAMBDA: String(arm.mmr_lambda),
    AAAC_ARTIFACT_WARN_RATIO: String(arm.artifact_warning_ratio),
    AAAC_ARTIFACT_CHAR_WARN: String(arm.artifact_char_warn),
  };
}

/**
 * Update arm with reward in [-1, 1] (mapped to Bernoulli-ish success for Beta).
 */
export function updateBanditArm(store, armId, reward) {
  const arm = store.arms[armId];
  if (!arm) return store;
  const successProb = (Math.max(-1, Math.min(1, reward)) + 1) / 2;
  // Fractional Beta update
  arm.alpha = (arm.alpha ?? 1) + successProb;
  arm.beta = (arm.beta ?? 1) + (1 - successProb);
  arm.pulls = (arm.pulls ?? 0) + 1;
  arm.reward_sum = (arm.reward_sum ?? 0) + reward;
  arm.last_reward = reward;
  arm.updated_at = isoNow();
  store.arms[armId] = arm;
  return store;
}

export function banditSummary(store = loadBanditStore()) {
  const rows = Object.values(store.arms)
    .map((a) => ({
      id: a.id,
      pulls: a.pulls ?? 0,
      mean_reward:
        a.pulls > 0 ? Math.round((a.reward_sum / a.pulls) * 1000) / 1000 : null,
      alpha: a.alpha,
      beta: a.beta,
      final_lessons: a.final_lessons,
      artifact_char_warn: a.artifact_char_warn,
      mmr_lambda: a.mmr_lambda,
    }))
    .sort((a, b) => (b.mean_reward ?? -2) - (a.mean_reward ?? -2));
  return { arms: rows, updated_at: store.updated_at };
}
