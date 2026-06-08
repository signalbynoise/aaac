import fs from "fs";
import path from "path";

/** @typedef {'docs' | 'rules' | 'framework'} SweepCategory */

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".turbo",
  ".cache",
]);

const DOC_DIR_NAMES = new Set(["docs", "doc", "documentation"]);

const ROOT_DOC_FILES = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
]);

const AAAC_TEMPLATE_DOCS = new Set([
  "master_rules.md",
  "project_context.md",
  "ui_design.md",
  "architecture.md",
  "agentic_architecture.md",
]);

const FRAMEWORK_PREFIXES = [
  ".cursor/aaac/",
  ".cursor/skills/",
  ".cursor/agents/",
  ".cursor/policies/",
  ".cursor/commands/",
];

const RULES_PREFIXES = [".cursor/rules/"];

const MARKDOWN_EXT = /\.(md|mdc)$/i;

/**
 * @param {string} root
 * @param {{ docsRoot?: string; includeFramework?: boolean }} [options]
 */
export function snapshotProjectDocs(root, options = {}) {
  return sweepProjectDocs(root, { ...options, includeFramework: false });
}

/**
 * @param {string} root
 * @param {{ docsRoot?: string; includeFramework?: boolean }} [options]
 */
export function sweepProjectDocs(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const docsRoot = normalizeRel(options.docsRoot ?? "docs");
  const includeFramework = options.includeFramework !== false;
  /** @type {Record<SweepCategory, string[]>} */
  const inventory = { docs: [], rules: [], framework: [] };

  walk(resolvedRoot, "", (rel, isDir) => {
    if (isDir) {
      if (SKIP_DIR_NAMES.has(path.basename(rel))) return "skip";
      if (rel.includes(".cursor/aaac/state/runs")) return "skip";
      return;
    }
    if (!MARKDOWN_EXT.test(rel)) return;

    const category = classify(rel, docsRoot, includeFramework);
    if (category) inventory[category].push(rel);
  });

  for (const key of Object.keys(inventory)) {
    inventory[key].sort();
  }
  return inventory;
}

/**
 * @param {{
 *   before: Record<SweepCategory, string[]>;
 *   after: Record<SweepCategory, string[]>;
 *   docsRoot: string;
 *   projectName?: string;
 *   installedAt?: string;
 * }} ctx
 */
export function buildRecommendations(ctx) {
  const { before, after, docsRoot } = ctx;
  const recs = [];
  const docsRootNorm = normalizeRel(docsRoot);

  const overwritten = before.docs.filter((rel) => {
    const base = path.basename(rel);
    return (
      AAAC_TEMPLATE_DOCS.has(base) &&
      after.docs.includes(`${docsRootNorm}/${base}`)
    );
  });

  if (overwritten.length > 0) {
    recs.push({
      kind: "review_overwrite",
      message: `These doc paths existed before init and were replaced by AAAC templates: ${overwritten.join(", ")}. Review content if you had custom rules there (restore from backup or merge manually).`,
    });
  }

  const extraDocDirs = new Set();
  for (const rel of after.docs) {
    const top = rel.split("/")[0];
    if (
      DOC_DIR_NAMES.has(top) &&
      top !== docsRootNorm &&
      !rel.startsWith(`${docsRootNorm}/`)
    ) {
      extraDocDirs.add(top);
    }
  }
  if (extraDocDirs.size > 0) {
    recs.push({
      kind: "extra_doc_dirs",
      message: `Additional documentation directories found: ${[...extraDocDirs].join(", ")}. AAAC policies point at ${docsRootNorm}/ — add SSOT anchors in ${docsRootNorm}/project_context.md if those dirs hold project truth.`,
    });
  }

  if (after.rules.some((r) => r === "AGENTS.md" || r.endsWith("/AGENTS.md"))) {
    recs.push({
      kind: "agents_md",
      message:
        "AGENTS.md is present. Cursor loads it alongside AAAC policies — keep both aligned or document division of responsibility in project_context.md.",
    });
  }

  const customRules = after.rules.filter((r) =>
    r.startsWith(".cursor/rules/"),
  );
  const aaacRule = customRules.find((r) =>
    r.includes("aaac-enforcement"),
  );
  if (customRules.length > 1) {
    recs.push({
      kind: "cursor_rules",
      message: `${customRules.length} Cursor rule files under .cursor/rules/. Review for overlap with docs/master_rules.md${aaacRule ? " and aaac-enforcement" : ""}.`,
    });
  }

  const projectContext = `${docsRootNorm}/project_context.md`;
  if (after.docs.includes(projectContext)) {
    recs.push({
      kind: "fill_project_context",
      message: `Fill in ${projectContext} with your repo paths and SSOT anchors when ready — until then agents use generic master rules only.`,
    });
  }

  const archPaths = after.docs.filter((rel) =>
    /architecture\.md$/i.test(rel),
  );
  if (archPaths.length > 1) {
    recs.push({
      kind: "multiple_architecture",
      message: `Multiple architecture docs: ${archPaths.join(", ")}. Pick one SSOT for structure or cross-link from ${docsRootNorm}/architecture.md.`,
    });
  }

  if (before.docs.length === 0 && before.rules.length === 0) {
    recs.push({
      kind: "greenfield",
      message:
        "No pre-existing project docs or Cursor rules detected — AAAC template docs are your starting SSOT.",
    });
  } else {
    recs.push({
      kind: "no_auto_merge",
      message:
        "Init did not merge or alias any existing files. This report is informational only — wire existing docs into project_context.md manually if needed.",
    });
  }

  return recs;
}

/**
 * @param {Parameters<typeof buildRecommendations>[0]} ctx
 */
export function formatInstallSweepReport(ctx) {
  const { after, docsRoot, projectName = "project", installedAt } = ctx;
  const recommendations = buildRecommendations(ctx);
  const lines = [
    "# AAAC install — docs / rules / framework inventory",
    "",
    `Project: **${projectName}**`,
    installedAt ? `Generated: ${installedAt}` : "",
    "",
    "Read-only sweep after `aaac init`. No merges or aliases were applied.",
    "",
    "## Summary",
    "",
    `| Category | Files |`,
    `|----------|------:|`,
    `| Docs | ${after.docs.length} |`,
    `| Rules | ${after.rules.length} |`,
    `| Framework (AAAC) | ${after.framework.length} |`,
    "",
    "## Docs",
    "",
  ];

  lines.push(
    ...(after.docs.length
      ? after.docs.map((f) => `- \`${f}\``)
      : ["_None found._"]),
  );
  lines.push("", "## Rules", "");
  lines.push(
    ...(after.rules.length
      ? after.rules.map((f) => `- \`${f}\``)
      : ["_None found._"]),
  );
  lines.push("", "## Framework (AAAC markdown)", "");
  lines.push(
    ...(after.framework.length
      ? after.framework.map((f) => `- \`${f}\``)
      : ["_None found._"]),
  );

  lines.push("", "## Recommendations", "");
  for (const [i, rec] of recommendations.entries()) {
    lines.push(`${i + 1}. **${rec.kind}** — ${rec.message}`);
  }
  lines.push(
    "",
    "## Next steps",
    "",
    `- Edit \`${normalizeRel(docsRoot)}/project_context.md\` for project-specific paths.`,
    "- Enable Cursor Hooks (Settings → Hooks) and restart Cursor.",
    "- Optional: add domain resolvers in `.cursor/aaac/graph.project.yaml`.",
    "",
  );

  return `${lines.filter((l) => l !== undefined).join("\n")}\n`;
}

/**
 * @param {string} targetDir
 * @param {string} markdown
 * @returns {string} absolute report path
 */
export function writeInstallSweepReport(targetDir, markdown) {
  const reportDir = path.join(targetDir, ".cursor", "aaac", "state");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "install-sweep-report.md");
  fs.writeFileSync(reportPath, markdown);
  return reportPath;
}

/**
 * @param {string} root
 * @param {{ docsRoot: string; projectName: string; before?: ReturnType<typeof snapshotProjectDocs> }} params
 */
export function runInstallSweep(root, params) {
  const after = sweepProjectDocs(root, {
    docsRoot: params.docsRoot,
    includeFramework: true,
  });
  const before =
    params.before ??
    snapshotProjectDocs(root, { docsRoot: params.docsRoot });
  const markdown = formatInstallSweepReport({
    before,
    after,
    docsRoot: params.docsRoot,
    projectName: params.projectName,
    installedAt: new Date().toISOString(),
  });
  const reportPath = writeInstallSweepReport(root, markdown);
  return { after, before, reportPath, markdown };
}

function normalizeRel(rel) {
  return rel.replace(/\\/g, "/").replace(/\/$/, "") || "docs";
}

/**
 * @param {string} rel POSIX relative path
 * @param {string} docsRoot
 * @param {boolean} includeFramework
 * @returns {SweepCategory | null}
 */
function classify(rel, docsRoot, includeFramework) {
  const norm = rel.replace(/\\/g, "/");

  if (RULES_PREFIXES.some((p) => norm.startsWith(p))) return "rules";
  if (norm === "AGENTS.md" || norm === "CLAUDE.md" || norm === "GEMINI.md") {
    return "rules";
  }
  if (norm.startsWith(".cursor/policies/")) return "rules";

  if (includeFramework && FRAMEWORK_PREFIXES.some((p) => norm.startsWith(p))) {
    if (norm.includes(".cursor/aaac/state/")) return null;
    return "framework";
  }

  if (norm.startsWith(`${docsRoot}/`)) return "docs";
  const top = norm.split("/")[0];
  if (DOC_DIR_NAMES.has(top)) return "docs";
  if (!norm.includes("/") && ROOT_DOC_FILES.has(norm)) return "docs";
  if (/^(README|ARCHITECTURE|CONTRIBUTING|SECURITY|CHANGELOG)/i.test(norm)) {
    return "docs";
  }

  return null;
}

/**
 * @param {string} root
 * @param {string} dirRel
 * @param {(rel: string, isDir: boolean) => 'skip' | void} visit
 */
function walk(root, dirRel, visit) {
  const abs = dirRel === "" ? root : path.join(root, dirRel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const action = visit(rel, true);
      if (action === "skip") continue;
      walk(root, rel, visit);
    } else {
      visit(rel, false);
    }
  }
}
