/**
 * Smoke: processRunExperience + selectExperienceForContext
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("experience-evidence", () => {
  let tmpRoot;
  let prevWorkspace;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-experience-"));
    prevWorkspace = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;

    const aaac = path.join(tmpRoot, ".cursor", "aaac");
    fs.mkdirSync(path.join(aaac, "state", "runs"), { recursive: true });
    fs.mkdirSync(path.join(aaac, "experience"), { recursive: true });
    fs.mkdirSync(path.join(aaac, "scripts", "run-engine"), { recursive: true });

    // Minimal registry so lib loaders that touch registry don't break unrelated imports
    fs.writeFileSync(
      path.join(aaac, "runtime-registry.json"),
      JSON.stringify({ commands: {}, phases: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "enforcement.json"),
      JSON.stringify({ edit_phases: ["execute"], swarm_min_agents: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "experience", "global-lessons.json"),
      JSON.stringify({
        version: 1,
        lessons: {
          "ignore-node-modules-planning": {
            id: "ignore-node-modules-planning",
            lesson: "Ignore node_modules during planning",
            tags: ["planning", "context", "node"],
            scope: "global",
            status: "active",
            avoid_paths: ["node_modules/"],
            evidence: {
              observed_runs: 10,
              successful_runs: 9,
              failed_runs: 1,
              contradicted_runs: 0,
              token_savings_pct: 20,
              average_runtime_improvement_pct: 10,
              confidence: 0.7,
              last_run_id: null,
              updated_at: null,
            },
            supporting_run_ids: [],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(aaac, "state", "lessons.json"),
      JSON.stringify({ version: 1, lessons: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "state", "experience-stats.json"),
      JSON.stringify({ version: 1, signatures: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "state", "workspace-memory.json"),
      JSON.stringify({ version: 1, prefs: [] }),
    );
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevWorkspace;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("processes a completed run into evidence-backed lessons and phase context priors", async () => {
    // Dynamic import after AAAC_WORKSPACE_ROOT is set
    const mod = await import(
      path.join(REPO_ROOT, "packages/aaac/src/run-engine/experience-evidence.mjs")
    );

    const runId = "run_test_experience_smoke";
    const runPath = path.join(
      tmpRoot,
      ".cursor",
      "aaac",
      "state",
      "runs",
      runId,
    );
    fs.mkdirSync(path.join(runPath, "artifacts"), { recursive: true });

    const manifest = {
      run_id: runId,
      status: "completed",
      verb: "update",
      object: "module",
      domain: null,
      intent: "Refactor planner to skip node_modules when discovering files",
      command: "update-module",
      completed: ["discover", "plan", "execute", "verify", "report"],
      pending: [],
      gates: { results: { validate: "pass" } },
      artifacts: { report: "artifacts/report.md", plan: "artifacts/plan.yaml" },
      log: [],
      metrics: {
        duration_ms: 120000,
        total_tokens: 8000,
        phase_count: 5,
      },
      phase_metrics: {
        discover: { duration_ms: 50000 },
        plan: { duration_ms: 40000 },
        execute: { duration_ms: 20000 },
      },
      swarm: { estimated_utilization: 0.22 },
      context: { phases: {} },
      experience_processed: false,
    };
    fs.writeFileSync(
      path.join(runPath, "run.json"),
      JSON.stringify(manifest, null, 2),
    );

    process.env.AAAC_EMBEDDING_PROVIDER = "stub";
    const result = await mod.processRunExperience(runId, { force: true });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(result.outcome.status).toBe("success");
    expect(fs.existsSync(path.join(runPath, "artifacts", "reflection.json"))).toBe(
      true,
    );
    expect(result.lessons.length).toBeGreaterThan(0);
    for (const lesson of result.lessons) {
      expect(lesson.evidence).toBeTruthy();
      expect(lesson.evidence.observed_runs).toBeGreaterThanOrEqual(1);
      expect(typeof lesson.evidence.confidence).toBe("number");
    }

    const lessonsStore = JSON.parse(
      fs.readFileSync(
        path.join(tmpRoot, ".cursor", "aaac", "state", "lessons.json"),
        "utf8",
      ),
    );
    const firstId = result.lessons[0].id;
    expect(lessonsStore.lessons[firstId].evidence.observed_runs).toBeGreaterThanOrEqual(
      1,
    );

    const statsStore = JSON.parse(
      fs.readFileSync(
        path.join(tmpRoot, ".cursor", "aaac", "state", "experience-stats.json"),
        "utf8",
      ),
    );
    expect(statsStore.signatures["update|module|_"].runs).toBe(1);

    // Second run increments evidence
    const result2 = await mod.processRunExperience(runId, { force: true });
    expect(result2.ok).toBe(true);
    const lessonsStore2 = JSON.parse(
      fs.readFileSync(
        path.join(tmpRoot, ".cursor", "aaac", "state", "lessons.json"),
        "utf8",
      ),
    );
    expect(lessonsStore2.lessons[firstId].evidence.observed_runs).toBeGreaterThanOrEqual(
      2,
    );

    process.env.AAAC_EMBEDDING_PROVIDER = "stub";
    const experience = await mod.selectExperienceForContext({
      verb: "update",
      object: "module",
      domain: null,
      intent: "planning around node_modules",
    });
    expect(experience.lessons.length).toBeGreaterThan(0);
    expect(experience.lessons[0].evidence.observed_runs).toBeGreaterThanOrEqual(1);
    expect(experience.stats_prior?.runs).toBeGreaterThanOrEqual(1);
    expect(experience.context_hint.avoid_paths).toContain("node_modules/");

    const candidates = mod.exportGlobalLessonCandidates({
      minObserved: 1,
      minConfidence: 0.01,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].supporting_run_ids).toEqual([]);
    expect(candidates[0].evidence.last_run_id).toBeNull();
  });

  it("deriveConfidence stays in [0,1] and rises with successful observations", async () => {
    const mod = await import(
      path.join(REPO_ROOT, "packages/aaac/src/run-engine/experience-evidence.mjs")
    );
    const low = mod.deriveConfidence({
      observed_runs: 1,
      successful_runs: 1,
      contradicted_runs: 0,
    });
    const high = mod.deriveConfidence({
      observed_runs: 50,
      successful_runs: 48,
      contradicted_runs: 1,
    });
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("preparePhaseContext soft-fails to empty lessons when select throws; still writes file", async () => {
    await vi.resetModules();
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;

    vi.doMock(
      path.join(REPO_ROOT, "packages/aaac/src/run-engine/experience/select.mjs"),
      () => ({
        selectExperienceForContext: async () => {
          throw new Error("select boom");
        },
        mergeLessonCorpora: () => ({}),
      }),
    );

    const { preparePhaseContext } = await import(
      path.join(REPO_ROOT, "packages/aaac/src/run-engine/prepare-phase-context.mjs")
    );

    const runId = "run_test_prepare_soft_fail";
    const runPath = path.join(
      tmpRoot,
      ".cursor",
      "aaac",
      "state",
      "runs",
      runId,
    );
    fs.mkdirSync(path.join(runPath, "artifacts"), { recursive: true });

    const manifest = {
      run_id: runId,
      status: "running",
      verb: "fix",
      object: "module",
      domain: null,
      intent: "Harden phase context auto-invoke",
      command: "fix-module",
      phase: "discover",
      completed: [],
      pending: ["investigate_swarm", "root_cause"],
      swarm: {},
      complexity: {},
    };
    fs.writeFileSync(
      path.join(runPath, "run.json"),
      JSON.stringify(manifest, null, 2),
    );

    const result = await preparePhaseContext(runId, manifest);
    expect(result.ok).toBe(true);
    expect(result.experience_lessons).toBe(0);

    const outPath = path.join(runPath, "artifacts", "phase_context.json");
    expect(fs.existsSync(outPath)).toBe(true);
    const phaseContext = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(phaseContext.run_id).toBe(runId);
    expect(phaseContext.phase).toBe("discover");
    expect(phaseContext.experience.lessons).toEqual([]);
    expect(phaseContext.experience.stats_prior).toBeNull();
  });
});
