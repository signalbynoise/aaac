/**
 * Experience graph retrieval (stub embeddings — no model download).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXP = path.join(PACKAGE_ROOT, "src/run-engine/experience");
const TEMPLATE_RETRIEVAL_YAML = path.join(
  PACKAGE_ROOT,
  "templates/cursor/aaac/experience/retrieval.yaml",
);

describe("experience-retrieval", () => {
  let tmpRoot;
  let prevWorkspace;
  let prevProvider;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-retrieval-"));
    prevWorkspace = process.env.AAAC_WORKSPACE_ROOT;
    prevProvider = process.env.AAAC_EMBEDDING_PROVIDER;
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;
    process.env.AAAC_EMBEDDING_PROVIDER = "stub";

    const aaac = path.join(tmpRoot, ".cursor", "aaac");
    fs.mkdirSync(path.join(aaac, "state", "runs"), { recursive: true });
    fs.mkdirSync(path.join(aaac, "experience"), { recursive: true });
    fs.writeFileSync(
      path.join(aaac, "runtime-registry.json"),
      JSON.stringify({ commands: {}, phases: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "enforcement.json"),
      JSON.stringify({ edit_phases: ["execute"], swarm_min_agents: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "experience", "retrieval.yaml"),
      fs.readFileSync(TEMPLATE_RETRIEVAL_YAML, "utf8"),
    );
    fs.writeFileSync(
      path.join(aaac, "experience", "global-lessons.json"),
      JSON.stringify({
        version: 1,
        lessons: {
          "ignore-node-modules-planning": {
            id: "ignore-node-modules-planning",
            lesson: "Ignore generated dependency directories during discovery",
            problem: "Agents waste context traversing node_modules and dist",
            solution: "Apply repository-aware ignore patterns before traversing files",
            tags: ["check", "architecture", "planning", "context", "node"],
            scope: "global",
            status: "active",
            avoid_paths: ["node_modules/", "dist/"],
            appliesWhen: ["repository-level discovery"],
            doesNotApplyWhen: ["investigates third-party package internals"],
            evidence: {
              observed_runs: 10,
              successful_runs: 9,
              failed_runs: 1,
              contradicted_runs: 0,
              token_savings_pct: 20,
              average_runtime_improvement_pct: 10,
              confidence: 0.7,
              last_run_id: null,
              updated_at: new Date().toISOString(),
            },
            supporting_run_ids: [],
          },
          "terraform-unrelated": {
            id: "terraform-unrelated",
            lesson: "Pin Terraform provider versions in lockfiles",
            problem: "Provider drift",
            solution: "Commit .terraform.lock.hcl",
            tags: ["terraform", "infra"],
            scope: "global",
            status: "active",
            evidence: {
              observed_runs: 2,
              successful_runs: 1,
              failed_runs: 1,
              contradicted_runs: 0,
              token_savings_pct: null,
              average_runtime_improvement_pct: null,
              confidence: 0.1,
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
    if (prevProvider === undefined) delete process.env.AAAC_EMBEDDING_PROVIDER;
    else process.env.AAAC_EMBEDDING_PROVIDER = prevProvider;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  it("serializes a stable canonical task document", async () => {
    const { buildTaskDocument } = await import(path.join(EXP, "task-document.mjs"));
    const { text } = buildTaskDocument(
      {
        verb: "check",
        object: "architecture",
        phase: "discover",
        domain: "AAAC",
        intent: "inspect without traversing generated dependencies",
      },
      { avoidPaths: ["node_modules/"] },
    );
    expect(text).toContain("action: check");
    expect(text).toContain("object: architecture");
    expect(text).toContain("phase: discover");
    expect(text).toContain("repository: AAAC");
    expect(text).toContain("avoid path: node_modules/");
    expect(text).toContain("tools: shell filesystem git");
  });

  it("RRF and MMR are deterministic", async () => {
    const { reciprocalRankFusion } = await import(path.join(EXP, "retrieve.mjs"));
    const { selectMmr } = await import(path.join(EXP, "mmr.mjs"));
    const fused = reciprocalRankFusion(
      [
        ["a", "b", "c"],
        ["b", "d", "e"],
      ],
      60,
    );
    // b ranks #2 in list1 and #1 in list2 → highest fused score
    expect(fused[0].lessonId).toBe("b");
    expect(fused.map((f) => f.lessonId).sort()).toEqual(["a", "b", "c", "d", "e"]);
    const mmr = selectMmr(
      [
        { lessonId: "a", score: 1, meaningVector: new Float32Array([1, 0]) },
        { lessonId: "b", score: 0.9, meaningVector: new Float32Array([0.99, 0.01]) },
        { lessonId: "c", score: 0.8, meaningVector: new Float32Array([0, 1]) },
      ],
      2,
      0.7,
    );
    expect(mmr.map((m) => m.lessonId)).toEqual(["a", "c"]);
  });

  it("hybrid retrieve returns compact cards with reason and prefers relevant lesson", async () => {
    const { resetEmbeddingProviderCache, getEmbeddingProvider } = await import(
      path.join(EXP, "embed/provider.mjs")
    );
    resetEmbeddingProviderCache();
    const { selectExperienceForContext } = await import(path.join(EXP, "select.mjs"));
    const provider = getEmbeddingProvider({ force: true });
    expect(provider.id).toBe("stub");

    const experience = await selectExperienceForContext(
      {
        verb: "check",
        object: "architecture",
        phase: "discover",
        domain: "AAAC",
        intent: "inspect the repository without traversing node_modules",
      },
      { maxLessons: 5, provider },
    );

    expect(experience.lessons.length).toBeGreaterThan(0);
    expect(experience.lessons.length).toBeLessThanOrEqual(5);
    expect(experience.lessons[0].reason).toBeTruthy();
    expect(experience.lessons[0].evidence.confidence).toBeDefined();
    const ids = experience.lessons.map((l) => l.id);
    expect(ids).toContain("ignore-node-modules-planning");
  });

  it("seeds local index from packaged-index on fresh install", async () => {
    const aaac = path.join(tmpRoot, ".cursor", "aaac");
    const packagedDir = path.join(aaac, "experience", "packaged-index");
    fs.mkdirSync(packagedDir, { recursive: true });
    // Minimal packaged index (one lesson, one meaning slot)
    const { createHashProvider } = await import(path.join(EXP, "embed/hash.mjs"));
    const provider = createHashProvider(384);
    const [vec] = await provider.embed(["Ignore generated dependency directories during discovery"]);
    fs.writeFileSync(
      path.join(packagedDir, "vectors.json"),
      JSON.stringify({
        dims: 384,
        entries: [
          { key: "ignore-node-modules-planning#meaning", vector: Array.from(vec) },
          { key: "ignore-node-modules-planning#trigger", vector: Array.from(vec) },
          { key: "ignore-node-modules-planning#failure", vector: Array.from(vec) },
          { key: "ignore-node-modules-planning#remedy", vector: Array.from(vec) },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(packagedDir, "meta.json"),
      JSON.stringify({
        version: "1",
        meta: { provider: "hash", model: "sha256-bag-of-tokens", dims: "384" },
        lesson_vectors: [],
        edges: [],
      }),
    );

    // Ensure local index is empty
    const localIndex = path.join(aaac, "state", "experience-index");
    fs.rmSync(localIndex, { recursive: true, force: true });

    await vi.resetModules();
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;
    process.env.AAAC_EMBEDDING_PROVIDER = "hash";

    const { seedLocalIndexFromPackaged } = await import(path.join(EXP, "index/seed.mjs"));
    const seed = seedLocalIndexFromPackaged();
    expect(seed.seeded).toBe(true);
    expect(fs.existsSync(path.join(localIndex, "vectors.json"))).toBe(true);

    const { selectExperienceForContext } = await import(path.join(EXP, "select.mjs"));
    const { getEmbeddingProvider, resetEmbeddingProviderCache } = await import(
      path.join(EXP, "embed/provider.mjs")
    );
    resetEmbeddingProviderCache();
    const experience = await selectExperienceForContext(
      {
        verb: "check",
        object: "architecture",
        phase: "discover",
        intent: "skip node_modules during discovery",
      },
      { provider: getEmbeddingProvider({ force: true }) },
    );
    expect(experience.lessons.length).toBeGreaterThan(0);
    expect(experience.retrieval?.mode).toBe("hybrid");
  });

  it("rebuild index from fixtures produces searchable slots", async () => {
    const { resetEmbeddingProviderCache, getEmbeddingProvider } = await import(
      path.join(EXP, "embed/provider.mjs")
    );
    resetEmbeddingProviderCache();
    const { loadPackagedGlobalLessons, mergeLessonCorpora, loadLessonsStore } =
      await import(path.join(EXP, "stores.mjs"));
    const { rebuildExperienceIndex } = await import(path.join(EXP, "index/build.mjs"));
    const { getVectorIndex, resetVectorIndexCache } = await import(
      path.join(EXP, "index/hnsw.mjs")
    );

    resetVectorIndexCache();
    const provider = getEmbeddingProvider({ force: true });
    const merged = mergeLessonCorpora(loadPackagedGlobalLessons(), loadLessonsStore());
    const result = await rebuildExperienceIndex(merged, { provider });
    expect(result.ok).toBe(true);
    expect(result.upserted).toBeGreaterThan(0);

    const index = getVectorIndex({ force: true });
    const meaning = index.getVector("ignore-node-modules-planning", "meaning");
    expect(meaning).toBeTruthy();
    expect(meaning.length).toBe(384);
    const hits = index.search(meaning, 5);
    expect(hits.some((h) => h.lessonId === "ignore-node-modules-planning")).toBe(true);
  });

  it("preparePhaseContext includes reason on retrieved lessons", async () => {
    await vi.resetModules();
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;
    process.env.AAAC_EMBEDDING_PROVIDER = "stub";

    const { preparePhaseContext } = await import(
      path.join(REPO_ROOT, "packages/aaac/src/run-engine/prepare-phase-context.mjs")
    );

    const runId = "run_test_retrieval_prepare";
    const runPath = path.join(tmpRoot, ".cursor", "aaac", "state", "runs", runId);
    fs.mkdirSync(path.join(runPath, "artifacts"), { recursive: true });
    const manifest = {
      run_id: runId,
      status: "running",
      verb: "check",
      object: "architecture",
      domain: "AAAC",
      intent: "avoid node_modules during discovery",
      command: "check-architecture",
      phase: "discover",
      completed: [],
      pending: [],
      swarm: {},
      complexity: {},
    };
    fs.writeFileSync(path.join(runPath, "run.json"), JSON.stringify(manifest, null, 2));

    const result = await preparePhaseContext(runId, manifest);
    expect(result.ok).toBe(true);
    expect(result.experience_lessons).toBeGreaterThan(0);

    const phaseContext = JSON.parse(
      fs.readFileSync(path.join(runPath, "artifacts", "phase_context.json"), "utf8"),
    );
    expect(phaseContext.experience.lessons[0].reason).toBeTruthy();
    expect(phaseContext.experience.lessons[0].evidence).toBeTruthy();
  });
});
