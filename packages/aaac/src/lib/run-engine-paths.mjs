import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveRunEngineScript(scriptName, targetDir = process.cwd()) {
  const projectScript = path.join(
    targetDir,
    ".cursor",
    "aaac",
    "scripts",
    "run-engine",
    scriptName,
  );
  if (fs.existsSync(projectScript)) return projectScript;
  const bundled = path.join(packageRoot, "src", "run-engine", scriptName);
  if (fs.existsSync(bundled)) return bundled;
  throw new Error(`Run engine script not found: ${scriptName}`);
}

export function runEngineScript(scriptName, argv, targetDir = process.cwd()) {
  const scriptPath = resolveRunEngineScript(scriptName, targetDir);
  const result = spawnSync(process.execPath, [scriptPath, ...argv], {
    stdio: "inherit",
    cwd: targetDir,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
