import fs from "fs";
import path from "path";

/** @typedef {'missing' | 'partial' | 'ready'} AaacInstallStatus */

/**
 * @typedef {Object} AaacStatus
 * @property {AaacInstallStatus} status
 * @property {string} workspaceRoot
 * @property {string} aaacRoot
 * @property {string} message
 */

/**
 * @param {string} workspaceRoot
 * @returns {{
 *   workspaceRoot: string;
 *   cursorRoot: string;
 *   aaacRoot: string;
 *   runEngineDir: string;
 *   runsRoot: string;
 *   sessionsDir: string;
 * }}
 */
export function computeWorkspacePaths(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const cursorRoot = path.join(root, ".cursor");
  const aaacRoot = path.join(cursorRoot, "aaac");
  const runEngineDir = path.join(aaacRoot, "scripts", "run-engine");

  return {
    workspaceRoot: root,
    cursorRoot,
    aaacRoot,
    runEngineDir,
    runsRoot: path.join(aaacRoot, "state", "runs"),
    sessionsDir: path.join(aaacRoot, "state", "sessions"),
  };
}

/**
 * Non-throwing AAAC install probe for a workspace directory.
 * @param {string} workspaceRoot
 * @returns {AaacStatus}
 */
export function getAaacStatus(workspaceRoot) {
  const paths = computeWorkspacePaths(workspaceRoot);
  const { aaacRoot, runEngineDir } = paths;
  const registryPath = path.join(aaacRoot, "runtime-registry.json");
  const dispatchScript = path.join(runEngineDir, "dispatch-run.mjs");

  if (!fs.existsSync(aaacRoot)) {
    return {
      status: "missing",
      workspaceRoot: paths.workspaceRoot,
      aaacRoot,
      message: "AAAC is not installed in this workspace.",
    };
  }

  if (!fs.existsSync(runEngineDir) || !fs.existsSync(dispatchScript)) {
    return {
      status: "partial",
      workspaceRoot: paths.workspaceRoot,
      aaacRoot,
      message: "AAAC is partially installed (run engine missing).",
    };
  }

  if (!fs.existsSync(registryPath)) {
    return {
      status: "partial",
      workspaceRoot: paths.workspaceRoot,
      aaacRoot,
      message:
        "AAAC is partially installed (command registry missing). Reinstall or run generate.",
    };
  }

  return {
    status: "ready",
    workspaceRoot: paths.workspaceRoot,
    aaacRoot,
    message: "AAAC is ready.",
  };
}
