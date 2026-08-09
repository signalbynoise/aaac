/**
 * Evidence-backed lesson candidates + upsert.
 */
import { isoNow } from "../lib.mjs";
import { deriveConfidence, rollingAvg } from "./math.mjs";

const AVOID_PATH_HINTS = [
  {
    id: "ignore-node-modules-planning",
    pattern: /node_modules/,
    lesson: "Ignore node_modules during planning",
    tags: ["planning", "context", "node"],
    avoid_paths: ["node_modules/"],
  },
  {
    id: "ignore-dist-build-planning",
    pattern: /\b(dist|build|\.next)\b/,
    lesson: "Ignore dist/, build/, and .next/ during planning",
    tags: ["planning", "context"],
    avoid_paths: ["dist/", "build/", ".next/"],
  },
  {
    id: "ignore-generated-coverage",
    pattern: /\b(coverage|generated)\b/,
    lesson: "Skip coverage/ and generated/ trees in discover/plan reads",
    tags: ["planning", "context"],
    avoid_paths: ["coverage/", "generated/"],
  },
];

export function slugifyLessonId(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Stable id — strip volatile % so evidence compounds across runs. */
export function stableBottleneckLessonId(phase) {
  if (!phase) return null;
  return `lesson-bottleneck-${slugifyLessonId(phase)}`;
}

export function emptyEvidence() {
  return {
    observed_runs: 0,
    successful_runs: 0,
    failed_runs: 0,
    contradicted_runs: 0,
    token_savings_pct: null,
    average_runtime_improvement_pct: null,
    confidence: 0,
    last_run_id: null,
    updated_at: null,
  };
}

export function candidateLessonsFromRun(manifest, reflection, outcome) {
  const candidates = [];
  const intent = String(manifest.intent ?? "");
  const blob = [
    intent,
    reflection.reusable_lesson,
    reflection.recommendation,
    reflection.biggest_waste,
    JSON.stringify(manifest.artifacts ?? {}),
  ].join(" ");

  for (const hint of AVOID_PATH_HINTS) {
    if (hint.pattern.test(blob) || hint.pattern.test(intent)) {
      candidates.push({
        id: hint.id,
        lesson: hint.lesson,
        problem: "Planner/discover may read generated or dependency trees",
        solution: hint.lesson,
        tags: hint.tags,
        scope: "global",
        avoid_paths: hint.avoid_paths,
      });
    }
  }

  if (reflection.reusable_lesson) {
    const stableId =
      stableBottleneckLessonId(reflection.bottleneck_phase) ??
      `lesson-${slugifyLessonId(reflection.reusable_lesson)}`;
    candidates.push({
      id: stableId,
      lesson: reflection.reusable_lesson,
      problem: reflection.largest_bottleneck
        ? `Bottleneck: ${reflection.largest_bottleneck}`
        : null,
      solution: reflection.recommendation,
      tags: [manifest.verb, manifest.object, "runtime"].filter(Boolean),
      scope: "project",
    });
  }

  if (
    reflection.recommendation &&
    reflection.recommendation !== reflection.reusable_lesson
  ) {
    candidates.push({
      id: `rec-${slugifyLessonId(reflection.recommendation)}`,
      lesson: reflection.recommendation,
      problem: outcome.status === "failure" ? "Run did not complete cleanly" : null,
      solution: reflection.recommendation,
      tags: [manifest.verb, "recommendation"].filter(Boolean),
      scope: "project",
    });
  }

  const byId = new Map();
  for (const c of candidates) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()];
}

export function upsertLessonWithEvidence(
  store,
  candidate,
  {
    runId,
    outcome,
    tokenSavingsPct,
    runtimeImprovementPct,
    contradicted = false,
  },
) {
  const existing = store.lessons[candidate.id] ?? {
    id: candidate.id,
    lesson: candidate.lesson,
    problem: candidate.problem ?? null,
    solution: candidate.solution ?? null,
    tags: candidate.tags ?? [],
    scope: candidate.scope ?? "project",
    status: "active",
    evidence: emptyEvidence(),
    supporting_run_ids: [],
    avoid_paths: candidate.avoid_paths ?? [],
  };

  // Revive if previously deprecated but seen again with structure.
  if (existing.status === "deprecated" && candidate.kind === "structured") {
    existing.status = "active";
    delete existing.deprecated_reason;
    delete existing.deprecated_at;
  }

  existing.lesson = candidate.lesson ?? existing.lesson;
  existing.problem = candidate.problem ?? existing.problem;
  existing.solution = candidate.solution ?? existing.solution;
  existing.tags = [...new Set([...(existing.tags ?? []), ...(candidate.tags ?? [])])];
  existing.scope = candidate.scope ?? existing.scope;
  if (candidate.avoid_paths?.length) {
    existing.avoid_paths = [
      ...new Set([...(existing.avoid_paths ?? []), ...candidate.avoid_paths]),
    ];
  }
  // Structured lesson fields (condition → action → expected_effect).
  for (const field of [
    "kind",
    "failure_class",
    "context",
    "condition",
    "action",
    "expected_effect",
    "appliesWhen",
    "promotion_stage",
  ]) {
    if (candidate[field] != null) existing[field] = candidate[field];
  }
  if (existing.condition && existing.action && existing.expected_effect) {
    existing.kind = existing.kind ?? "structured";
    existing.lesson =
      existing.lesson ||
      `${existing.action} (${existing.expected_effect})`;
  }

  const evidence = { ...emptyEvidence(), ...(existing.evidence ?? {}) };
  evidence.observed_runs += 1;
  if (outcome.status === "success") evidence.successful_runs += 1;
  if (outcome.status === "failure") evidence.failed_runs += 1;
  if (contradicted) evidence.contradicted_runs += 1;

  const n = evidence.observed_runs;
  evidence.token_savings_pct =
    tokenSavingsPct == null
      ? evidence.token_savings_pct
      : rollingAvg(evidence.token_savings_pct, tokenSavingsPct, n - 1);
  evidence.average_runtime_improvement_pct =
    runtimeImprovementPct == null
      ? evidence.average_runtime_improvement_pct
      : rollingAvg(
          evidence.average_runtime_improvement_pct,
          runtimeImprovementPct,
          n - 1,
        );

  evidence.confidence = deriveConfidence(evidence);
  evidence.last_run_id = runId;
  evidence.updated_at = isoNow();
  existing.evidence = evidence;

  const ids = existing.supporting_run_ids ?? [];
  if (!ids.includes(runId)) {
    ids.push(runId);
    existing.supporting_run_ids = ids.slice(-50);
  }

  store.lessons[candidate.id] = existing;
  return existing;
}
