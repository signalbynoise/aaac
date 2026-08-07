import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { parse as parseYaml } from "yaml";
import { fileURLToPath } from "url";

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const TIER_ORDER = ["required", "recommended", "optional"];

/**
 * @param {string} [aaacRootOrFile]
 * @returns {{ version: number, prerequisites: object[] }}
 */
export function loadExternalPrerequisites(aaacRootOrFile) {
  const candidates = [];
  if (aaacRootOrFile) {
    const resolved = path.resolve(aaacRootOrFile);
    if (resolved.endsWith(".yaml") || resolved.endsWith(".yml")) {
      candidates.push(resolved);
    } else {
      candidates.push(path.join(resolved, "external-prerequisites.yaml"));
      candidates.push(path.join(resolved, "aaac", "external-prerequisites.yaml"));
    }
  }
  candidates.push(
    path.join(packageRoot, "templates", "cursor", "aaac", "external-prerequisites.yaml"),
  );

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const data = parseYaml(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(data?.prerequisites) ? data.prerequisites : [];
    return {
      version: Number(data?.version) || 1,
      prerequisites: list,
      sourcePath: file,
    };
  }

  return { version: 1, prerequisites: [], sourcePath: null };
}

/**
 * @param {{ prerequisites?: object[] }} catalog
 * @returns {string}
 */
export function formatExternalPrerequisitesMarkdown(catalog, installOutcomes = []) {
  const items = catalog?.prerequisites ?? [];
  const outcomeById = new Map(
    (installOutcomes ?? []).map((o) => [o.id, o]),
  );
  const lines = ["## External prerequisites", ""];

  if (items.length === 0) {
    lines.push("_No external prerequisites catalog found._", "");
    return lines.join("\n");
  }

  for (const tier of TIER_ORDER) {
    const group = items.filter((p) => p.tier === tier);
    if (group.length === 0) continue;
    lines.push(`### ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`, "");
    for (const item of group) {
      const installable = item.installable
        ? "installable via `aaac init`"
        : "manual setup";
      lines.push(`- **${item.name}** (\`${item.id}\`, ${installable})`);
      if (item.why) lines.push(`  - Why: ${item.why}`);
      if (item.manual_hint) lines.push(`  - Hint: ${item.manual_hint}`);
      const outcome = outcomeById.get(item.id);
      if (outcome) {
        lines.push(`  - Install result: ${outcome.status}${outcome.detail ? ` — ${outcome.detail}` : ""}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * @param {{ prerequisites?: object[] }} catalog
 * @returns {string}
 */
export function formatExternalPrerequisitesConsole(catalog) {
  const items = catalog?.prerequisites ?? [];
  const lines = ["", "External prerequisites for full AAAC operation:", ""];
  for (const tier of TIER_ORDER) {
    const group = items.filter((p) => p.tier === tier);
    if (group.length === 0) continue;
    lines.push(`${tier.toUpperCase()}:`);
    for (const item of group) {
      const tag = item.installable ? " [can install]" : "";
      lines.push(`  - ${item.name}${tag}`);
      if (item.why) lines.push(`      ${item.why}`);
      if (!item.installable && item.manual_hint) {
        lines.push(`      → ${item.manual_hint}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * @param {string} targetDir
 * @returns {'pnpm' | 'yarn' | 'npm'}
 */
export function detectPackageManager(targetDir) {
  const root = path.resolve(targetDir);
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

/**
 * @param {string} targetDir
 * @param {string} packageName
 */
export function isNpmPackageInstalled(targetDir, packageName) {
  try {
    const pkgPath = path.join(path.resolve(targetDir), "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return Boolean(
      pkg.dependencies?.[packageName] ||
        pkg.devDependencies?.[packageName] ||
        pkg.optionalDependencies?.[packageName],
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} packageManager
 * @param {string} packageName
 */
export function buildDevDepInstallArgs(packageManager, packageName) {
  if (packageManager === "pnpm") return ["add", "-D", packageName];
  if (packageManager === "yarn") return ["add", "-D", packageName];
  return ["install", "--save-dev", packageName];
}

/**
 * @param {string} targetDir
 * @param {string} packageName
 * @param {{ packageManager?: string, spawnImpl?: typeof spawnSync }} [options]
 */
export function installNpmDevDependency(targetDir, packageName, options = {}) {
  const cwd = path.resolve(targetDir);
  const packageManager = options.packageManager ?? detectPackageManager(cwd);
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const args = buildDevDepInstallArgs(packageManager, packageName);

  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    const name = path.basename(cwd) || "project";
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      `${JSON.stringify({ name, private: true }, null, 2)}\n`,
    );
  }

  const result = spawnImpl(packageManager, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const command = `${packageManager} ${args.join(" ")}`;
  if (result.status !== 0) {
    return {
      ok: false,
      packageManager,
      command,
      error: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    };
  }

  return { ok: true, packageManager, command };
}

/**
 * Prompt and install installable prerequisites.
 *
 * @param {string} targetDir
 * @param {{
 *   catalog?: ReturnType<typeof loadExternalPrerequisites>;
 *   interactive?: boolean;
 *   askFn?: (q: string, def?: string) => Promise<string>;
 *   installFn?: typeof installNpmDevDependency;
 * }} [options]
 */
export async function promptAndInstallPrerequisites(targetDir, options = {}) {
  const catalog =
    options.catalog ??
    loadExternalPrerequisites(path.join(targetDir, ".cursor", "aaac"));
  const interactive = Boolean(options.interactive);
  const askFn = options.askFn;
  const installFn = options.installFn ?? installNpmDevDependency;
  /** @type {{ id: string, status: string, detail?: string }[]} */
  const outcomes = [];

  const installable = (catalog.prerequisites ?? []).filter(
    (p) => p.installable && p.install?.kind === "npm-devdep" && p.install?.package,
  );

  for (const item of installable) {
    const pkgName = item.install.package;
    if (isNpmPackageInstalled(targetDir, pkgName)) {
      outcomes.push({
        id: item.id,
        status: "already_installed",
        detail: `${pkgName} already in package.json`,
      });
      continue;
    }

    if (!interactive || typeof askFn !== "function") {
      outcomes.push({
        id: item.id,
        status: "skipped_noninteractive",
        detail: item.manual_hint || `Install later: add -D ${pkgName}`,
      });
      continue;
    }

    const answer = await askFn(
      `Install ${item.name} (${pkgName}) as a devDependency?`,
      "Y",
    );
    const normalized = String(answer || "Y").trim().toLowerCase();
    if (normalized === "n" || normalized === "no") {
      outcomes.push({
        id: item.id,
        status: "declined",
        detail: item.manual_hint || `Skipped ${pkgName}`,
      });
      continue;
    }

    console.log(`\nInstalling ${pkgName}…`);
    const result = installFn(targetDir, pkgName);
    if (result.ok) {
      outcomes.push({
        id: item.id,
        status: "installed",
        detail: result.command,
      });
      console.log(`Installed ${pkgName} via \`${result.command}\`.`);
    } else {
      outcomes.push({
        id: item.id,
        status: "failed",
        detail: result.error,
      });
      console.log(
        `Could not install ${pkgName}. Run manually:\n  ${result.command}\n  (${result.error})`,
      );
    }
  }

  return { catalog, outcomes };
}
