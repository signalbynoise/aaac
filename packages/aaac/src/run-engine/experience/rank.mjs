/**
 * Outcome-aware weighted feature ranking (+ contextual utility, Stage 4).
 */
import { loadRetrievalConfig } from "./paths.mjs";
import { contextualUtilityScore } from "./utility.mjs";

export function bayesianUtility(evidence, alpha = 1, beta = 1) {
  const successes = evidence?.successful_runs ?? 0;
  const failures = evidence?.failed_runs ?? 0;
  return (successes + alpha) / (successes + failures + alpha + beta);
}

export function structuralMatch(lesson, manifest) {
  const tags = new Set(lesson.tags ?? []);
  let score = 0;
  let parts = 0;
  const checks = [
    [manifest.verb, 1],
    [manifest.object, 1],
    [manifest.phase, 0.8],
    [manifest.domain, 0.6],
  ];
  for (const [value, weight] of checks) {
    if (!value) continue;
    parts += weight;
    if (tags.has(value) || String(lesson.lesson ?? "").toLowerCase().includes(String(value).toLowerCase())) {
      score += weight;
    }
  }
  return parts ? score / parts : 0;
}

export function repositoryAffinity(lesson, manifest) {
  const domain = String(manifest.domain ?? "").toLowerCase();
  const tags = (lesson.tags ?? []).map((t) => String(t).toLowerCase());
  const text = `${lesson.lesson} ${lesson.problem} ${lesson.solution}`.toLowerCase();
  if (!domain) {
    return lesson.scope === "global" ? 0.35 : 0.55;
  }
  if (tags.includes(domain.toLowerCase()) || text.includes(domain.toLowerCase())) {
    return 1.0;
  }
  if (lesson.scope === "project") return 0.9;
  if (lesson.scope === "global") return 0.35;
  return 0.55;
}

export function recencyScore(lesson, halfLifeDays = 730) {
  const updated = lesson.evidence?.updated_at;
  if (!updated) return 0.5;
  const ageMs = Date.now() - Date.parse(updated);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.5;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / halfLifeDays);
}

export function failurePenalty(lesson) {
  const ev = lesson.evidence ?? {};
  const observed = Math.max(1, ev.observed_runs ?? 1);
  const failed = (ev.failed_runs ?? 0) + (ev.contradicted_runs ?? 0);
  return Math.min(1, failed / observed);
}

/**
 * @param {object} features
 * @param {object} [weights]
 */
export function scoreCandidate(features, weights) {
  const w = weights ?? loadRetrievalConfig().ranking;
  const contextualW = w.contextual_utility ?? 0.22;
  return (
    w.semantic_similarity * (features.semantic_similarity ?? 0) +
    w.trigger_similarity * (features.trigger_similarity ?? 0) +
    w.structural_match * (features.structural_match ?? 0) +
    w.outcome_value * (features.outcome_value ?? 0) +
    w.repository_affinity * (features.repository_affinity ?? 0) +
    w.recency * (features.recency ?? 0) +
    w.graph_support * (features.graph_support ?? 0) +
    contextualW * (features.contextual_utility ?? 0) -
    w.contradiction_penalty * (features.contradiction_penalty ?? 0) -
    w.failure_penalty * (features.failure_penalty ?? 0) -
    w.redundancy_penalty * (features.redundancy_penalty ?? 0)
  );
}

/**
 * Build feature vector for a lesson candidate.
 */
export function buildFeatures({
  lesson,
  manifest,
  semanticSimilarity = 0,
  triggerSimilarity = 0,
  graphSupport = 0,
  contradictionPenalty = 0,
  redundancyPenalty = 0,
}) {
  const cfg = loadRetrievalConfig();
  return {
    semantic_similarity: semanticSimilarity,
    trigger_similarity: triggerSimilarity,
    structural_match: structuralMatch(lesson, manifest),
    outcome_value: bayesianUtility(
      lesson.evidence,
      cfg.ranking.bayes_alpha,
      cfg.ranking.bayes_beta,
    ),
    repository_affinity: repositoryAffinity(lesson, manifest),
    recency: recencyScore(lesson, cfg.ranking.recency_half_life_days),
    graph_support: Math.min(1, graphSupport),
    contextual_utility: contextualUtilityScore(lesson, manifest),
    contradiction_penalty: contradictionPenalty,
    failure_penalty: failurePenalty(lesson),
    redundancy_penalty: redundancyPenalty,
  };
}
