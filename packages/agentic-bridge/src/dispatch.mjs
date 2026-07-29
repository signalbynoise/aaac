import fs from "fs";
import path from "path";
import { createLogger } from "./logger.mjs";
import { runEngineScript, parseJsonStdout, resolveWorkspacePaths } from "./paths.mjs";
import { normalizeRunManifestReadModel } from "./run-manifest-read-model.mjs";

const log = createLogger("agentic-bridge:dispatch");

export async function dispatchRun(workspaceRoot, prompt, { sessionId = null } = {}) {
  log.info("dispatch", "Dispatching run", { prompt, sessionId });

  const argv = [prompt, "--json"];
  if (sessionId) argv.push("--session-id", sessionId);

  const result = await runEngineScript(workspaceRoot, "dispatch-run.mjs", argv);
  if (!result.ok) {
    log.error("dispatch", "Dispatch failed", { stderr: result.stderr });
    throw new Error(result.stderr || "dispatch-run failed");
  }

  const payload = parseJsonStdout(result.stdout);
  if (!payload?.ok) {
    throw new Error(payload?.error ?? "dispatch-run returned error");
  }

  log.info("dispatch", "Run created", { runId: payload.run_id });
  return payload;
}

export async function listRuns(workspaceRoot, { status = null } = {}) {
  const argv = ["--json"];
  if (status) argv.push("--status", status);

  const result = await runEngineScript(workspaceRoot, "list-runs.mjs", argv);
  if (!result.ok) {
    throw new Error(result.stderr || "list-runs failed");
  }

  return parseJsonStdout(result.stdout)?.runs ?? [];
}

export async function approveRun(workspaceRoot, runId, { approve = true, reason = null } = {}) {
  const argv = [runId, approve ? "--approve" : "--reject", "--json"];
  if (reason) argv.push("--reason", reason);

  const result = await runEngineScript(workspaceRoot, "approve-run.mjs", argv);
  if (!result.ok) {
    throw new Error(result.stderr || "approve-run failed");
  }

  return parseJsonStdout(result.stdout);
}

export async function advancePhase(workspaceRoot, runId, completedPhase, { force = false } = {}) {
  const argv = [runId, completedPhase];
  if (force) argv.push("--force");

  const result = await runEngineScript(workspaceRoot, "advance-phase.mjs", argv);
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function resumeRun(workspaceRoot, runId) {
  log.info("resume", "Resuming run", { runId });

  const result = await runEngineScript(workspaceRoot, "resume-run.mjs", [runId, "--json"]);
  if (!result.ok) {
    log.error("resume", "Resume failed", { runId, stderr: result.stderr });
    throw new Error(result.stderr || "resume-run failed");
  }

  const payload = parseJsonStdout(result.stdout);
  if (!payload?.ok) {
    throw new Error(payload?.error ?? "resume-run returned error");
  }

  log.info("resume", "Run resumed", { runId, phase: payload.phase });
  return payload;
}

export function readRunManifestForExecution(workspaceRoot, runId) {
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const manifestPath = path.join(runsRoot, runId, "run.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

export function readRunManifest(workspaceRoot, runId) {
  const manifest = readRunManifestForExecution(workspaceRoot, runId);
  return manifest
    ? normalizeRunManifestReadModel(workspaceRoot, manifest)
    : null;
}

export function getRunManifest(workspaceRoot, runId) {
  return readRunManifest(workspaceRoot, runId);
}
