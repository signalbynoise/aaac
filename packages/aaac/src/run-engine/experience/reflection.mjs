/**
 * Deterministic reflection from run metrics (no LLM).
 */
import { deriveConfidence, pctImprovement } from "./math.mjs";

export function extractPhaseBottleneck(manifest) {
  const phaseMetrics = manifest.phase_metrics ?? {};
  let worst = null;
  for (const [phase, metrics] of Object.entries(phaseMetrics)) {
    const duration = metrics?.duration_ms ?? metrics?.durationMs ?? null;
    if (duration == null) continue;
    if (!worst || duration > worst.duration_ms) {
      worst = { phase, duration_ms: duration };
    }
  }
  return worst;
}

export function buildReflection(manifest, outcome, statsPrior) {
  const metrics = manifest.metrics ?? {};
  const bottleneck = extractPhaseBottleneck(manifest);
  const totalDuration = metrics.duration_ms ?? null;
  const totalTokens = metrics.total_tokens ?? metrics.conversation_tokens ?? null;
  const utilization =
    manifest.context?.phases?.[manifest.phase]?.estimated_utilization ??
    manifest.swarm?.estimated_utilization ??
    null;

  const tokenDelta = pctImprovement(statsPrior?.avg_tokens, totalTokens);
  const runtimeDelta = pctImprovement(statsPrior?.avg_duration_ms, totalDuration);

  let biggestWaste = null;
  if (utilization != null && utilization > 0.35) {
    biggestWaste = `Estimated context utilization ${(utilization * 100).toFixed(0)}% — tighten artifact handoffs`;
  } else if (tokenDelta != null && tokenDelta < -15) {
    biggestWaste = `Token use ${Math.abs(tokenDelta)}% above signature baseline`;
  }

  const artifactKeys = Object.keys(manifest.artifacts ?? {});
  const mostValuable = artifactKeys.includes("report")
    ? "report"
    : artifactKeys.includes("plan")
      ? "plan"
      : artifactKeys[0] ?? null;

  const pct =
    bottleneck && totalDuration
      ? Math.round((bottleneck.duration_ms / totalDuration) * 100)
      : null;

  const reusableLesson =
    bottleneck && pct != null
      ? `Largest bottleneck was ${bottleneck.phase} (${pct}% of runtime)`
      : outcome.status === "success"
        ? "Repeat successful phase order and keep artifact-first handoffs"
        : "Capture failure signals before retrying execute";

  const recommendation =
    outcome.status === "failure"
      ? "Investigate gate/verify failures before expanding swarm size"
      : bottleneck
        ? `Optimize ${bottleneck.phase} (wave split or narrower agent scopes)`
        : "Preserve current workflow; record context exclusions that saved tokens";

  const confidence = deriveConfidence({
    observed_runs: (statsPrior?.runs ?? 0) + 1,
    successful_runs:
      (statsPrior?.successes ?? 0) + (outcome.status === "success" ? 1 : 0),
    contradicted_runs: statsPrior?.failures ?? 0,
  });

  return {
    goal_achieved: outcome.status === "success",
    outcome_status: outcome.status,
    largest_bottleneck: bottleneck
      ? `${bottleneck.phase} (${bottleneck.duration_ms}ms)`
      : null,
    bottleneck_phase: bottleneck?.phase ?? null,
    biggest_waste: biggestWaste,
    most_valuable_artifact: mostValuable,
    reusable_lesson: reusableLesson,
    recommendation,
    confidence,
    metrics_snapshot: {
      duration_ms: totalDuration,
      total_tokens: totalTokens,
      phase_count: metrics.phase_count ?? (manifest.completed ?? []).length,
      token_vs_baseline_pct: tokenDelta,
      runtime_vs_baseline_pct: runtimeDelta,
    },
  };
}
