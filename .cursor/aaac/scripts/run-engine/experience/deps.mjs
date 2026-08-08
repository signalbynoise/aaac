/**
 * Resolve optional native / heavy deps from @ludecker/aaac or workspace root.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { REPO_ROOT } from "../lib.mjs";

const PACKAGE_JSON_CANDIDATES = [
  path.join(REPO_ROOT, "packages", "aaac", "package.json"),
  path.join(REPO_ROOT, "package.json"),
  path.join(REPO_ROOT, "node_modules", "@ludecker", "aaac", "package.json"),
];

function requireFrom(pkgJsonPath, name) {
  if (!fs.existsSync(pkgJsonPath)) return null;
  const req = createRequire(pkgJsonPath);
  // Suppress noisy native-binding diagnostics from better-sqlite3 / usearch
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    return req(name);
  } catch {
    return null;
  } finally {
    process.stderr.write = errWrite;
  }
}

/** @returns {any|null} */
export function tryRequireDep(name) {
  for (const pkg of PACKAGE_JSON_CANDIDATES) {
    const mod = requireFrom(pkg, name);
    if (mod) return mod;
  }
  return null;
}
