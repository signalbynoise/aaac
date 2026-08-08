import path from "path";
import { createRequire } from "module";
import { installAaac, upgradeAaac } from "@ludecker/aaac/install";
import { getAaacStatus } from "./aaac-status.mjs";
import {
  checkAaacVersionUpdate,
  compareSemver,
  readBundledAaacVersion,
  readInstalledAaacVersion,
} from "./aaac-version.mjs";
import { fetchAaacPackageFromNpm } from "./aaac-npm-fetch.mjs";
import { listRuns } from "./dispatch.mjs";

const require = createRequire(import.meta.url);

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * @param {string} workspaceRoot
 * @returns {Promise<boolean>}
 */
export async function workspaceHasIncompleteRuns(workspaceRoot) {
  const status = getAaacStatus(workspaceRoot);
  if (status.status !== "ready") return false;
  try {
    const runs = await listRuns(workspaceRoot);
    return runs.some(
      (run) => run?.status && !TERMINAL_STATUSES.has(String(run.status)),
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} workspaceRoot
 * @param {import("./aaac-version.mjs").AaacVersionInfo | Awaited<ReturnType<typeof checkAaacVersionUpdate>>} versionCheck
 * @param {{ force?: boolean }} [options]
 */
export function resolveAaacEnsureAction(workspaceRoot, versionCheck, options = {}) {
  const status = getAaacStatus(workspaceRoot);
  const force = Boolean(options.force);

  if (status.status === "missing") {
    return { action: "install", reason: "missing", status };
  }

  if (status.status === "partial") {
    return { action: "force-install", reason: "partial", status };
  }

  const installed = versionCheck.installedVersion ?? readInstalledAaacVersion(workspaceRoot);
  if (!installed) {
    // Dogfood / source tree — do not overwrite without an install manifest.
    return { action: "skip", reason: "dogfood", status };
  }

  if (force) {
    return { action: "upgrade", reason: "force", status };
  }

  if (versionCheck.npmCheckFailed || !versionCheck.latestVersion) {
    return { action: "skip", reason: "npm-unavailable", status };
  }

  if (compareSemver(installed, versionCheck.latestVersion) < 0) {
    return { action: "upgrade", reason: "behind", status };
  }

  return { action: "skip", reason: "current", status };
}

/**
 * Resolve package root from npm latest, falling back to the bundled package.
 *
 * @param {{
 *   cacheDir?: string | null;
 *   fetchImpl?: typeof fetch;
 *   allowBundleFallback?: boolean;
 * }} [options]
 */
async function resolveInstallPackageRoot(options = {}) {
  const allowBundleFallback = options.allowBundleFallback !== false;
  try {
    const fetched = await fetchAaacPackageFromNpm("latest", {
      cacheDir: options.cacheDir,
      fetchImpl: options.fetchImpl,
    });
    return {
      packageRoot: fetched.packageRoot,
      version: fetched.version,
      source: fetched.fromCache ? "npm-cache" : "npm",
      npmFailed: false,
    };
  } catch (err) {
    if (!allowBundleFallback) throw err;
    const bundledVersion = readBundledAaacVersion();
    let packageRoot;
    try {
      const installPath = require.resolve("@ludecker/aaac/install");
      packageRoot = path.resolve(path.dirname(installPath), "..", "..");
    } catch {
      throw new Error(
        `npm fetch failed and bundled @ludecker/aaac is unavailable: ${err?.message ?? err}`,
      );
    }
    return {
      packageRoot,
      version: bundledVersion,
      source: "bundle",
      npmFailed: true,
      npmError: String(err?.message ?? err),
    };
  }
}

/**
 * Opt-in AAAC install for a connected workspace (Agentic OS).
 * Prefers npm latest; falls back to the bundled package when offline.
 *
 * @param {string} workspaceRoot
 * @param {{
 *   force?: boolean;
 *   projectName?: string;
 *   docsRoot?: string;
 *   cacheDir?: string | null;
 *   fetchImpl?: typeof fetch;
 * }} [options]
 */
export async function installAaacInWorkspace(workspaceRoot, options = {}) {
  const { force = false, projectName, docsRoot = "docs" } = options;
  const root = path.resolve(workspaceRoot);
  const before = getAaacStatus(root);

  if (before.status === "ready" && !force) {
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
  const pkg = await resolveInstallPackageRoot({
    cacheDir: options.cacheDir,
    fetchImpl: options.fetchImpl,
    allowBundleFallback: true,
  });

  const useForce = force || before.status === "partial" || before.status === "ready";
  const result =
    before.status === "ready" && force
      ? upgradeAaac({
          targetDir: root,
          projectName: resolvedName,
          docsRoot,
          packageRoot: pkg.packageRoot,
        })
      : installAaac({
          targetDir: root,
          projectName: resolvedName,
          docsRoot,
          force: useForce && before.status !== "missing",
          packageRoot: pkg.packageRoot,
        });

  const after = getAaacStatus(root);
  if (after.status !== "ready") {
    throw new Error(`AAAC install finished but workspace status is ${after.status}`);
  }

  return {
    ok: true,
    alreadyInstalled: false,
    status: after.status,
    packageSource: pkg.source,
    packageVersion: pkg.version,
    ...result,
  };
}

/**
 * Ensure workspace AAAC is installed/upgraded from npm when eligible.
 *
 * @param {string} workspaceRoot
 * @param {{
 *   projectName?: string;
 *   docsRoot?: string;
 *   cacheDir?: string | null;
 *   fetchImpl?: typeof fetch;
 *   force?: boolean;
 *   skipIncompleteRunCheck?: boolean;
 * }} [options]
 */
export async function ensureAaacCurrent(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  const docsRoot = options.docsRoot ?? "docs";
  const projectName = options.projectName ?? (path.basename(root) || "my-project");
  const versionCheck = await checkAaacVersionUpdate(root);
  const decision = resolveAaacEnsureAction(root, versionCheck, {
    force: options.force,
  });

  /** @type {import("./aaac-status.mjs").AaacStatus} */
  let aaacStatus = decision.status;

  const base = {
    ok: true,
    updated: false,
    action: decision.action,
    reason: decision.reason,
    fromVersion: versionCheck.installedVersion ?? versionCheck.bundledVersion,
    toVersion: versionCheck.latestVersion,
    aaacStatus: { ...aaacStatus, versionCheck },
    versionCheck,
  };

  if (decision.action === "skip") {
    return base;
  }

  if (!options.skipIncompleteRunCheck) {
    const busy = await workspaceHasIncompleteRuns(root);
    if (busy) {
      return {
        ...base,
        action: "skip",
        reason: "incomplete-runs",
      };
    }
  }

  let pkg;
  try {
    pkg = await resolveInstallPackageRoot({
      cacheDir: options.cacheDir,
      fetchImpl: options.fetchImpl,
      // Fresh/partial installs may fall back to bundle; upgrades require npm.
      allowBundleFallback: decision.action !== "upgrade",
    });
  } catch (err) {
    return {
      ...base,
      ok: false,
      action: "skip",
      reason: "npm-unavailable",
      error: String(err?.message ?? err),
      versionCheck: { ...versionCheck, npmCheckFailed: true },
      aaacStatus: {
        ...aaacStatus,
        versionCheck: { ...versionCheck, npmCheckFailed: true },
      },
    };
  }

  if (pkg.npmFailed && decision.action === "upgrade") {
    return {
      ...base,
      action: "skip",
      reason: "npm-unavailable",
      versionCheck: { ...versionCheck, npmCheckFailed: true },
      aaacStatus: {
        ...aaacStatus,
        versionCheck: { ...versionCheck, npmCheckFailed: true },
      },
    };
  }

  const fromVersion =
    readInstalledAaacVersion(root) ?? versionCheck.bundledVersion;

  if (decision.action === "upgrade") {
    upgradeAaac({
      targetDir: root,
      projectName,
      docsRoot,
      packageRoot: pkg.packageRoot,
    });
  } else {
    installAaac({
      targetDir: root,
      projectName,
      docsRoot,
      force: decision.action === "force-install",
      packageRoot: pkg.packageRoot,
    });
  }

  const afterCheck = await checkAaacVersionUpdate(root);
  aaacStatus = getAaacStatus(root);

  return {
    ok: true,
    updated: true,
    action: decision.action,
    reason: decision.reason,
    fromVersion,
    toVersion: pkg.version ?? afterCheck.installedVersion,
    packageSource: pkg.source,
    aaacStatus: { ...aaacStatus, versionCheck: afterCheck },
    versionCheck: afterCheck,
  };
}
