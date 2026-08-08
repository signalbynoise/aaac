/**
 * Shared Fallow command runners and metric summarizers for remediation campaigns.
 */
import { spawnSync } from "child_process";
import path from "path";
import { REPO_ROOT, readJson } from "../../run-engine/lib.mjs";
import { loadRemediationConfig } from "./remediation-config.mjs";

export function getScanRoot() {
  const config = loadRemediationConfig();
  return path.resolve(REPO_ROOT, config.scan_root ?? config.fallow_cwd ?? ".");
}

/** @deprecated use getScanRoot() */
export const FRONTEND_ROOT = getScanRoot();
export const FALLOW_BUFFER = 100 * 1024 * 1024;

export function runFallow(subcommand, extraArgs = [], cwd = getScanRoot()) {
  const args = [subcommand, "--format", "json", "--quiet", "--explain", ...extraArgs];
  const result = spawnSync("fallow", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: FALLOW_BUFFER,
  });

  let payload;
  if (result.stdout?.trim()) {
    try {
      payload = JSON.parse(result.stdout);
    } catch (e) {
      return {
        ok: false,
        exit_code: 2,
        error: true,
        message: `invalid JSON from fallow ${subcommand}: ${e.message}`,
        payload: null,
      };
    }
  } else {
    payload = {
      error: true,
      message: result.stderr || `fallow ${subcommand} produced no output`,
      exit_code: result.status,
    };
  }

  return {
    ok: result.status !== 2,
    exit_code: result.status,
    payload,
  };
}

export function summarizeDeadCode(payload) {
  const s = payload?.summary ?? payload?.totals ?? payload ?? {};
  return {
    total_issues: s.total_issues ?? payload?.total_issues ?? 0,
    unused_files: s.unused_files ?? (payload?.unused_files?.length ?? 0),
    unused_exports: s.unused_exports ?? (payload?.unused_exports?.length ?? 0),
    unused_dependencies: s.unused_dependencies ?? (payload?.unused_dependencies?.length ?? 0),
    circular_dependencies: s.circular_dependencies ?? (payload?.circular_dependencies?.length ?? 0),
    unresolved_imports: s.unresolved_imports ?? (payload?.unresolved_imports?.length ?? 0),
    duplicate_exports: s.duplicate_exports ?? (payload?.duplicate_exports?.length ?? 0),
    boundary_violations: s.boundary_violations ?? (payload?.boundary_violations?.length ?? 0),
    elapsed_ms: payload?.elapsed_ms ?? null,
  };
}

export function summarizeDupes(payload) {
  const stats = payload?.stats ?? {};
  return {
    clone_groups: stats.clone_groups ?? (payload?.clone_groups?.length ?? 0),
    clone_instances: stats.clone_instances ?? 0,
    files_with_clones: stats.files_with_clones ?? 0,
    total_files: stats.total_files ?? 0,
    duplicated_lines: stats.duplicated_lines ?? 0,
    duplicated_tokens: stats.duplicated_tokens ?? 0,
    duplication_percentage: stats.duplication_percentage ?? 0,
    elapsed_ms: payload?.elapsed_ms ?? null,
  };
}

export function summarizeHealth(payload) {
  const summary = payload?.summary ?? {};
  const healthScore = payload?.health_score ?? {};
  return {
    health_score: healthScore.score ?? null,
    health_grade: healthScore.grade ?? null,
    functions_analyzed: summary.functions_analyzed ?? 0,
    functions_above_threshold: summary.functions_above_threshold ?? 0,
    severity_critical_count: summary.severity_critical_count ?? 0,
    severity_high_count: summary.severity_high_count ?? 0,
    severity_moderate_count: summary.severity_moderate_count ?? 0,
    findings_count: Array.isArray(payload?.findings) ? payload.findings.length : 0,
    hotspots_count: Array.isArray(payload?.hotspots) ? payload.hotspots.length : 0,
    elapsed_ms: payload?.elapsed_ms ?? null,
  };
}

/** Lower-is-better metric: fraction reduced vs baseline (0–1). */
export function reductionRate(baseline, current) {
  if (baseline == null || current == null) return null;
  if (baseline <= 0) return current <= 0 ? 1 : 0;
  return Math.max(0, Math.min(1, (baseline - current) / baseline));
}

/** Higher-is-better score on 0–100 scale: fraction of remaining headroom gained. */
export function improvementRate(baselineScore, currentScore, ceiling = 100) {
  if (baselineScore == null || currentScore == null) return null;
  const headroom = ceiling - baselineScore;
  if (headroom <= 0) return currentScore >= ceiling ? 1 : 0;
  return Math.max(0, Math.min(1, (currentScore - baselineScore) / headroom));
}

export function readStartBaseline(campaignDir, filename, field) {
  const data = readJson(path.join(campaignDir, filename), null);
  if (data?.[field] != null) return { value: data[field], source: filename, record: data };
  return { value: null, source: "none", record: data };
}
