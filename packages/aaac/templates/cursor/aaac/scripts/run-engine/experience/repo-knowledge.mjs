/**
 * V4 — Durable repository knowledge with source-hash invalidation.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isoNow, readJson, writeJson } from "../lib.mjs";
import { REPO_KNOWLEDGE_PATH, KNOWLEDGE_ROOT } from "./paths.mjs";

export function emptyRepoKnowledgeStore() {
  return { version: 1, updated_at: null, claims: {} };
}

export function loadRepoKnowledgeStore() {
  return readJson(REPO_KNOWLEDGE_PATH, emptyRepoKnowledgeStore());
}

export function saveRepoKnowledgeStore(store) {
  store.updated_at = isoNow();
  writeJson(REPO_KNOWLEDGE_PATH, store);
}

export function hashFile(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

function resolveWorkspaceRoot() {
  return process.env.AAAC_WORKSPACE_ROOT || process.cwd();
}

/**
 * Upsert a claim. Invalidates if source hashes drift on next verify.
 */
export function upsertClaim(store, {
  id,
  claim,
  kind = "fact",
  source_files = [],
  confidence = 0.5,
  tags = [],
}) {
  const root = resolveWorkspaceRoot();
  const hashes = {};
  for (const rel of source_files) {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    const h = hashFile(abs);
    if (h) hashes[rel] = h;
  }
  const prev = store.claims[id] ?? {};
  store.claims[id] = {
    id,
    claim,
    kind,
    source_files,
    source_hashes: hashes,
    confidence: Math.max(prev.confidence ?? 0, confidence),
    tags,
    last_verified: isoNow(),
    valid: Object.keys(hashes).length > 0 || source_files.length === 0,
    hits: (prev.hits ?? 0),
  };
  return store.claims[id];
}

/**
 * Re-verify all claims against current file hashes.
 */
export function verifyRepoKnowledge(store) {
  const root = resolveWorkspaceRoot();
  let invalidated = 0;
  let verified = 0;
  for (const claim of Object.values(store.claims ?? {})) {
    let ok = true;
    for (const rel of claim.source_files ?? []) {
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      const h = hashFile(abs);
      if (h && claim.source_hashes?.[rel] && h !== claim.source_hashes[rel]) {
        ok = false;
      }
    }
    claim.valid = ok;
    if (ok) {
      claim.last_verified = isoNow();
      verified += 1;
    } else {
      invalidated += 1;
    }
    store.claims[claim.id] = claim;
  }
  return { verified, invalidated };
}

/**
 * Extract lightweight claims from a high-quality trajectory + lessons.
 */
export function learnRepoKnowledgeFromRun(store, {
  trajectory,
  lessons = [],
  manifest,
}) {
  if (!trajectory?.quality?.ok) return { added: [] };
  const added = [];
  const cmd = manifest?.command ?? trajectory.command ?? "";
  const object = manifest?.object ?? trajectory.object ?? "module";

  // Skip-path claims from lessons
  for (const lesson of lessons) {
    for (const p of lesson.avoid_paths ?? []) {
      const id = `skip-${p.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 80)}`;
      upsertClaim(store, {
        id,
        claim: `Usually skip ${p} for ${cmd || object} tasks unless explicitly required.`,
        kind: "skip",
        source_files: [],
        confidence: 0.55,
        tags: ["skip", object],
      });
      added.push(id);
    }
  }

  // Cheap structural claim for scoped reviews
  if (String(cmd).includes("review-module") || trajectory.verb === "review") {
    const id = `scope-${object}-review`;
    upsertClaim(store, {
      id,
      claim:
        `For ${object} module reviews: prefer entrypoints, public API, and tests; avoid full-repo scans and unrelated packages.`,
      kind: "procedure",
      source_files: [],
      confidence: 0.6,
      tags: ["review", object, "scope"],
    });
    added.push(id);
  }

  // Efficiency claim when this run beat typical file reads
  if (
    trajectory.files_read_total != null &&
    trajectory.files_read_total > 0 &&
    trajectory.files_read_total <= 20
  ) {
    const id = `efficient-files-${trajectory.signature}`;
    upsertClaim(store, {
      id,
      claim: `Efficient ${trajectory.signature} runs often finish with ~${trajectory.files_read_total} file reads when scope is tight.`,
      kind: "efficiency",
      source_files: [],
      confidence: 0.5,
      tags: ["efficiency"],
    });
    added.push(id);
  }

  return { added: [...new Set(added)] };
}

/**
 * Select claims for injection under a budget (bytes) and reuse flags.
 */
export function selectRepoFacts(store, {
  budgetBytes = 4000,
  reuse = {},
  maxClaims = 8,
} = {}) {
  verifyRepoKnowledge(store);
  const kindsWanted = new Set();
  if (reuse.repo_map !== false) kindsWanted.add("fact");
  if (reuse.module_summary !== false) kindsWanted.add("procedure");
  if (reuse.dependency_map !== false) kindsWanted.add("efficiency");
  kindsWanted.add("skip");

  const candidates = Object.values(store.claims ?? {})
    .filter((c) => c.valid !== false)
    .filter((c) => kindsWanted.has(c.kind) || c.kind === "skip")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  const selected = [];
  let used = 0;
  for (const claim of candidates) {
    if (selected.length >= maxClaims) break;
    const text = claim.claim ?? "";
    const cost = Buffer.byteLength(text, "utf8") + 24;
    if (used + cost > budgetBytes) continue;
    selected.push({
      id: claim.id,
      kind: claim.kind,
      claim: text,
      confidence: claim.confidence,
      tags: claim.tags ?? [],
    });
    used += cost;
    claim.hits = (claim.hits ?? 0) + 1;
    store.claims[claim.id] = claim;
  }

  return { facts: selected, bytes: used, reuse_hits: selected.length };
}

/** Optional markdown dump for stable maps. */
export function writeRepoMapMarkdown(store) {
  const valid = Object.values(store.claims ?? {}).filter((c) => c.valid !== false);
  if (!valid.length) return null;
  fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
  const out = path.join(KNOWLEDGE_ROOT, "repo-map.md");
  const lines = [
    "# Repository knowledge (auto)",
    "",
    `Updated: ${isoNow()}`,
    "",
  ];
  for (const c of valid.slice(0, 40)) {
    lines.push(`## ${c.id}`);
    lines.push("");
    lines.push(c.claim);
    lines.push("");
    lines.push(`Confidence: ${c.confidence} · kind: ${c.kind}`);
    lines.push("");
  }
  fs.writeFileSync(out, `${lines.join("\n")}\n`);
  return out;
}
