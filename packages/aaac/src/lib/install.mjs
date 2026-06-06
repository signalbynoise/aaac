import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { copyDirRecursive, substituteInTree } from "./copy.mjs";
import {
  ensureDir,
  packageGeneratorsDir,
  packageTemplatesDir,
} from "./paths.mjs";

export function runGenerators(cursorRoot) {
  const generatorsDir = packageGeneratorsDir();
  const graph = spawnSync(
    process.execPath,
    [path.join(generatorsDir, "generate-graph.mjs"), "--root", cursorRoot],
    { stdio: "inherit" },
  );
  if (graph.status !== 0) {
    throw new Error("generate-graph.mjs failed");
  }
  const commands = spawnSync(
    process.execPath,
    [path.join(generatorsDir, "generate-commands.mjs"), "--root", cursorRoot],
    { stdio: "inherit" },
  );
  if (commands.status !== 0) {
    throw new Error("generate-commands.mjs failed");
  }
}

export function installAaac({
  targetDir,
  projectName,
  docsRoot,
  force = false,
}) {
  const resolvedTarget = path.resolve(targetDir);
  const cursorDest = path.join(resolvedTarget, ".cursor");
  const aaacDest = path.join(cursorDest, "aaac");
  const templates = packageTemplatesDir();

  if (fs.existsSync(aaacDest) && !force) {
    throw new Error(
      `.cursor/aaac already exists at ${aaacDest}. Use --force to backup and replace.`,
    );
  }

  if (fs.existsSync(cursorDest) && force) {
    const backup = `${cursorDest}.aaac-backup-${Date.now()}`;
    fs.renameSync(cursorDest, backup);
    console.log(`Backed up existing .cursor to ${backup}`);
  }

  const cursorSrc = path.join(templates, "cursor");
  copyDirRecursive(cursorSrc, cursorDest);
  ensureDir(path.join(cursorDest, "commands"));
  ensureDir(path.join(aaacDest, "state", "runs"));

  const docsDest = path.join(resolvedTarget, docsRoot);
  ensureDir(docsDest);
  const docsSrc = path.join(templates, "docs");
  for (const file of fs.readdirSync(docsSrc)) {
    fs.copyFileSync(path.join(docsSrc, file), path.join(docsDest, file));
  }

  const replacements = {
    PROJECT_NAME: projectName,
    DOCS_ROOT: docsRoot.replace(/\/$/, ""),
  };
  substituteInTree(cursorDest, replacements);
  substituteInTree(docsDest, replacements);

  runGenerators(cursorDest);

  return { cursorDest, docsDest };
}
