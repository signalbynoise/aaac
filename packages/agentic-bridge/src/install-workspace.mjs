import path from "path";
import { installAaac } from "@ludecker/aaac/install";
import { getAaacStatus } from "./aaac-status.mjs";

/**
 * Opt-in AAAC install for a connected workspace (Agentic OS).
 * @param {string} workspaceRoot
 * @param {{ force?: boolean; projectName?: string; docsRoot?: string }} [options]
 */
export function installAaacInWorkspace(workspaceRoot, options = {}) {
  const { force = false, projectName, docsRoot = "docs" } = options;
  const root = path.resolve(workspaceRoot);
  const before = getAaacStatus(root);

  if (before.status === "ready") {
    return {
      ok: true,
      alreadyInstalled: true,
      status: before.status,
      cursorDest: path.join(root, ".cursor"),
      docsDest: path.join(root, docsRoot),
      sweepReportPath: null,
    };
  }

  if (before.status === "partial" && !force) {
    throw new Error(
      "AAAC is partially installed in this workspace. Confirm repair to backup and reinstall.",
    );
  }

  const resolvedName = projectName ?? (path.basename(root) || "my-project");

  const result = installAaac({
    targetDir: root,
    projectName: resolvedName,
    docsRoot,
    force: force || before.status === "partial",
  });

  const after = getAaacStatus(root);
  if (after.status !== "ready") {
    throw new Error(`AAAC install finished but workspace status is ${after.status}`);
  }

  return {
    ok: true,
    alreadyInstalled: false,
    status: after.status,
    ...result,
  };
}
