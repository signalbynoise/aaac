/**
 * Stage 4 — Contextual lesson utility.
 * Tracks whether an exposed lesson helped / harmed for a task signature.
 */

import { isoNow } from "../lib.mjs";
import { signatureKey } from "./stats.mjs";

export function emptyContextUtility() {
  return {
    exposures: 0,
    helped: 0,
    harmed: 0,
    adhered: 0,
    ignored: 0,
    reward_sum: 0,
    updated_at: null,
  };
}

/**
 * Scalar reward in [-1, 1] from run outcome metrics.
 * V4: quality gate first — when qualityOk is false, return negative
 * without rewarding cheap failures. files_read feeds efficiency when present.
 */
export function computeRunReward({
  success,
  tokens = null,
  baselineTokens = null,
  durationMs = null,
  baselineDurationMs = null,
  gateFails = 0,
  filesRead = null,
  baselineFilesRead = null,
  qualityOk = null,
}) {
  if (qualityOk === false) {
    return Math.max(-1, Math.min(-0.4, -0.5 - Math.min(0.4, gateFails * 0.2)));
  }
  let reward = success ? 0.5 : -0.5;
  if (baselineTokens && tokens != null && baselineTokens > 0) {
    const tokenGain = (baselineTokens - tokens) / baselineTokens;
    reward += Math.max(-0.3, Math.min(0.3, tokenGain));
  }
  if (baselineDurationMs && durationMs != null && baselineDurationMs > 0) {
    const timeGain = (baselineDurationMs - durationMs) / baselineDurationMs;
    reward += Math.max(-0.2, Math.min(0.2, timeGain));
  }
  if (baselineFilesRead && filesRead != null && baselineFilesRead > 0) {
    const fileGain = (baselineFilesRead - filesRead) / baselineFilesRead;
    reward += Math.max(-0.2, Math.min(0.2, fileGain));
  }
  reward -= Math.min(0.4, gateFails * 0.2);
  return Math.max(-1, Math.min(1, Math.round(reward * 1000) / 1000));
}

/**
 * Update utility_by_context on lessons from a learning-funnel report + outcome.
 */
export function updateLessonUtilities(lessonsStore, {
  manifest,
  funnel,
  reward,
}) {
  const key = signatureKey(manifest);
  const updated = [];
  if (!funnel?.lessons?.length) return updated;

  for (const credit of funnel.lessons) {
    if (!credit.exposed) continue;
    const lesson = lessonsStore.lessons?.[credit.lesson_id];
    if (!lesson || lesson.status === "deprecated") continue;

    lesson.utility_by_context = lesson.utility_by_context ?? {};
    const ctx = {
      ...emptyContextUtility(),
      ...(lesson.utility_by_context[key] ?? {}),
    };
    ctx.exposures += 1;
    if (credit.followed === true) ctx.adhered += 1;
    if (credit.followed === false) ctx.ignored += 1;
    if (credit.effective === true) ctx.helped += 1;
    if (credit.effective === false || (!funnel.outcome?.success && credit.followed)) {
      ctx.harmed += 1;
    }
    ctx.reward_sum += reward;
    ctx.updated_at = isoNow();
    lesson.utility_by_context[key] = ctx;
    lessonsStore.lessons[lesson.id] = lesson;
    updated.push(lesson.id);
  }
  return updated;
}

/**
 * Expected contextual utility in [0, 1] for ranking.
 */
export function contextualUtilityScore(lesson, manifest) {
  const key = signatureKey(manifest);
  const ctx = lesson.utility_by_context?.[key];
  if (!ctx || ctx.exposures < 1) {
    // mild prior from global evidence
    const succ = lesson.evidence?.successful_runs ?? 0;
    const fail = lesson.evidence?.failed_runs ?? 0;
    return (succ + 1) / (succ + fail + 2);
  }
  const helped = ctx.helped ?? 0;
  const harmed = ctx.harmed ?? 0;
  const exposures = Math.max(1, ctx.exposures ?? 1);
  const meanReward = (ctx.reward_sum ?? 0) / exposures;
  const helpRate = (helped + 1) / (helped + harmed + 2);
  // blend help rate with mean reward mapped to [0,1]
  const reward01 = (meanReward + 1) / 2;
  return Math.max(0, Math.min(1, 0.6 * helpRate + 0.4 * reward01));
}
