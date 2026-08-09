/**
 * V5 — Hard hash-gated artifact reuse (prior plan/report as SSOT when inputs match).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isoNow, readJson, writeJson, REPO_ROOT, STATE_ROOT } from "../lib.mjs";
import { ARTIFACT_CACHE_ROOT } from "./paths.mjs";
import { signatureKey } from "./stats.mjs";

const CACHED_NAMES = ["plan.yaml", "report.md"];

export function emptyArtifactMeta() {
  return {
    version: 1,
    signature: null,
    input_fingerprint: null,
    input_hashes: {},
    scoped_paths: [],
    artifacts: {},
    updated_at: null,
    hits: 0,
  };
}

function resolveCacheRoot() {
  if (process.env.AAAC_WORKSPACE_ROOT) {
    return path.join(
      path.resolve(process.env.AAAC_WORKSPACE_ROOT),
      ".cursor/aaac/state/artifact-cache",
    );
  }
  return ARTIFACT_CACHE_ROOT || path.join(STATE_ROOT, "artifact-cache");
}

function signatureDir(signature) {
  const safe = String(signature).replace(/\|/g, "__").replace(/[^\w.-]+/g, "_");
  return path.join(resolveCacheRoot(), safe);
}

export function extractScopedPaths(manifest) {
  const intent = String(manifest?.intent ?? "");
  const paths = new Set();
  // Paths that look like repo-relative files/dirs
  const re =
    /(?:^|[\s"'`])((?:apps|packages|\.cursor|src|tests?)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
  let m;
  while ((m = re.exec(intent)) !== null) {
    paths.add(m[1]);
  }
  // Also bare paths in quotes
  const quoted = intent.match(/"([^"]+)"/g) ?? [];
  for (const q of quoted) {
    const inner = q.slice(1, -1);
    for (const part of inner.split(/\s+and\s+|,\s*/)) {
      const p = part.trim();
      if (p.includes("/") && /\.[A-Za-z0-9]+$/.test(p)) paths.add(p);
    }
  }
  return [...paths].slice(0, 40);
}

export function hashFile(absPath) {
  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Fingerprint scoped inputs for cache validity.
 * @returns {{ fingerprint: string, hashes: Record<string, string|null>, scoped_paths: string[] }}
 */
export function buildInputFingerprint(manifest, { repoRoot = REPO_ROOT } = {}) {
  const scoped = extractScopedPaths(manifest);
  const hashes = {};
  for (const rel of scoped) {
    hashes[rel] = hashFile(path.join(repoRoot, rel));
  }
  // Intent text (normalized) so prompt changes invalidate
  const intentNorm = String(manifest?.intent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  hashes["__intent__"] = crypto
    .createHash("sha256")
    .update(intentNorm)
    .digest("hex")
    .slice(0, 16);
  hashes["__command__"] = String(manifest?.command ?? "");
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(hashes))
    .digest("hex")
    .slice(0, 24);
  return { fingerprint, hashes, scoped_paths: scoped };
}

export function fingerprintsMatch(a, b) {
  return Boolean(a && b && a === b);
}

function readCachedArtifacts(dir) {
  const out = {};
  for (const name of CACHED_NAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try {
        out[name] = fs.readFileSync(p, "utf8").slice(0, 12000);
      } catch {
        // skip
      }
    }
  }
  return out;
}

/**
 * Select prior artifacts when input fingerprint matches.
 * @returns {{ reuse_mode: string, prior_artifacts: object|null, reuse_hits: number, fingerprint: string }}
 */
export function selectPriorArtifacts(manifest, { repoRoot = REPO_ROOT } = {}) {
  const key = signatureKey(manifest);
  const dir = signatureDir(key);
  const metaPath = path.join(dir, "meta.json");
  const { fingerprint, hashes, scoped_paths } = buildInputFingerprint(manifest, {
    repoRoot,
  });

  const empty = {
    reuse_mode: "regenerate",
    prior_artifacts: null,
    reuse_hits: 0,
    fingerprint,
    scoped_paths,
    input_hashes: hashes,
  };

  if (!fs.existsSync(metaPath)) return empty;
  const meta = readJson(metaPath, null);
  if (!meta || !fingerprintsMatch(meta.input_fingerprint, fingerprint)) {
    return empty;
  }

  const artifacts = readCachedArtifacts(dir);
  if (!Object.keys(artifacts).length) return empty;

  meta.hits = (meta.hits ?? 0) + 1;
  meta.last_hit_at = isoNow();
  writeJson(metaPath, meta);

  return {
    reuse_mode: "delta_or_confirm",
    prior_artifacts: {
      signature: key,
      files: artifacts,
      cached_at: meta.updated_at,
      hits: meta.hits,
    },
    reuse_hits: 1,
    fingerprint,
    scoped_paths,
    input_hashes: hashes,
  };
}

/**
 * Cache successful run artifacts for future reuse.
 */
export function cacheArtifactsFromRun(
  manifest,
  artifactsDir,
  { repoRoot = REPO_ROOT, qualityOk = false } = {},
) {
  if (!qualityOk) {
    return { cached: false, reason: "quality_not_ok" };
  }
  if (!artifactsDir || !fs.existsSync(artifactsDir)) {
    return { cached: false, reason: "missing_artifacts_dir" };
  }

  const key = signatureKey(manifest);
  const dir = signatureDir(key);
  fs.mkdirSync(dir, { recursive: true });

  const { fingerprint, hashes, scoped_paths } = buildInputFingerprint(manifest, {
    repoRoot,
  });

  const saved = [];
  for (const name of CACHED_NAMES) {
    const src = path.join(artifactsDir, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dir, name));
    saved.push(name);
  }
  if (!saved.length) return { cached: false, reason: "no_cacheable_files" };

  const prev = readJson(path.join(dir, "meta.json"), emptyArtifactMeta());
  const meta = {
    ...emptyArtifactMeta(),
    signature: key,
    input_fingerprint: fingerprint,
    input_hashes: hashes,
    scoped_paths,
    artifacts: Object.fromEntries(saved.map((n) => [n, true])),
    updated_at: isoNow(),
    hits: prev.hits ?? 0,
  };
  writeJson(path.join(dir, "meta.json"), meta);
  return { cached: true, signature: key, files: saved, fingerprint };
}
