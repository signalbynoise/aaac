/**
 * Resolve optional native / heavy deps from @ludecker/aaac or workspace root.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REPO_ROOT } from "../lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_REQUIRE = createRequire(import.meta.url);

/**
 * Walk parents for package.json belonging to @ludecker/aaac (src or installed copy).
 */
function findAaacPackageJson() {
  let dir = HERE;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (pkg?.name === "@ludecker/aaac" || pkg?.dependencies?.usearch) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const PACKAGE_JSON_CANDIDATES = [
  findAaacPackageJson(),
  path.join(REPO_ROOT, "packages", "aaac", "package.json"),
  path.join(REPO_ROOT, "package.json"),
  path.join(REPO_ROOT, "node_modules", "@ludecker", "aaac", "package.json"),
].filter(Boolean);

function withSilencedStderr(fn) {
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    return fn();
  } finally {
    process.stderr.write = errWrite;
  }
}

function requireFrom(pkgJsonPath, name) {
  if (!fs.existsSync(pkgJsonPath)) return null;
  return withSilencedStderr(() => {
    try {
      return createRequire(pkgJsonPath)(name);
    } catch {
      return null;
    }
  });
}

/**
 * Host apps (Agentic OS) depend on @ludecker/aaac + usearch; template copies under
 * `.cursor/aaac` do not. Resolve via host entry when provided / discoverable.
 */
function requireFromHostAaac(name) {
  const resolveBases = [
    process.env.AAAC_HOST_AAAC_ENTRY,
    process.env.AAAC_DEPS_ROOT,
    process.cwd(),
    REPO_ROOT,
  ].filter(Boolean);

  return withSilencedStderr(() => {
    for (const base of resolveBases) {
      try {
        // base may be package entry (.mjs) or a directory / package.json
        if (base.endsWith(".mjs") || base.endsWith(".js") || base.endsWith(".cjs")) {
          const mod = createRequire(base)(name);
          if (mod) return mod;
          continue;
        }
        const aaacEntry = MODULE_REQUIRE.resolve("@ludecker/aaac", {
          paths: [base, path.join(base, "node_modules")],
        });
        const mod = createRequire(aaacEntry)(name);
        if (mod) return mod;
      } catch {
        // try next
      }
      try {
        const pkgJson = base.endsWith("package.json")
          ? base
          : path.join(base, "package.json");
        const mod = requireFrom(pkgJson, name);
        if (mod) return mod;
      } catch {
        // try next
      }
    }
    return null;
  });
}

/** @returns {any|null} */
export function tryRequireDep(name) {
  // 1) Host app's @ludecker/aaac dependency tree (Agentic OS Electron main / spawn)
  const fromHost = requireFromHostAaac(name);
  if (fromHost) return fromHost;

  // 2) Resolution from this module (works when running inside the npm package)
  const fromModule = withSilencedStderr(() => {
    try {
      return MODULE_REQUIRE(name);
    } catch {
      return null;
    }
  });
  if (fromModule) return fromModule;

  // 3) Known package.json candidates
  for (const pkg of PACKAGE_JSON_CANDIDATES) {
    const mod = requireFrom(pkg, name);
    if (mod) return mod;
  }
  return null;
}
