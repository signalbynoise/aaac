/**
 * Small numeric helpers for experience evidence.
 */

export function avg(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function pctImprovement(baseline, current) {
  if (baseline == null || baseline <= 0 || current == null) return null;
  return Math.round(((baseline - current) / baseline) * 1000) / 10;
}

export function rollingAvg(prev, next, n) {
  if (next == null) return prev ?? null;
  if (prev == null || n <= 0) return next;
  return (prev * n + next) / (n + 1);
}

export function deriveConfidence({
  observed_runs = 0,
  successful_runs = 0,
  contradicted_runs = 0,
} = {}) {
  const observed = Math.max(0, Number(observed_runs) || 0);
  const successful = Math.max(0, Number(successful_runs) || 0);
  const contradicted = Math.max(0, Number(contradicted_runs) || 0);
  if (observed === 0) return 0;
  const successRate = Math.min(1, successful / observed);
  const contradictionPenalty = Math.min(0.5, contradicted / observed);
  const sampleBoost = 1 - Math.exp(-observed / 20);
  const confidence = successRate * sampleBoost * (1 - contradictionPenalty);
  return Math.round(Math.max(0, Math.min(1, confidence)) * 1000) / 1000;
}
