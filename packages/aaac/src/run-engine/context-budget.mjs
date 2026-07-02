#!/usr/bin/env node
/**
 * Load effective context budget SSOT and helpers for compaction / gates.
 */
import fs from "fs";
import path from "path";
import { AAAC_ROOT, runDir } from "./lib.mjs";

export const CONTEXT_BUDGET_PATH = path.join(AAAC_ROOT, "context-budget.yaml");

const DEFAULT_COMPACTION = {
  top_review_for_trace: 25,
  top_actionable: 40,
  dupes_top_groups: 15,
  discover_brief_max_evidence_lines: 10,
  discover_brief_max_steps: 7,
  merge_findings_max: 25,
  merge_gaps_max: 10,
  artifact_char_warn: 16000,
};

function readIntField(content, fieldName, fallback) {
  const match = content.match(new RegExp(`^\\s*${fieldName}:\\s*(\\d+)`, "m"));
  return match ? Number(match[1]) : fallback;
}

/** @returns {{ compaction: typeof DEFAULT_COMPACTION, handoff: { check_discover: string } }} */
export function loadContextBudget() {
  if (!fs.existsSync(CONTEXT_BUDGET_PATH)) {
    return {
      compaction: { ...DEFAULT_COMPACTION },
      handoff: { check_discover: "artifacts/discover_brief.yaml" },
    };
  }

  const content = fs.readFileSync(CONTEXT_BUDGET_PATH, "utf8");
  const compaction = { ...DEFAULT_COMPACTION };
  for (const key of Object.keys(DEFAULT_COMPACTION)) {
    compaction[key] = readIntField(content, key, DEFAULT_COMPACTION[key]);
  }

  const handoffMatch = content.match(/check_discover:\s*(\S+)/);
  return {
    compaction,
    handoff: {
      check_discover: handoffMatch?.[1] ?? "artifacts/discover_brief.yaml",
    },
  };
}

export function countDiscoverBriefListItems(content) {
  return (content.match(/^\s*-\s+/gm) ?? []).length;
}

/**
 * Trim excess YAML list items from discover_brief to fit context budget.
 * @returns {{ content: string, compacted: boolean, removed: number }}
 */
export function compactDiscoverBriefContent(content, budget = loadContextBudget()) {
  const maxEvidence = budget.compaction.discover_brief_max_evidence_lines;
  const lines = content.split("\n");
  const kept = [];
  let listItems = 0;
  let removed = 0;

  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      listItems += 1;
      if (listItems > maxEvidence) {
        removed += 1;
        continue;
      }
    }
    kept.push(line);
  }

  if (removed === 0) {
    return { content, compacted: false, removed: 0 };
  }

  const note = `# context-budget: trimmed ${removed} evidence line(s); max ${maxEvidence} per context-budget.yaml`;
  const trimmed = kept.join("\n").trimEnd();
  return {
    content: `${trimmed}\n${note}\n`,
    compacted: true,
    removed,
  };
}

export function capList(items, max) {
  if (!Array.isArray(items) || max == null || max < 0) return items ?? [];
  if (items.length <= max) return items;
  return items.slice(0, max);
}

export function resolvePhaseArtifacts(completedPhase, manifest, enforcement) {
  const base = enforcement.phase_artifacts?.[completedPhase] ?? [];
  const byVerb = enforcement.phase_artifacts_by_verb?.[manifest.verb]?.[completedPhase] ?? [];
  return [...base, ...byVerb];
}

export function artifactByteSize(runId, relPath) {
  const filePath = path.join(runDir(runId), relPath);
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).size;
}

export function sumArtifactBytes(runId, relPaths) {
  return relPaths.reduce((sum, rel) => sum + artifactByteSize(runId, rel), 0);
}

export function validateDiscoverBriefContent(content, budget = loadContextBudget()) {
  if (!content?.trim()) {
    return { ok: false, reason: "discover_brief.yaml is empty" };
  }
  if (!/^answer:/m.test(content)) {
    return { ok: false, reason: "discover_brief.yaml must include answer: field" };
  }
  const evidenceLines = countDiscoverBriefListItems(content);
  const maxEvidence = budget.compaction.discover_brief_max_evidence_lines;
  if (evidenceLines > maxEvidence) {
    return {
      ok: false,
      reason: `discover_brief.yaml has ${evidenceLines} list items; max ${maxEvidence} per context-budget.yaml`,
    };
  }
  return { ok: true };
}

/**
 * Auto-compact discover_brief on disk when over budget (avoids advance gate failures).
 * @returns {{ compacted: boolean, removed: number }}
 */
export function ensureDiscoverBriefWithinBudget(runId, budget = loadContextBudget()) {
  const briefRel = budget.handoff.check_discover;
  const briefPath = path.join(runDir(runId), briefRel);
  if (!fs.existsSync(briefPath)) {
    return { compacted: false, removed: 0 };
  }

  const original = fs.readFileSync(briefPath, "utf8");
  const { content, compacted, removed } = compactDiscoverBriefContent(original, budget);
  if (!compacted) {
    return { compacted: false, removed: 0 };
  }

  fs.writeFileSync(briefPath, content, "utf8");
  return { compacted: true, removed };
}

export function formatPhaseMetricsDetail(metrics) {
  const parts = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (value == null || value === "") continue;
    parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? parts.join(" ") : "ok";
}

export function estimateContextUtilization(artifactBytes, budget = loadContextBudget()) {
  const threshold = budget.compaction.artifact_char_warn;
  if (!threshold || threshold <= 0) return null;
  return Math.min(100, Math.round((artifactBytes / threshold) * 1000) / 10);
}

export function validateContextBudgetArtifacts(runId, completedPhase, manifest, enforcement) {
  const budget = loadContextBudget();
  const required = resolvePhaseArtifacts(completedPhase, manifest, enforcement);

  if (manifest.verb === "check" && completedPhase === "discover") {
    const briefRel = budget.handoff.check_discover;
    const briefPath = path.join(runDir(runId), briefRel);
    if (!fs.existsSync(briefPath)) {
      return {
        ok: false,
        reason: `Missing ${briefRel} (required for check verb discover — write compact brief before advance)`,
      };
    }
    const compaction = ensureDiscoverBriefWithinBudget(runId, budget);
    if (compaction.compacted) {
      manifest.context = manifest.context ?? { phases: {} };
      manifest.context.phases[completedPhase] = {
        ...(manifest.context.phases[completedPhase] ?? {}),
        compaction_applied: true,
        evidence_lines_trimmed: compaction.removed,
      };
    }

    const briefContent = fs.readFileSync(briefPath, "utf8");
    const briefGate = validateDiscoverBriefContent(briefContent, budget);
    if (!briefGate.ok) return briefGate;
  }

  for (const rel of required) {
    const bytes = artifactByteSize(runId, rel);
    if (bytes > budget.compaction.artifact_char_warn) {
      return {
        ok: false,
        reason: `context_budget_exceeded: ${rel} is ${bytes} bytes (warn threshold ${budget.compaction.artifact_char_warn})`,
      };
    }
  }

  return { ok: true };
}

export function recordPhaseContextTelemetry(manifest, completedPhase, runId, enforcement) {
  const budget = loadContextBudget();
  const required = resolvePhaseArtifacts(completedPhase, manifest, enforcement);
  const artifactBytes = sumArtifactBytes(runId, required);
  const prior = manifest.context?.phases?.[completedPhase] ?? {};
  const phaseMetrics = manifest.phase_metrics?.[completedPhase] ?? {};
  const utilization = estimateContextUtilization(artifactBytes, budget);
  const entry = {
    artifact_bytes: artifactBytes,
    compaction_applied: prior.compaction_applied ?? false,
    evidence_lines_trimmed: prior.evidence_lines_trimmed ?? 0,
    estimated_utilization: phaseMetrics.context ?? utilization,
    tokens: phaseMetrics.tokens ?? null,
    duration_ms: phaseMetrics.duration_ms ?? null,
    swarm_count: manifest.swarm?.task_launches_this_phase ?? null,
  };

  manifest.context = manifest.context ?? { phases: {} };
  manifest.context.phases[completedPhase] = { ...prior, ...entry };
  manifest.swarm = {
    ...(manifest.swarm ?? {}),
    ...entry,
    phase: completedPhase,
  };
}
