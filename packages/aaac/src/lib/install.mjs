import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { copyDirRecursive, substituteInTree } from "./copy.mjs";
import { spawnNodeScript } from "./node-exec.mjs";
import { ensureDir } from "./paths.mjs";
import {
  runInstallSweep,
  snapshotProjectDocs,
} from "./sweep-project-docs.mjs";

const defaultPackageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function resolvePackageRoot(packageRoot) {
  if (packageRoot && typeof packageRoot === "string") {
    return path.resolve(packageRoot);
  }
  return defaultPackageRoot;
}

function templatesDir(packageRoot) {
  return path.join(packageRoot, "templates");
}

function generatorsDir(packageRoot) {
  return path.join(packageRoot, "src", "generators");
}

function writeInstallManifest(aaacDest, packageRoot) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const manifest = {
    package: pkg.name,
    version: pkg.version,
    installed_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(aaacDest, "install-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function runGenerators(cursorRoot, options = {}) {
  const pkgRoot = resolvePackageRoot(options.packageRoot);
  const dir = generatorsDir(pkgRoot);
  const graph = spawnNodeScript(
    path.join(dir, "generate-graph.mjs"),
    ["--root", cursorRoot],
  );
  if (graph.status !== 0) {
    throw new Error("generate-graph.mjs failed");
  }
  const commands = spawnNodeScript(
    path.join(dir, "generate-commands.mjs"),
    ["--root", cursorRoot],
  );
  if (commands.status !== 0) {
    throw new Error("generate-commands.mjs failed");
  }
}

function applyProjectSubstitutions(cursorDest, docsDest, projectName, docsRoot) {
  const replacements = {
    PROJECT_NAME: projectName,
    DOCS_ROOT: docsRoot.replace(/\/$/, ""),
  };
  substituteInTree(cursorDest, replacements);
  if (docsDest && fs.existsSync(docsDest)) {
    substituteInTree(docsDest, replacements);
  }
}

function copyTemplateDocs(packageRoot, docsDest) {
  const docsSrc = path.join(templatesDir(packageRoot), "docs");
  if (!fs.existsSync(docsSrc)) return;
  ensureDir(docsDest);
  for (const file of fs.readdirSync(docsSrc)) {
    fs.copyFileSync(path.join(docsSrc, file), path.join(docsDest, file));
  }
}

/**
 * Fresh install (or force reinstall with full `.cursor` backup).
 *
 * @param {{
 *   targetDir: string;
 *   projectName: string;
 *   docsRoot?: string;
 *   force?: boolean;
 *   packageRoot?: string;
 * }} options
 */
export function installAaac({
  targetDir,
  projectName,
  docsRoot = "docs",
  force = false,
  packageRoot,
}) {
  const pkgRoot = resolvePackageRoot(packageRoot);
  const resolvedTarget = path.resolve(targetDir);
  const cursorDest = path.join(resolvedTarget, ".cursor");
  const aaacDest = path.join(cursorDest, "aaac");
  const templates = templatesDir(pkgRoot);

  if (fs.existsSync(aaacDest) && !force) {
    throw new Error(
      `.cursor/aaac already exists at ${aaacDest}. Use --force to backup and replace.`,
    );
  }

  const beforeSweep = snapshotProjectDocs(resolvedTarget, { docsRoot });

  if (fs.existsSync(cursorDest) && force) {
    const backup = `${cursorDest}.aaac-backup-${Date.now()}`;
    fs.renameSync(cursorDest, backup);
    console.log(`Backed up existing .cursor to ${backup}`);
  }

  const cursorSrc = path.join(templates, "cursor");
  copyDirRecursive(cursorSrc, cursorDest);
  ensureDir(path.join(cursorDest, "commands"));
  ensureDir(path.join(aaacDest, "state", "runs"));
  ensureDir(path.join(aaacDest, "state", "active-runs"));

  const docsDest = path.join(resolvedTarget, docsRoot);
  copyTemplateDocs(pkgRoot, docsDest);

  applyProjectSubstitutions(cursorDest, docsDest, projectName, docsRoot);

  runGenerators(cursorDest, { packageRoot: pkgRoot });
  writeInstallManifest(aaacDest, pkgRoot);

  const sweep = runInstallSweep(resolvedTarget, {
    docsRoot,
    projectName,
    before: beforeSweep,
  });

  return { cursorDest, docsDest, sweepReportPath: sweep.reportPath };
}

/**
 * State-preserving upgrade: refresh framework files from templates without
 * wiping `.cursor/aaac/state/` or backing up the entire `.cursor` tree.
 *
 * @param {{
 *   targetDir: string;
 *   projectName: string;
 *   docsRoot?: string;
 *   packageRoot?: string;
 * }} options
 */
export function upgradeAaac({
  targetDir,
  projectName,
  docsRoot = "docs",
  packageRoot,
}) {
  const pkgRoot = resolvePackageRoot(packageRoot);
  const resolvedTarget = path.resolve(targetDir);
  const cursorDest = path.join(resolvedTarget, ".cursor");
  const aaacDest = path.join(cursorDest, "aaac");
  const cursorSrc = path.join(templatesDir(pkgRoot), "cursor");

  if (!fs.existsSync(aaacDest)) {
    throw new Error(
      `.cursor/aaac does not exist at ${aaacDest}. Use installAaac for a fresh install.`,
    );
  }
  if (!fs.existsSync(cursorSrc)) {
    throw new Error(`AAAC templates missing at ${cursorSrc}`);
  }

  const stateDir = path.join(aaacDest, "state");
  const stateBackup = fs.existsSync(stateDir)
    ? `${stateDir}.upgrade-backup-${Date.now()}`
    : null;
  if (stateBackup) {
    fs.renameSync(stateDir, stateBackup);
  }

  try {
    for (const entry of fs.readdirSync(cursorSrc, { withFileTypes: true })) {
      const srcPath = path.join(cursorSrc, entry.name);
      const destPath = path.join(cursorDest, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "aaac" && fs.existsSync(destPath)) {
          // Replace framework files inside aaac, then restore state below.
          for (const child of fs.readdirSync(srcPath, { withFileTypes: true })) {
            if (child.name === "state") continue;
            const childSrc = path.join(srcPath, child.name);
            const childDest = path.join(destPath, child.name);
            if (child.isDirectory()) {
              fs.rmSync(childDest, { recursive: true, force: true });
              copyDirRecursive(childSrc, childDest);
            } else {
              fs.copyFileSync(childSrc, childDest);
            }
          }
        } else {
          fs.rmSync(destPath, { recursive: true, force: true });
          copyDirRecursive(srcPath, destPath);
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    if (stateBackup) {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.renameSync(stateBackup, stateDir);
    } else {
      ensureDir(path.join(stateDir, "runs"));
      ensureDir(path.join(stateDir, "active-runs"));
    }

    ensureDir(path.join(cursorDest, "commands"));
    ensureDir(path.join(aaacDest, "state", "runs"));
    ensureDir(path.join(aaacDest, "state", "active-runs"));

    applyProjectSubstitutions(cursorDest, null, projectName, docsRoot);
    runGenerators(cursorDest, { packageRoot: pkgRoot });
    writeInstallManifest(aaacDest, pkgRoot);

    return {
      cursorDest,
      docsDest: path.join(resolvedTarget, docsRoot),
      sweepReportPath: null,
      upgraded: true,
    };
  } catch (err) {
    if (stateBackup && fs.existsSync(stateBackup) && !fs.existsSync(stateDir)) {
      try {
        fs.renameSync(stateBackup, stateDir);
      } catch {
        // best-effort restore
      }
    }
    throw err;
  }
}
