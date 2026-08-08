/**
 * Hot-path hybrid retrieval: dense + sparse → RRF → expand → rank → MMR.
 */
import { getEmbeddingProvider } from "./embed/provider.mjs";
import { buildTaskDocument } from "./task-document.mjs";
import { loadRetrievalConfig } from "./paths.mjs";
import { openIndexStore } from "./index/store.mjs";
import { getVectorIndex } from "./index/hnsw.mjs";
import { buildSparseIndex } from "./index/sparse.mjs";
import { upsertLessonsIntoIndex } from "./index/build.mjs";
import { seedLocalIndexFromPackaged } from "./index/seed.mjs";
import { buildFeatures, scoreCandidate } from "./rank.mjs";
import { selectMmr } from "./mmr.mjs";
import { resolveContradictions, evaluateApplicability } from "./contradiction.mjs";

function rrfFuse(rankLists, k = 60) {
  const scores = new Map();
  for (const list of rankLists) {
    list.forEach((lessonId, rank) => {
      const add = 1 / (k + rank + 1);
      scores.set(lessonId, (scores.get(lessonId) ?? 0) + add);
    });
  }
  return [...scores.entries()]
    .map(([lessonId, score]) => ({ lessonId, score }))
    .sort((a, b) => b.score - a.score);
}

function reasonFor(lesson, features, denseHit, sparseHit) {
  const bits = [];
  if (denseHit) bits.push("semantic match");
  if (sparseHit) bits.push("lexical match");
  if ((features.structural_match ?? 0) > 0.5) bits.push("command/phase fit");
  if ((features.outcome_value ?? 0) > 0.6) bits.push("proven outcomes");
  if (!bits.length) bits.push("related experience");
  return bits.join("; ");
}

/**
 * @param {Record<string, object>} lessons
 * @param {object} manifest
 * @param {{
 *   maxLessons?: number,
 *   maxWarnings?: number,
 *   provider?: object,
 *   avoidPaths?: string[],
 *   ensureIndex?: boolean,
 * }} [options]
 */
export async function retrieveExperience(lessons, manifest, options = {}) {
  const cfg = loadRetrievalConfig();
  const maxLessons = options.maxLessons ?? cfg.final_lessons;
  const maxWarnings = options.maxWarnings ?? cfg.max_warnings;
  const provider = options.provider ?? getEmbeddingProvider(options);
  const started = Date.now();

  const activeLessons = Object.fromEntries(
    Object.entries(lessons).filter(([, l]) => l?.evidence && (!l.status || l.status === "active")),
  );

  if (!Object.keys(activeLessons).length) {
    return {
      lessons: [],
      warnings: [],
      meta: { provider: provider.id, candidates: 0, latency_ms: 0, mode: "empty" },
      feature_rows: [],
    };
  }

  const seed = seedLocalIndexFromPackaged();

  // Ensure index has vectors for all active lessons (hash-skip when unchanged).
  // Fresh installs already have packaged vectors; this only embeds new local lessons.
  if (options.ensureIndex !== false) {
    await upsertLessonsIntoIndex(activeLessons, { provider });
  }

  const hints = {
    avoidPaths: options.avoidPaths ?? [],
    recentFailures: options.recentFailures ?? [],
  };
  const { text: taskText } = buildTaskDocument(manifest, hints);
  const [queryVec] = await provider.embed([taskText]);

  const index = getVectorIndex({ dims: provider.dims });
  const denseHits = index.search(queryVec, cfg.semantic_candidates);
  const denseByLesson = new Map();
  for (const hit of denseHits) {
    const prev = denseByLesson.get(hit.lessonId) ?? {
      meaning: 0,
      trigger: 0,
      failure: 0,
      remedy: 0,
      best: 0,
    };
    if (hit.slot in prev) prev[hit.slot] = Math.max(prev[hit.slot], hit.score);
    prev.best = Math.max(prev.best, hit.score);
    denseByLesson.set(hit.lessonId, prev);
  }

  const sparse = buildSparseIndex(activeLessons);
  const sparseHits = sparse.search(taskText, cfg.lexical_candidates);
  const sparseIds = new Set(sparseHits.map((h) => h.lessonId));

  const denseRank = [...denseByLesson.entries()]
    .sort((a, b) => b[1].best - a[1].best)
    .map(([id]) => id);
  const sparseRank = sparseHits.map((h) => h.lessonId);
  const fused = rrfFuse([denseRank, sparseRank], cfg.rrf_k);

  // Graph expansion (1 hop)
  const store = openIndexStore();
  let edges = [];
  try {
    edges = store.getEdges();
    const seedIds = fused.slice(0, cfg.semantic_candidates).map((f) => f.lessonId);
    const expanded = new Map(fused.map((f) => [f.lessonId, f.score]));
    for (const seed of seedIds) {
      const neigh = store.getEdges(seed).slice(0, cfg.max_neighbours_per_seed);
      for (const e of neigh) {
        if (!activeLessons[e.dst_id]) continue;
        const boost = 0.15 * (e.weight ?? 1);
        expanded.set(e.dst_id, (expanded.get(e.dst_id) ?? 0) + boost);
      }
    }
    fused.length = 0;
    fused.push(
      ...[...expanded.entries()]
        .map(([lessonId, score]) => ({ lessonId, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, cfg.rerank_limit),
    );
  } finally {
    store.close();
  }

  const candidates = [];
  const featureRows = [];
  for (const { lessonId, score: rrfScore } of fused) {
    const lesson = activeLessons[lessonId];
    if (!lesson) continue;
    const dense = denseByLesson.get(lessonId) ?? {
      meaning: 0,
      trigger: 0,
      failure: 0,
      remedy: 0,
      best: 0,
    };
    const edgeSupport = edges
      .filter((e) => e.src_id === lessonId || e.dst_id === lessonId)
      .reduce((s, e) => s + (e.weight ?? 0), 0);
    const features = buildFeatures({
      lesson,
      manifest,
      semanticSimilarity: dense.meaning || dense.best,
      triggerSimilarity: dense.trigger,
      graphSupport: Math.min(1, edgeSupport / 4),
      contradictionPenalty: 0,
    });
    const score = scoreCandidate(features) + 0.05 * rrfScore;
    const meaningVector = index.getVector(lessonId, "meaning");
    candidates.push({
      lessonId,
      lesson,
      score,
      features,
      meaningVector,
      denseHit: denseByLesson.has(lessonId),
      sparseHit: sparseIds.has(lessonId),
    });
    featureRows.push({
      lesson_id: lessonId,
      queryFeatures: features,
      rrf_score: rrfScore,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const { penalty, warnings: contradictWarnings } = resolveContradictions(
    candidates,
    edges,
    manifest,
  );
  for (const c of candidates) {
    const p = penalty.get(c.lessonId) ?? 0;
    if (p) {
      c.features.contradiction_penalty = p;
      c.score = scoreCandidate(c.features);
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const mmrSelected = selectMmr(candidates, maxLessons, cfg.mmr_lambda);
  const warnings = contradictWarnings.slice(0, maxWarnings);

  const lessonsOut = mmrSelected.map((c) => {
    const appl = evaluateApplicability(c.lesson, manifest);
    return {
      id: c.lesson.id,
      lesson: c.lesson.lesson,
      solution: c.lesson.solution ?? null,
      reason: reasonFor(c.lesson, c.features, c.denseHit, c.sparseHit),
      scope:
        (c.lesson.appliesWhen ?? [])[0] ||
        (c.lesson.tags ?? []).slice(0, 2).join("/") ||
        c.lesson.scope ||
        "general",
      source: c.lesson.source ?? "local",
      evidence: {
        observed_runs: c.lesson.evidence.observed_runs,
        successful_runs: c.lesson.evidence.successful_runs,
        token_savings_pct: c.lesson.evidence.token_savings_pct,
        average_runtime_improvement_pct:
          c.lesson.evidence.average_runtime_improvement_pct,
        confidence: c.lesson.evidence.confidence,
      },
      _score: c.score,
      _applies: appl.applies,
    };
  });

  return {
    lessons: lessonsOut.map(({ _score, _applies, ...card }) => card),
    warnings,
    meta: {
      provider: provider.id,
      model: provider.model,
      candidates: candidates.length,
      dense: denseHits.length,
      sparse: sparseHits.length,
      latency_ms: Date.now() - started,
      mode: "hybrid",
      seeded_from_packaged: seed.seeded,
      seed_reason: seed.reason,
    },
    feature_rows: featureRows.slice(0, cfg.rerank_limit),
  };
}

/**
 * Reciprocal rank fusion helper (exported for tests).
 */
export function reciprocalRankFusion(rankLists, k = 60) {
  return rrfFuse(rankLists, k);
}
