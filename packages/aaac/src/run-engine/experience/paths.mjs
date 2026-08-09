/**
 * Experience layer paths + thresholds (SSOT).
 */
import fs from "fs";
import path from "path";
import { AAAC_ROOT, STATE_ROOT } from "../lib.mjs";

export const LESSONS_PATH = path.join(STATE_ROOT, "lessons.json");
export const EXPERIENCE_STATS_PATH = path.join(STATE_ROOT, "experience-stats.json");
export const WORKSPACE_MEMORY_PATH = path.join(STATE_ROOT, "workspace-memory.json");
export const GLOBAL_LESSONS_PATH = path.join(AAAC_ROOT, "experience", "global-lessons.json");
export const KNOWLEDGE_ROOT = path.join(AAAC_ROOT, "knowledge");
/** V4 — compressed strategies, repo knowledge, execution profiles */
export const STRATEGIES_PATH = path.join(STATE_ROOT, "strategies.json");
export const REPO_KNOWLEDGE_PATH = path.join(STATE_ROOT, "repo-knowledge.json");
export const EXECUTION_PROFILES_PATH = path.join(STATE_ROOT, "execution-profiles.json");
/** V5 — learned swarm targets + hash-gated artifact cache */
export const GRAPH_POLICY_PATH = path.join(STATE_ROOT, "graph-policy.json");
export const ARTIFACT_CACHE_ROOT = path.join(STATE_ROOT, "artifact-cache");
export const RETRIEVAL_YAML_PATH = path.join(AAAC_ROOT, "experience", "retrieval.yaml");
/** Shipped with npm — precomputed collective vectors (portable JSON). */
export const PACKAGED_INDEX_DIR = path.join(AAAC_ROOT, "experience", "packaged-index");
export const PACKAGED_INDEX_META_PATH = path.join(PACKAGED_INDEX_DIR, "meta.json");
export const PACKAGED_INDEX_VECTORS_PATH = path.join(PACKAGED_INDEX_DIR, "vectors.json");
/** Writable local overlay (derived; not published). */
export const EXPERIENCE_INDEX_DIR = path.join(STATE_ROOT, "experience-index");
export const EXPERIENCE_INDEX_DB_PATH = path.join(EXPERIENCE_INDEX_DIR, "meta.sqlite");
export const EXPERIENCE_INDEX_JSON_PATH = path.join(EXPERIENCE_INDEX_DIR, "meta.json");
export const EXPERIENCE_HNSW_PATH = path.join(EXPERIENCE_INDEX_DIR, "vectors.usearch");
export const EXPERIENCE_VECTORS_JSON_PATH = path.join(EXPERIENCE_INDEX_DIR, "vectors.json");

/** Max lessons injected into phase_context (token budget). */
export const DEFAULT_LESSON_CAP = 5;
export const DEFAULT_WARNING_CAP = 3;
export const PROMOTE_MIN_OBSERVED = 5;
export const PROMOTE_MIN_CONFIDENCE = 0.75;
export const ARTIFACT_PROMOTE_MIN_CONFIDENCE = 0.85;

export const VECTOR_SLOTS = ["meaning", "trigger", "failure", "remedy"];

const DEFAULT_RETRIEVAL = {
  semantic_candidates: 32,
  lexical_candidates: 16,
  graph_expansion_hops: 1,
  max_neighbours_per_seed: 8,
  rerank_limit: 96,
  final_lessons: 5,
  max_warnings: 3,
  rrf_k: 60,
  mmr_lambda: 0.7,
  hnsw: {
    metric: "cos",
    connectivity: 16,
    ef_construction: 100,
    ef_search: 48,
    dimensions: 384,
  },
  embedding: {
    // hash matches shipped packaged-index (offline, no model download)
    default_provider: "hash",
    local_model: "Xenova/all-MiniLM-L6-v2",
    remote_model: "text-embedding-3-small",
    dimensions: 384,
    packaged_provider: "hash",
  },
  ranking: {
    semantic_similarity: 0.38,
    trigger_similarity: 0.16,
    structural_match: 0.12,
    outcome_value: 0.14,
    repository_affinity: 0.08,
    recency: 0.06,
    graph_support: 0.06,
    contradiction_penalty: 0.15,
    failure_penalty: 0.1,
    redundancy_penalty: 0.08,
    bayes_alpha: 1,
    bayes_beta: 1,
    recency_half_life_days: 730,
    contextual_utility: 0.22,
  },
};

function readYamlInt(content, fieldName, fallback) {
  const match = content.match(new RegExp(`^\\s*${fieldName}:\\s*([\\d.]+)`, "m"));
  return match ? Number(match[1]) : fallback;
}

function readYamlString(content, fieldName, fallback) {
  const match = content.match(
    new RegExp(`^\\s*${fieldName}:\\s*["']?([^"'\\n#]+?)["']?\\s*$`, "m"),
  );
  return match ? match[1].trim() : fallback;
}

/** @returns {typeof DEFAULT_RETRIEVAL} */
export function loadRetrievalConfig() {
  const cfg = structuredClone(DEFAULT_RETRIEVAL);
  if (!fs.existsSync(RETRIEVAL_YAML_PATH)) return cfg;
  try {
    const content = fs.readFileSync(RETRIEVAL_YAML_PATH, "utf8");
    for (const key of [
      "semantic_candidates",
      "lexical_candidates",
      "graph_expansion_hops",
      "max_neighbours_per_seed",
      "rerank_limit",
      "final_lessons",
      "max_warnings",
      "rrf_k",
      "mmr_lambda",
    ]) {
      cfg[key] = readYamlInt(content, key, cfg[key]);
    }
    cfg.hnsw.connectivity = readYamlInt(content, "connectivity", cfg.hnsw.connectivity);
    cfg.hnsw.ef_construction = readYamlInt(
      content,
      "ef_construction",
      cfg.hnsw.ef_construction,
    );
    cfg.hnsw.ef_search = readYamlInt(content, "ef_search", cfg.hnsw.ef_search);
    cfg.hnsw.dimensions = readYamlInt(content, "dimensions", cfg.hnsw.dimensions);
    cfg.embedding.dimensions = cfg.hnsw.dimensions;
    cfg.embedding.default_provider = readYamlString(
      content,
      "default_provider",
      cfg.embedding.default_provider,
    );
    cfg.embedding.local_model = readYamlString(
      content,
      "local_model",
      cfg.embedding.local_model,
    );
    cfg.embedding.remote_model = readYamlString(
      content,
      "remote_model",
      cfg.embedding.remote_model,
    );
    cfg.embedding.packaged_provider = readYamlString(
      content,
      "packaged_provider",
      cfg.embedding.packaged_provider || "hash",
    );
    for (const key of Object.keys(cfg.ranking)) {
      cfg.ranking[key] = readYamlInt(content, key, cfg.ranking[key]);
    }
  } catch {
    // keep defaults
  }

  // Policy / bandit env overrides (Stage 5)
  if (process.env.AAAC_FINAL_LESSONS) {
    const n = Number(process.env.AAAC_FINAL_LESSONS);
    if (Number.isFinite(n) && n > 0) cfg.final_lessons = n;
  }
  if (process.env.AAAC_MMR_LAMBDA) {
    const n = Number(process.env.AAAC_MMR_LAMBDA);
    if (Number.isFinite(n) && n > 0 && n <= 1) cfg.mmr_lambda = n;
  }
  return cfg;
}

/** Soft artifact warning threshold (bytes), ratio of hard 16KB limit by default. */
export function loadArtifactCharWarn(hardLimit = 16000) {
  if (process.env.AAAC_ARTIFACT_CHAR_WARN) {
    const n = Number(process.env.AAAC_ARTIFACT_CHAR_WARN);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  if (process.env.AAAC_ARTIFACT_WARN_RATIO) {
    const r = Number(process.env.AAAC_ARTIFACT_WARN_RATIO);
    if (Number.isFinite(r) && r > 0 && r <= 1) {
      return Math.floor(hardLimit * r);
    }
  }
  return hardLimit;
}
