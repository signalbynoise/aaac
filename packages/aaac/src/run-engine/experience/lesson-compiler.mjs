/**
 * Compile structured lessons: condition → action → expected_effect.
 * Prefer failure-derived lessons over generic bottleneck prose.
 */

import { FAILURE_CLASSES } from "./failures.mjs";
import { slugifyLessonId } from "./lessons.mjs";

function artifactBase(artifactPath) {
  if (!artifactPath) return "artifact";
  return String(artifactPath).replace(/^artifacts\//, "");
}

function warningRatioHint(limit) {
  const soft = Math.floor((limit ?? 16000) * 0.75);
  return soft;
}

/**
 * @param {object} failure
 * @param {object} manifest
 * @returns {object|null}
 */
export function compileLessonFromFailure(failure, manifest) {
  if (!failure?.class) return null;

  if (failure.class === FAILURE_CLASSES.ARTIFACT_TOO_LARGE) {
    const name = artifactBase(failure.artifact) || "plan.yaml";
    const phase =
      failure.phase ||
      (name.startsWith("plan")
        ? "plan"
        : name.startsWith("report")
          ? "report"
          : "discover");
    const limit = failure.limit ?? 16000;
    const soft = warningRatioHint(limit);
    const id = `failure-artifact-too-large-${slugifyLessonId(name)}`;

    const condition = `${phase} phase producing ${name}`;
    const action =
      `Keep ${name} under ${limit} bytes (soft target ${soft}). ` +
      `Move nonessential analysis to referenced artifacts; write only decisions, scope, and pointers in ${name}.`;
    const expected_effect =
      `${name} bytes <= ${limit}; no context_budget_exceeded on ${name}`;

    return {
      id,
      kind: "structured",
      promotion_stage: "candidate",
      failure_class: FAILURE_CLASSES.ARTIFACT_TOO_LARGE,
      context: {
        phase,
        artifact: name,
        verb: manifest.verb ?? null,
        object: manifest.object ?? null,
        command: manifest.command ?? null,
      },
      condition,
      action,
      expected_effect,
      lesson: `${action} (${expected_effect})`,
      problem: `${name} exceeded artifact budget (${failure.bytes ?? "unknown"} > ${limit})`,
      solution: action,
      tags: [
        manifest.verb,
        manifest.object,
        "artifact-budget",
        phase,
        FAILURE_CLASSES.ARTIFACT_TOO_LARGE,
      ].filter(Boolean),
      scope: "project",
      appliesWhen: [
        `verb=${manifest.verb ?? "*"}`,
        `phase=${phase}`,
        `artifact=${name}`,
      ],
    };
  }

  if (failure.class === FAILURE_CLASSES.GATE_FAIL) {
    const phase = failure.phase ?? manifest.phase ?? "unknown";
    const id = `failure-gate-${slugifyLessonId(phase)}-${slugifyLessonId(
      (failure.detail ?? "gate").slice(0, 40),
    )}`;
    const condition = `gate check during ${phase}`;
    const action =
      `Before advancing past ${phase}, verify gate inputs meet thresholds; ` +
      `shrink oversized artifacts and re-run the gate rather than expanding swarm size.`;
    const expected_effect = `no gate_fail in ${phase}`;
    return {
      id,
      kind: "structured",
      promotion_stage: "candidate",
      failure_class: FAILURE_CLASSES.GATE_FAIL,
      context: {
        phase,
        verb: manifest.verb ?? null,
        object: manifest.object ?? null,
      },
      condition,
      action,
      expected_effect,
      lesson: action,
      problem: failure.detail ?? `Gate failed in ${phase}`,
      solution: action,
      tags: [manifest.verb, "gate", phase].filter(Boolean),
      scope: "project",
      appliesWhen: [`phase=${phase}`, `verb=${manifest.verb ?? "*"}`],
    };
  }

  if (failure.class === FAILURE_CLASSES.RUN_FAILED) {
    const id = `failure-run-${slugifyLessonId(manifest.verb ?? "run")}-${slugifyLessonId(manifest.object ?? "task")}`;
    const condition = `${manifest.command ?? "run"} ending in failure`;
    const action =
      "Capture the first gate/artifact failure signal before retrying execute or expanding swarm size.";
    const expected_effect = "next retry addresses root gate/artifact cause";
    return {
      id,
      kind: "structured",
      promotion_stage: "candidate",
      failure_class: FAILURE_CLASSES.RUN_FAILED,
      context: {
        verb: manifest.verb ?? null,
        object: manifest.object ?? null,
      },
      condition,
      action,
      expected_effect,
      lesson: action,
      problem: failure.detail ?? "Run failed",
      solution: action,
      tags: [manifest.verb, "failure"].filter(Boolean),
      scope: "project",
      appliesWhen: [`verb=${manifest.verb ?? "*"}`],
    };
  }

  return null;
}

/**
 * Structured success lesson: keep doing what avoided a known failure class.
 * Emitted when run succeeded after prior artifact-budget risk signals in intent.
 */
export function compileSuccessGuardLesson(manifest, reflection, outcome) {
  if (outcome?.status !== "success") return null;
  const intent = String(manifest.intent ?? "").toLowerCase();
  if (
    !intent.includes("15000") &&
    !intent.includes("16") &&
    !intent.includes("artifact") &&
    !intent.includes("bytes")
  ) {
    return null;
  }
  return {
    id: "success-keep-artifacts-under-budget",
    kind: "structured",
    promotion_stage: "candidate",
    failure_class: FAILURE_CLASSES.ARTIFACT_TOO_LARGE,
    context: {
      phase: "plan",
      artifact: "plan.yaml",
      verb: manifest.verb ?? null,
      object: manifest.object ?? null,
    },
    condition: "review/check planning with artifact size constraints in intent",
    action:
      "Treat plan.yaml and report.md as constrained execution artifacts; keep them under the artifact budget and externalize supporting analysis.",
    expected_effect: "completed run with no context_budget_exceeded",
    lesson:
      "Keep plan.yaml and report.md under the artifact budget; externalize supporting analysis.",
    problem: "Artifact budget gates fail when plan/report grow unbounded",
    solution:
      "Keep plan.yaml and report.md under the artifact budget; externalize supporting analysis.",
    tags: [manifest.verb, "artifact-budget", "success-guard"].filter(Boolean),
    scope: "project",
    appliesWhen: [`verb=${manifest.verb ?? "*"}`],
  };
}

/**
 * Upgrade generic bottleneck reflections into slightly more structured cards.
 */
export function compileBottleneckLesson(manifest, reflection) {
  if (!reflection?.bottleneck_phase && !reflection?.reusable_lesson) return null;
  const phase = reflection.bottleneck_phase ?? "unknown";
  const id = `lesson-bottleneck-${slugifyLessonId(phase)}`;
  const condition = `${phase} dominates runtime`;
  const action =
    reflection.recommendation ||
    `Optimize ${phase} via narrower agent scopes or wave split; keep artifact-first handoffs.`;
  const expected_effect = `lower ${phase} share of duration_ms on similar tasks`;
  return {
    id,
    kind: "structured",
    promotion_stage: "candidate",
    failure_class: FAILURE_CLASSES.PHASE_BOTTLENECK,
    context: {
      phase,
      verb: manifest.verb ?? null,
      object: manifest.object ?? null,
    },
    condition,
    action,
    expected_effect,
    lesson: reflection.reusable_lesson || action,
    problem: reflection.largest_bottleneck
      ? `Bottleneck: ${reflection.largest_bottleneck}`
      : condition,
    solution: action,
    tags: [manifest.verb, manifest.object, "runtime", phase].filter(Boolean),
    scope: "project",
    appliesWhen: [`phase=${phase}`, `verb=${manifest.verb ?? "*"}`],
  };
}

/**
 * @returns {object[]} structured lesson candidates
 */
export function compileLessonsFromRun(manifest, reflection, outcome, failures) {
  const out = [];
  for (const failure of failures ?? []) {
    const lesson = compileLessonFromFailure(failure, manifest);
    if (lesson) out.push(lesson);
  }
  const guard = compileSuccessGuardLesson(manifest, reflection, outcome);
  if (guard) out.push(guard);
  const bottleneck = compileBottleneckLesson(manifest, reflection);
  if (bottleneck) out.push(bottleneck);

  const byId = new Map();
  for (const c of out) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()];
}
