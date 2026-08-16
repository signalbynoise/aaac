/**
 * Resolve the repo that owns `.cursor/aaac` state.
 * Never treat a packaged `node_modules/@ludecker/aaac` tree as that repo.
 */
import fs from "fs";
import path from "path";

export const CURSOR_DIRNAME = ".cursor";
export const AAAC_DIRNAME = "aaac";
export const ENFORCEMENT_REL = path.join(CURSOR_DIRNAME, AAAC_DIRNAME, "enforcement.json");

export function isPackagedModuleDir(dir) {
  return /(^|\/|\\)node_modules(\/|\\)/.test(String(dir ?? ""));
}

export function rootsFromRepo(repoRoot) {
  const resolved = path.resolve(repoRoot);
  const cursorRoot = path.join(resolved, CURSOR_DIRNAME);
  const aaacRoot = path.join(cursorRoot, AAAC_DIRNAME);
  const stateRoot = path.join(aaacRoot, "state");
  return {
    repoRoot: resolved,
    cursorRoot,
    aaacRoot,
    stateRoot,
    runsRoot: path.join(stateRoot, "runs"),
  };
}

export function findWorkspaceRootFrom(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ENFORCEMENT_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function dogfoodRepoFromModuleDir(moduleDir) {
  if (!moduleDir || isPackagedModuleDir(moduleDir)) return null;
  const fourUp = path.resolve(moduleDir, "../../../..");
  if (fs.existsSync(path.join(fourUp, ENFORCEMENT_REL))) return fourUp;
  const cursorRoot = path.resolve(moduleDir, "../../..");
  const repoRoot = path.resolve(cursorRoot, "..");
  if (fs.existsSync(path.join(repoRoot, ENFORCEMENT_REL))) return repoRoot;
  return null;
}

/**
 * @param {{
 *   moduleDir?: string,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   workspaceRoot?: string | null,
 * }} [opts]
 */
export function resolveWorkspaceRoots(opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const override = opts.workspaceRoot || env.AAAC_WORKSPACE_ROOT;
  if (override) return rootsFromRepo(override);

  const fromModule = dogfoodRepoFromModuleDir(opts.moduleDir);
  if (fromModule) return rootsFromRepo(fromModule);

  const fromCwd = findWorkspaceRootFrom(cwd);
  if (fromCwd) return rootsFromRepo(fromCwd);

  return rootsFromRepo(cwd);
}
