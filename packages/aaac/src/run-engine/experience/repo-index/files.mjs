/**
 * Repository file inventory and local import resolution.
 * Git is the SSOT for ignored files; filesystem walking is the fallback.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  "release",
  ".cursor",
  ".turbo",
  "playwright-report",
  "storybook-static",
  "scratch",
  "tmp",
  "temp",
  "vendor",
  "artifacts",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
]);

const SOURCE_ROOT_PRIORITY = new Map([
  ["src", 0],
  ["apps", 1],
  ["packages", 2],
  ["server", 3],
  ["api", 4],
  ["lib", 5],
]);

function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Test fixtures are not memory-graph nodes — agents retrieve production logic. */
export function isTestPath(file) {
  const relativePath = normalizePath(file);
  return (
    /(^|\/)(__tests__|tests?|e2e)\//.test(relativePath) ||
    /\.(test|spec)\.[^.]+$/.test(relativePath)
  );
}

function isCodeFile(file) {
  return CODE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function isSkippedPath(file) {
  return normalizePath(file)
    .split("/")
    .some((part) => SKIP_DIRS.has(part) || part.startsWith("."));
}

function filePriority(file) {
  const first = normalizePath(file).split("/")[0];
  return SOURCE_ROOT_PRIORITY.get(first) ?? 10;
}

function sortFiles(files) {
  return [...files].sort((a, b) => {
    const priority = filePriority(a) - filePriority(b);
    return priority || a.localeCompare(b);
  });
}

function listGitCodeFiles(root) {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const entries = output.split("\0").filter(Boolean).map(normalizePath);
    const files = entries.filter((file) => isCodeFile(file) && !isSkippedPath(file));
    for (const entry of entries) {
      const nestedRoot = path.join(root, entry);
      if (!fs.existsSync(nestedRoot) || !fs.statSync(nestedRoot).isDirectory()) continue;
      const nestedFiles = listGitCodeFiles(nestedRoot) ?? listFilesystemCodeFiles(nestedRoot);
      files.push(...nestedFiles.map((file) => normalizePath(path.join(entry, file))));
    }
    return files;
  } catch {
    return null;
  }
}

function listFilesystemCodeFiles(root, maxFiles = Number.POSITIVE_INFINITY) {
  const files = [];
  function walk(dir) {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(absolute);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = normalizePath(path.relative(root, absolute));
      if (isCodeFile(relative)) files.push(relative);
    }
  }
  walk(root);
  return files;
}

export function walkCodeFiles(root, maxFiles = 4000, options = {}) {
  const includeTests = options.includeTests === true;
  const files = listGitCodeFiles(root) ?? listFilesystemCodeFiles(root, maxFiles);
  const eligible = includeTests ? files : files.filter((file) => !isTestPath(file));
  return sortFiles([...new Set(eligible)]).slice(0, maxFiles);
}

export function extractImportSpecs(source) {
  const specs = [];
  const expressions = [
    /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // Dynamic import("…") / import('…', { with: … })
    /\bimport\s*\(\s*['"]([^'"]+)['"][^)]*\)/g,
    // Static template literal: import(`./chunk`)
    /\bimport\s*\(\s*`([^`${]+)`[^)]*\)/g,
  ];
  for (const expression of expressions) {
    let match;
    while ((match = expression.exec(source))) specs.push(match[1]);
  }
  return [...new Set(specs)];
}

/**
 * Strip // and /* *\/ comments without touching string contents
 * (naive regexes corrupt tsconfig paths like "@/*").
 */
function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonConfig(file) {
  try {
    return JSON.parse(stripJsonc(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function aliasesFromCompilerOptions(compiler, packagePrefix = "") {
  const aliases = [];
  const baseUrl = normalizePath(compiler.baseUrl ?? ".");
  const paths = compiler?.paths ?? {};
  const prefixJoin = (...parts) =>
    normalizePath(
      path.posix.join(...[packagePrefix, ...parts].filter((p) => p && p !== ".")),
    );

  for (const [pattern, targets] of Object.entries(paths)) {
    const target = String((Array.isArray(targets) ? targets[0] : targets) ?? "");
    if (!pattern || !target) continue;
    const wildcard = pattern.endsWith("/*") && target.endsWith("/*");
    const targetBody = wildcard ? target.slice(0, -1) : target;
    const joined = prefixJoin(baseUrl, targetBody);
    aliases.push({
      prefix: wildcard ? pattern.slice(0, -1) : pattern,
      target: joined.endsWith("/") || !wildcard ? joined : `${joined}`,
      wildcard,
    });
    // Ensure wildcard targets end with / for remainder concat in resolveImportPath
    if (wildcard && !aliases[aliases.length - 1].target.endsWith("/")) {
      aliases[aliases.length - 1].target += "/";
    }
  }
  if (baseUrl !== ".") {
    const baseTarget = prefixJoin(baseUrl);
    aliases.push({
      prefix: "",
      target: baseTarget.endsWith("/") ? baseTarget : `${baseTarget}/`,
      wildcard: true,
    });
  }
  return aliases;
}

function listTsconfigFiles(root) {
  const configNames = [
    "tsconfig.app.json",
    "tsconfig.json",
    "jsconfig.json",
    "tsconfig.base.json",
  ];
  const out = [];
  for (const name of configNames) {
    const configPath = path.join(root, name);
    if (fs.existsSync(configPath)) out.push({ abs: configPath, packagePrefix: "" });
  }
  for (const container of ["apps", "packages", "services"]) {
    const containerRoot = path.join(root, container);
    let entries;
    try {
      entries = fs.readdirSync(containerRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packagePrefix = normalizePath(path.posix.join(container, entry.name));
      for (const name of configNames) {
        const configPath = path.join(containerRoot, entry.name, name);
        if (!fs.existsSync(configPath)) continue;
        out.push({ abs: configPath, packagePrefix });
      }
    }
  }
  return out;
}

/**
 * Collect path aliases from workspace root and nested app/package tsconfigs.
 * Nested `@/*` maps are rewritten to workspace-relative targets.
 */
export function loadPathAliases(root) {
  const aliases = [];
  const seen = new Set();
  for (const { abs, packagePrefix } of listTsconfigFiles(root)) {
    const config = parseJsonConfig(abs);
    if (!config?.compilerOptions) continue;
    for (const alias of aliasesFromCompilerOptions(
      config.compilerOptions,
      packagePrefix,
    )) {
      const key = `${alias.prefix}\0${alias.target}\0${alias.wildcard}`;
      if (seen.has(key)) continue;
      seen.add(key);
      aliases.push(alias);
    }
  }
  return aliases;
}

function existingRepoPath(root, base) {
  const normalized = normalizePath(base);
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}.jsx`,
    `${normalized}.json`,
    path.posix.join(normalized, "index.ts"),
    path.posix.join(normalized, "index.tsx"),
    path.posix.join(normalized, "index.js"),
    path.posix.join(normalized, "index.mjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(root, candidate))) ?? null;
}

function packageEntry(packageRoot, manifest) {
  const exported = manifest?.exports?.["."] ?? manifest?.exports;
  const entry =
    (typeof exported === "string" ? exported : null) ??
    exported?.import ??
    exported?.default ??
    exported?.types ??
    manifest?.module ??
    manifest?.main ??
    manifest?.types;
  const candidates = [
    entry,
    "src/index.ts",
    "src/index.tsx",
    "src/index.js",
    "index.ts",
    "index.js",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = normalizePath(path.posix.join(packageRoot, String(candidate)));
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

export function loadWorkspacePackages(root) {
  const packages = new Map();
  for (const container of ["apps", "packages", "services"]) {
    const containerRoot = path.join(root, container);
    let entries;
    try {
      entries = fs.readdirSync(containerRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageRoot = path.join(containerRoot, entry.name);
      const manifest = parseJsonConfig(path.join(packageRoot, "package.json"));
      if (!manifest?.name) continue;
      const entryPath = packageEntry(packageRoot, manifest);
      packages.set(manifest.name, {
        root: normalizePath(path.relative(root, packageRoot)),
        entry: entryPath
          ? normalizePath(path.relative(root, entryPath))
          : null,
      });
    }
  }
  return packages;
}

export function resolveImportPath(
  fromRel,
  spec,
  root,
  aliases = [],
  workspacePackages = new Map(),
) {
  if (!spec || spec.startsWith("node:") || /^https?:/.test(spec)) return null;
  if (spec.startsWith(".")) {
    return existingRepoPath(root, path.posix.join(path.posix.dirname(fromRel), spec));
  }
  for (const alias of aliases) {
    const exactPrefix = alias.prefix.replace(/\/$/, "");
    if (spec !== exactPrefix && !spec.startsWith(alias.prefix)) continue;
    const remainder = spec.startsWith(alias.prefix)
      ? spec.slice(alias.prefix.length)
      : "";
    const resolved = existingRepoPath(root, `${alias.target}${remainder}`);
    if (resolved) return resolved;
  }
  for (const [packageName, workspacePackage] of workspacePackages) {
    if (spec === packageName && workspacePackage.entry) return workspacePackage.entry;
    if (!spec.startsWith(`${packageName}/`)) continue;
    const subpath = spec.slice(packageName.length + 1);
    const resolved = existingRepoPath(root, path.posix.join(workspacePackage.root, subpath));
    if (resolved) return resolved;
  }
  return null;
}
