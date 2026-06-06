import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function parseArgs(argv) {
  const args = { root: null, yes: false, dir: null, force: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) {
      args.root = argv[++i];
    } else if (arg === "--dir" && argv[i + 1]) {
      args.dir = argv[++i];
    } else if (arg === "--yes" || arg === "-y") {
      args.yes = true;
    } else if (arg === "--force") {
      args.force = true;
    }
  }
  return args;
}

/** Resolve `.cursor` root (parent of `aaac/`). */
export function resolveCursorRoot(rootArg) {
  if (rootArg) {
    const resolved = path.resolve(rootArg);
    if (path.basename(resolved) === "aaac") {
      return path.dirname(resolved);
    }
    return resolved;
  }
  return path.resolve(process.cwd(), ".cursor");
}

export function aaacDir(cursorRoot) {
  return path.join(cursorRoot, "aaac");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function packageTemplatesDir() {
  return path.join(packageRoot, "templates");
}

export function packageGeneratorsDir() {
  return path.join(packageRoot, "src", "generators");
}
