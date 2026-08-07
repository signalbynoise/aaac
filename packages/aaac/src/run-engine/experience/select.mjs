/**
 * Lightweight: select experience priors for phase_context (read path).
 * Prefer importing this from prepare-phase-context — not the full process module.
 *
 * Always uses hybrid vector retrieval over packaged ∪ local lessons.
 * Packaged-index ships with npm so fresh installs retrieve out of the box.
 */
import {
  loadLessonsStore,
  loadExperienceStats,
  loadWorkspaceMemory,
  loadPackagedGlobalLessons,
  mergeLessonCorpora,
} from "./stores.mjs";
import { signatureKey } from "./stats.mjs";
import { DEFAULT_LESSON_CAP, DEFAULT_WARNING_CAP, loadRetrievalConfig } from "./paths.mjs";
import { retrieveExperience } from "./retrieve.mjs";
import { getEmbeddingProvider } from "./embed/provider.mjs";
import { seedLocalIndexFromPackaged } from "./index/seed.mjs";

export { mergeLessonCorpora };

function finishExperiencePacket(manifest, lessons, warnings, merged, stats, memory) {
  const key = signatureKey(manifest);
  const sig = stats.signatures?.[key] ?? null;
  const avoidPaths = [
    ...new Set(
      [
        ...lessons.flatMap((l) => merged[l.id]?.avoid_paths ?? []),
        ...(memory.prefs ?? []).flatMap((p) => p.avoid_paths ?? []),
      ].filter(Boolean),
    ),
  ];

  return {
    lessons,
    warnings: warnings ?? [],
    stats_prior: sig
      ? {
          signature: key,
          runs: sig.runs,
          success_rate:
            sig.runs > 0
              ? Math.round((sig.successes / sig.runs) * 1000) / 1000
              : null,
          avg_duration_ms: sig.avg_duration_ms,
          avg_tokens: sig.avg_tokens,
          avg_context_utilization: sig.avg_context_utilization,
        }
      : null,
    workspace_prefs: (memory.prefs ?? []).slice(0, 10).map((p) => ({
      id: p.id,
      text: p.text,
      avoid_paths: p.avoid_paths ?? [],
      evidence: p.evidence ?? null,
    })),
    context_hint: {
      recommended_focus_paths: [],
      avoid_paths: avoidPaths.slice(0, 20),
      historical_avg_tokens: sig?.avg_tokens ?? null,
      historical_success_rate:
        sig && sig.runs > 0
          ? Math.round((sig.successes / sig.runs) * 1000) / 1000
          : null,
    },
    retrieval: null,
  };
}

/**
 * Select top lessons for phase context (hybrid retrieval + compact evidence).
 * Async — await from prepare-phase-context.
 *
 * @param {object} manifest
 * @param {{ maxLessons?: number, maxWarnings?: number, provider?: object, ensureIndex?: boolean }} [options]
 */
export async function selectExperienceForContext(manifest, options = {}) {
  const cfg = loadRetrievalConfig();
  const maxLessons = options.maxLessons ?? DEFAULT_LESSON_CAP;
  const maxWarnings = options.maxWarnings ?? cfg.max_warnings ?? DEFAULT_WARNING_CAP;
  const packaged = loadPackagedGlobalLessons();
  const local = loadLessonsStore();
  const stats = loadExperienceStats();
  const memory = loadWorkspaceMemory();
  const merged = mergeLessonCorpora(packaged, local);

  seedLocalIndexFromPackaged();

  const provider = options.provider ?? getEmbeddingProvider(options);
  const avoidPaths = [
    ...new Set((memory.prefs ?? []).flatMap((p) => p.avoid_paths ?? [])),
  ];
  const retrieved = await retrieveExperience(merged, manifest, {
    maxLessons,
    maxWarnings,
    provider,
    avoidPaths,
    ensureIndex: options.ensureIndex !== false,
  });

  const packet = finishExperiencePacket(
    manifest,
    retrieved.lessons,
    retrieved.warnings,
    merged,
    stats,
    memory,
  );
  packet.retrieval = retrieved.meta;
  packet._feature_rows = retrieved.feature_rows;
  return packet;
}
