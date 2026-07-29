import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { resolveWorkspacePaths } from "./paths.mjs";

let libCache = new Map();
let contextBudgetCache = new Map();

export async function loadRunEngineLib(workspaceRoot) {
  if (libCache.has(workspaceRoot)) return libCache.get(workspaceRoot);

  const { runEngineDir } = resolveWorkspacePaths(workspaceRoot);
  process.env.AAAC_WORKSPACE_ROOT = workspaceRoot;
  const libPath = path.join(runEngineDir, "lib.mjs");
  const mod = await import(pathToFileURL(libPath).href);
  libCache.set(workspaceRoot, mod);
  return mod;
}

function readRunManifestFile(workspaceRoot, runId) {
  if (!runId) return null;
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const manifestPath = path.join(runsRoot, runId, "run.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeRunManifestFile(workspaceRoot, runId, manifest) {
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const manifestPath = path.join(runsRoot, runId, "run.json");
  manifest.updated_at = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

/**
 * Re-apply swarm target for one phase from latest complexity scores (gate phases after discover/plan).
 */
export async function refreshPhaseSwarmTarget(workspaceRoot, runId, phase) {
  const manifest = readRunManifestFile(workspaceRoot, runId);
  if (!manifest || !phase) return manifest;

  const { runEngineDir } = resolveWorkspacePaths(workspaceRoot);
  const { loadEnforcement } = await loadRunEngineLib(workspaceRoot);
  const { applySwarmTargetsToManifest } = await import(
    pathToFileURL(path.join(runEngineDir, "resolve-swarm-target.mjs")).href
  );
  applySwarmTargetsToManifest(manifest, [phase], loadEnforcement());
  return writeRunManifestFile(workspaceRoot, runId, manifest);
}

export async function getSwarmTarget(workspaceRoot, phase, manifest, { runId = null } = {}) {
  const live =
    runId != null ? readRunManifestFile(workspaceRoot, runId) ?? manifest : manifest;
  const fromManifest = live?.swarm?.target_agents?.[phase];
  if (fromManifest != null && fromManifest > 0) {
    return fromManifest;
  }

  const { runEngineDir } = resolveWorkspacePaths(workspaceRoot);
  const { loadEnforcement } = await loadRunEngineLib(workspaceRoot);
  const mod = await import(
    pathToFileURL(path.join(runEngineDir, "resolve-swarm-target.mjs")).href
  );
  const enforcement = loadEnforcement();
  return mod.resolveSwarmTarget(phase, live ?? manifest, enforcement) ?? 0;
}

/** @deprecated use getSwarmTarget */
export async function getSwarmMinimum(workspaceRoot, phase, manifest) {
  return getSwarmTarget(workspaceRoot, phase, manifest);
}

async function loadContextBudgetLib(workspaceRoot) {
  if (contextBudgetCache.has(workspaceRoot)) return contextBudgetCache.get(workspaceRoot);

  const { runEngineDir } = resolveWorkspacePaths(workspaceRoot);
  const mod = await import(pathToFileURL(path.join(runEngineDir, "context-budget.mjs")).href);
  contextBudgetCache.set(workspaceRoot, mod);
  return mod;
}

/** Required phase artifacts not yet on disk (post-swarm orchestrator checkpoint). */
export async function getMissingPhaseArtifacts(workspaceRoot, runId, phase, manifest) {
  const { loadEnforcement } = await loadRunEngineLib(workspaceRoot);
  const { resolvePhaseArtifacts } = await loadContextBudgetLib(workspaceRoot);
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const enforcement = loadEnforcement();
  const required = resolvePhaseArtifacts(phase, manifest, enforcement);
  return required.filter((rel) => !fs.existsSync(path.join(runsRoot, runId, rel)));
}
