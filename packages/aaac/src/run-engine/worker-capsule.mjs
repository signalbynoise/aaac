/**
 * Grant capsule — copies SOURCE_CONTEXT into an isolated tree.
 * Never symlinks. Never copies ops/policy/run state.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import {
  knownPathsFromPhaseContext,
  normalizeRepoPath,
} from "./evaluate-finding-tools.mjs";
import { isSourceContextPath } from "./context-taxonomy.mjs";

export const CAPSULE_OUTPUT_REL = ".aaac/OUTPUT.md";
export const CAPSULE_GRANTS_REL = ".aaac/grants.json";
export const CAPSULE_RUN_MD_REL = "RUN.md";

export function shouldUseWorkerCapsule(manifest, workerKind = "swarm") {
  if (workerKind === "checkpoint") return false;
  if (String(process.env.AAAC_WORKER_CAPSULE ?? "").trim() === "1") return true;
  if (String(process.env.AAAC_WORKER_CAPSULE ?? "").trim() === "0") return false;
  return String(manifest?.verb ?? "").toLowerCase() === "check";
}

export function capsuleRootFor(runId, agentIndex) {
  const base = path.join(os.tmpdir(), "aaac-capsules", String(runId));
  const slot =
    agentIndex != null && Number.isFinite(Number(agentIndex))
      ? `agent_${Number(agentIndex)}`
      : "agent_0";
  return path.join(base, slot);
}

function fileSha256(abs) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(abs));
  return hash.digest("hex");
}

function copyFileNoFollow(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink() || st.isDirectory()) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const copied = fs.lstatSync(dest);
  if (copied.isSymbolicLink()) {
    fs.unlinkSync(dest);
    return false;
  }
  return true;
}

export function sourceGrantPaths(phaseContext) {
  return knownPathsFromPhaseContext(phaseContext).filter(isSourceContextPath);
}

/**
 * @returns {{
 *   capsuleDir: string,
 *   grants: object,
 *   copied: string[],
 *   skipped: Array<{ path: string, reason: string }>,
 * }}
 */
export function materializeWorkerCapsule({
  workspaceRoot,
  runId,
  agentIndex = 0,
  phaseContext = null,
  manifest = null,
  phase = null,
  brokerUrl = null,
} = {}) {
  const capsuleDir = capsuleRootFor(runId, agentIndex);
  fs.rmSync(capsuleDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(capsuleDir, ".aaac"), { recursive: true });

  const copied = [];
  const skipped = [];
  const grantEntries = [];
  const packetVersion = String(
    phaseContext?.experience?.repo_memory?.meta?.packet_version ??
      phaseContext?.experience?.repo_memory?.meta?.retrieved_at ??
      "1",
  );

  const known = knownPathsFromPhaseContext(phaseContext);
  for (const rel of known) {
    if (!isSourceContextPath(rel)) {
      skipped.push({ path: rel, reason: "not_source" });
      continue;
    }
  }
  for (const rel of sourceGrantPaths(phaseContext)) {
    const src = path.join(workspaceRoot, rel);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      skipped.push({ path: rel, reason: "missing" });
      continue;
    }
    if (st.isSymbolicLink()) {
      skipped.push({ path: rel, reason: "symlink" });
      continue;
    }
    if (st.isDirectory()) {
      skipped.push({ path: rel, reason: "directory" });
      continue;
    }
    const dest = path.join(capsuleDir, rel);
    if (!copyFileNoFollow(src, dest)) {
      skipped.push({ path: rel, reason: "copy_rejected" });
      continue;
    }
    copied.push(rel);
    grantEntries.push({
      grant_id: `g_${grantEntries.length + 1}`,
      path: rel,
      hash: fileSha256(src),
      packet_version: packetVersion,
      consumed: false,
    });
  }

  const grants = {
    version: 1,
    run_id: runId,
    agent_index: agentIndex,
    packet_version: packetVersion,
    files: grantEntries,
    expansions: 0,
    written_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(capsuleDir, CAPSULE_GRANTS_REL),
    `${JSON.stringify(grants, null, 2)}\n`,
  );

  const runMd = [
    `# RUN_CONTEXT`,
    ``,
    `run_id: ${runId}`,
    `phase: ${phase ?? manifest?.phase ?? ""}`,
    `command: ${manifest?.command ?? ""}`,
    `verb: ${manifest?.verb ?? ""}`,
    `output: ${CAPSULE_OUTPUT_REL}`,
    brokerUrl ? `broker: request_context via aaac-context MCP` : "",
    ``,
    `This folder is the only repository you can see.`,
    `Ask for more SOURCE context with request_context. Do not search.`,
    ``,
  ]
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(path.join(capsuleDir, CAPSULE_RUN_MD_REL), runMd);

  return { capsuleDir, grants, copied, skipped };
}

export function writeCapsuleMcpConfig(capsuleDir, brokerUrl) {
  const cursorDir = path.join(capsuleDir, ".cursor");
  fs.mkdirSync(cursorDir, { recursive: true });
  const mcp = {
    mcpServers: {
      "aaac-context": {
        url: `${brokerUrl.replace(/\/$/, "")}/mcp`,
      },
    },
  };
  fs.writeFileSync(path.join(cursorDir, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`);
}

export function readCapsuleGrants(capsuleDir) {
  const p = path.join(capsuleDir, CAPSULE_GRANTS_REL);
  if (!fs.existsSync(p)) return { version: 1, files: [], expansions: 0 };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { version: 1, files: [], expansions: 0 };
  }
}

export function writeCapsuleGrants(capsuleDir, grants) {
  fs.mkdirSync(path.join(capsuleDir, ".aaac"), { recursive: true });
  fs.writeFileSync(
    path.join(capsuleDir, CAPSULE_GRANTS_REL),
    `${JSON.stringify(grants, null, 2)}\n`,
  );
}

export function grantPathSet(grants) {
  return new Set((grants?.files ?? []).map((f) => normalizeRepoPath(f.path)).filter(Boolean));
}

export function markGrantConsumed(capsuleDir, relPath) {
  const grants = readCapsuleGrants(capsuleDir);
  const n = normalizeRepoPath(relPath);
  let hit = false;
  for (const f of grants.files ?? []) {
    if (normalizeRepoPath(f.path) === n) {
      f.consumed = true;
      hit = true;
    }
  }
  if (hit) writeCapsuleGrants(capsuleDir, grants);
  return hit;
}

export function addGrantToCapsule({
  workspaceRoot,
  capsuleDir,
  relPath,
  packetVersion = "delta",
} = {}) {
  const n = normalizeRepoPath(relPath);
  if (!n || !isSourceContextPath(n)) return { ok: false, reason: "not_source" };
  const src = path.join(workspaceRoot, n);
  let st;
  try {
    st = fs.lstatSync(src);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (st.isSymbolicLink() || st.isDirectory()) {
    return { ok: false, reason: "not_file" };
  }
  const dest = path.join(capsuleDir, n);
  if (!copyFileNoFollow(src, dest)) return { ok: false, reason: "copy_rejected" };
  const grants = readCapsuleGrants(capsuleDir);
  grants.files = grants.files ?? [];
  if (!grants.files.some((f) => normalizeRepoPath(f.path) === n)) {
    grants.files.push({
      grant_id: `g_${grants.files.length + 1}`,
      path: n,
      hash: fileSha256(src),
      packet_version: packetVersion,
      consumed: false,
    });
  }
  writeCapsuleGrants(capsuleDir, grants);
  return { ok: true, path: n, hash: fileSha256(src) };
}

export function collectCapsuleOutput({
  capsuleDir,
  workspaceRoot,
  runId,
  phase,
  agentIndex = 0,
} = {}) {
  const candidates = [
    path.join(capsuleDir, CAPSULE_OUTPUT_REL),
    path.join(capsuleDir, "OUTPUT.md"),
  ];
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) return { ok: false, reason: "no_output" };
  const dest = path.join(
    workspaceRoot,
    ".cursor/aaac/state/runs",
    String(runId),
    "artifacts",
    `${phase}_agent_${Number(agentIndex) + 1}.md`,
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { ok: true, dest };
}

export function stripWorkspacePathFromText(text, workspaceRoot) {
  if (!text || !workspaceRoot) return text;
  const root = String(workspaceRoot).replace(/\\/g, "/").replace(/\/$/, "");
  return String(text).split(root).join("<workspace>");
}
