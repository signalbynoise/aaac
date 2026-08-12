/**
 * Lightweight: select experience priors for phase_context (read path).
 * Prefer importing this from prepare-phase-context — not the full process module.
 *
 * V4: lessons + strategy + repo facts under an execution profile budget.
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
import {
  loadStrategiesStore,
  getStrategyForManifest,
  compactStrategyCard,
} from "./strategy.mjs";
import {
  loadRepoKnowledgeStore,
  selectRepoFacts,
  saveRepoKnowledgeStore,
} from "./repo-knowledge.mjs";
import {
  loadProfilesStore,
  resolveActiveProfile,
  bindingExecutionPacket,
  saveProfilesStore,
  profileToEnv,
} from "./execution-profile.mjs";
import { selectPriorArtifacts } from "./artifact-reuse.mjs";
import { selectGraphTargets } from "./graph-policy.mjs";
import { retrieveRepoMemory } from "./retrieve-repo.mjs";

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
    strategy: null,
    repo_facts: [],
    repo_memory: null,
    execution: null,
    context_bytes: 0,
    reuse_hits: 0,
  };
}

function estimateBytes(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj), "utf8");
  } catch {
    return 0;
  }
}

/**
 * Select top lessons + V4 strategy/repo/profile packet for phase context.
 *
 * @param {object} manifest
 * @param {{ maxLessons?: number, maxWarnings?: number, provider?: object, ensureIndex?: boolean, contextBudget?: number }} [options]
 */
export async function selectExperienceForContext(manifest, options = {}) {
  const profilesStore = loadProfilesStore();
  const { profile, from: profileSource } = resolveActiveProfile(
    profilesStore,
    manifest,
  );
  // Persist selection so process can attribute the run
  if (profileSource === "selected") {
    saveProfilesStore(profilesStore);
  }

  const cfg = loadRetrievalConfig();
  const profileLessonCap = profile?.context?.lessons;
  const maxLessons =
    options.maxLessons ??
    profileLessonCap ??
    cfg.final_lessons ??
    DEFAULT_LESSON_CAP;
  const maxWarnings = options.maxWarnings ?? cfg.max_warnings ?? DEFAULT_WARNING_CAP;
  const envBudget = Number(process.env.AAAC_CONTEXT_BUDGET);
  const contextBudget =
    options.contextBudget ??
    (Number.isFinite(envBudget) && envBudget > 0
      ? envBudget
      : profile?.context_budget ?? 12000);

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

  // Strategy card
  const strategies = loadStrategiesStore();
  const strategy = getStrategyForManifest(strategies, manifest);
  const strategyCard =
    profile?.context?.strategy !== false ? compactStrategyCard(strategy) : null;
  packet.strategy = strategyCard;

  // Repo facts under remaining budget
  const strategyBytes = strategyCard ? estimateBytes(strategyCard) : 0;
  const lessonsBytes = estimateBytes(packet.lessons);
  const remaining = Math.max(500, contextBudget - strategyBytes - lessonsBytes);
  const repoStore = loadRepoKnowledgeStore();
  const { facts, bytes, reuse_hits } = selectRepoFacts(repoStore, {
    budgetBytes: remaining,
    reuse: profile?.reuse ?? {},
    maxClaims: profile?.context?.repo_facts === "targeted" ? 6 : 3,
  });
  if (reuse_hits) saveRepoKnowledgeStore(repoStore);
  packet.repo_facts = facts;
  packet.reuse_hits = reuse_hits;

  // V6 — repository vector graph memory
  let repoMemory = null;
  try {
    repoMemory = await retrieveRepoMemory(manifest, {
      provider,
      emit: options.emitRepoEvents !== false,
      retrievalHints: options.retrievalHints ?? null,
    });
    packet.repo_memory = repoMemory;
    packet.context_hint.recommended_focus_paths = [
      ...(repoMemory.focus_paths ?? []),
    ].slice(0, 20);
    if (repoMemory.avoid_paths?.length) {
      packet.context_hint.avoid_paths = [
        ...new Set([
          ...(packet.context_hint.avoid_paths ?? []),
          ...repoMemory.avoid_paths,
        ]),
      ].slice(0, 20);
    }
    packet.context_bytes += estimateBytes(repoMemory);
  } catch {
    packet.repo_memory = {
      focus_paths: [],
      avoid_paths: [],
      nodes: [],
      invariants: [],
      edges: [],
      scratchpad_excerpt: "",
      impact: [],
      entry_flows: [],
      clusters: [],
      call_neighbors: [],
      focus_spans: [],
      read_pack: { spans: [], impact: [], call_neighbors: [], entry_flows: [] },
      meta: { empty: true, error: true },
    };
  }

  // V5 — hard artifact reuse + graph targets
  const prior = selectPriorArtifacts(manifest);
  packet.prior_artifacts = prior.prior_artifacts;
  packet.reuse_mode = prior.reuse_mode;
  packet.reuse_hits = (reuse_hits ?? 0) + (prior.reuse_hits ?? 0);
  packet.graph_targets = selectGraphTargets(manifest);

  // Binding execution profile
  packet.execution = bindingExecutionPacket(profile, strategyCard);
  packet.profile_id = profile?.id ?? null;
  packet.profile_env = profileToEnv(profile);
  packet.context_budget = contextBudget;
  packet.context_bytes = strategyBytes + lessonsBytes + bytes;

  // Merge strategy skips into context_hint
  if (strategyCard?.usually_not_needed?.length) {
    const pathSkips = strategyCard.usually_not_needed
      .filter((s) => String(s).startsWith("path:"))
      .map((s) => String(s).slice(5));
    packet.context_hint.avoid_paths = [
      ...new Set([...(packet.context_hint.avoid_paths ?? []), ...pathSkips]),
    ].slice(0, 20);
  }

  return packet;
}
