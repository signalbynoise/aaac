/**
 * Classify Fallow scan issues: true_positive | false_positive | review
 * Bridges swarm/check-risk knowledge into remediation metrics (SSOT).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REPO_ROOT, readJson } from "../../run-engine/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.join(REPO_ROOT, "frontend");
const RULES_PATH = path.join(__dirname, "..", "fallow-fp-rules.json");

const ISSUE_ARRAYS = [
  "unused_files",
  "unused_exports",
  "unused_types",
  "unused_dependencies",
  "unused_enum_members",
  "unused_class_members",
  "unresolved_imports",
  "duplicate_exports",
  "circular_dependencies",
  "boundary_violations",
];

export function loadFpRules() {
  return readJson(RULES_PATH, { path_globs: [], path_regex: [], issue_heuristics: {}, scoring: {} });
}

function loadFallowrcGlobs() {
  const rc = readJson(path.join(FRONTEND_ROOT, ".fallowrc.json"), {});
  return Array.isArray(rc.dynamicallyLoaded) ? rc.dynamicallyLoaded : [];
}

function globToRegex(glob) {
  const normalized = glob.replace(/^frontend\//, "").replace(/^\//, "");
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function normalizePath(p) {
  return (p ?? "").replace(/^frontend\//, "").replace(/^\//, "");
}

function pathMatchesGlob(filePath, glob) {
  const norm = normalizePath(filePath);
  const g = glob.replace(/^frontend\//, "");
  if (g.includes("*")) return globToRegex(g).test(norm);
  return norm === g || norm.endsWith(`/${g}`);
}

function pathMatchesAnyGlob(filePath, globs) {
  return globs.some((g) => pathMatchesGlob(filePath, g));
}

function issueKey(category, issue) {
  const p = normalizePath(issue.path ?? issue.file ?? "");
  const name = issue.export_name ?? issue.name ?? issue.dependency ?? issue.symbol ?? "";
  const line = issue.line ?? "";
  return `${category}:${p}:${name}:${line}`;
}

function loadCampaignRegistry(campaignDir) {
  const jsonPath = path.join(campaignDir, "fallow-false-positives.json");
  if (fs.existsSync(jsonPath)) {
    return readJson(jsonPath, { entries: [] });
  }
  return { version: 1, entries: [] };
}

function registryLookup(registry, key, filePath, exportName) {
  for (const entry of registry.entries ?? []) {
    if (entry.id === key) return entry;
    if (entry.path && normalizePath(entry.path) === normalizePath(filePath)) {
      if (!entry.export_name || entry.export_name === exportName) return entry;
    }
  }
  return null;
}

function classifyByRules(category, issue, rules, dynamicGlobs) {
  const filePath = normalizePath(issue.path ?? issue.file ?? "");

  for (const rule of rules.path_globs ?? []) {
    const globs =
      rule.glob === "from_fallowrc_dynamicallyLoaded" ? dynamicGlobs : [rule.glob];
    if (pathMatchesAnyGlob(filePath, globs)) {
      return { classification: rule.classification, reason: rule.reason, rule_id: rule.id };
    }
  }

  for (const rule of rules.path_regex ?? []) {
    if (new RegExp(rule.pattern).test(filePath)) {
      return { classification: rule.classification, reason: rule.reason, rule_id: rule.id };
    }
  }

  const heuristics = rules.issue_heuristics?.[category] ?? [];
  for (const h of heuristics) {
    if (h.path_suffix && !filePath.endsWith(h.path_suffix.replace(/^\//, ""))) continue;
    if (h.is_re_export != null && issue.is_re_export !== h.is_re_export) continue;
    if (h.action_note_contains) {
      const notes = (issue.actions ?? []).map((a) => a.note ?? "").join(" ");
      if (!notes.includes(h.action_note_contains)) continue;
    }
    return { classification: h.classification, reason: h.reason, rule_id: h.id };
  }

  return { classification: "true_positive", reason: "fallow_reported_unused", rule_id: null };
}

export function classifyFallowScan({ scan, campaignDir, rules = loadFpRules() }) {
  const dynamicGlobs = loadFallowrcGlobs();
  const registry = campaignDir ? loadCampaignRegistry(campaignDir) : { entries: [] };
  const inventory = [];
  const counts = { true_positive: 0, false_positive: 0, review: 0 };

  for (const category of ISSUE_ARRAYS) {
    const items = scan[category];
    if (!Array.isArray(items)) continue;

    for (const issue of items) {
      const key = issueKey(category, issue);
      const filePath = normalizePath(issue.path ?? issue.file ?? "");
      const exportName = issue.export_name ?? null;
      const manual = registryLookup(registry, key, filePath, exportName);

      let result;
      if (manual) {
        result = {
          classification: manual.classification ?? "false_positive",
          reason: manual.reason ?? "campaign_registry",
          rule_id: manual.source ?? "manual",
          source: "campaign_registry",
        };
      } else {
        const ruled = classifyByRules(category, issue, rules, dynamicGlobs);
        result = { ...ruled, source: "fallow-fp-rules" };
      }

      counts[result.classification] = (counts[result.classification] ?? 0) + 1;
      inventory.push({
        id: key,
        category,
        path: filePath,
        export_name: exportName,
        classification: result.classification,
        reason: result.reason,
        rule_id: result.rule_id,
        source: result.source,
        is_re_export: issue.is_re_export ?? null,
      });
    }
  }

  const rawTotal = scan.total_issues ?? scan.summary?.total_issues ?? inventory.length;
  const actionable = (counts.true_positive ?? 0) + (counts.review ?? 0);
  const excluded = counts.false_positive ?? 0;

  return {
    classified_at: new Date().toISOString(),
    raw_total: rawTotal,
    inventory_count: inventory.length,
    counts,
    actionable_total: actionable,
    excluded_false_positives: excluded,
    actionable_classifications: rules.scoring?.actionable_classifications ?? [
      "true_positive",
      "review",
    ],
    inventory,
    summary: {
      raw_total: rawTotal,
      actionable_total: actionable,
      false_positive_total: excluded,
      review_total: counts.review ?? 0,
      true_positive_total: counts.true_positive ?? 0,
    },
  };
}

export function resolveActionableBaseline(campaignDir) {
  const p = path.join(campaignDir, "fallow-start-actionable-baseline.json");
  return readJson(p, null);
}
