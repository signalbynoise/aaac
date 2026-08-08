import { validateStageSummary } from "./agent-progress-contract.mjs";

export const STAGE_SUMMARIES_REL = "artifacts/stage_summaries.yaml";
export const STAGE_SUMMARY_TITLE = "Summary";
const STATUSES = new Set(["missing", "pending", "validated", "failed"]);
const METRIC_KEYS = [
  "agent_count", "files_explored", "duration_ms", "avg_context_percent",
  "avg_tokens", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
  "estimated_cost_usd", "cost_method", "cost_quality",
];

function quote(value) {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function scalar(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "null") return null;
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function validateStageSummaryEntry(entry) {
  if (!validateStageSummary(entry?.layman)) {
    return { ok: false, reason: "VALIDATE_FAIL: layman is not canonical semantic prose" };
  }
  if (!Array.isArray(entry.source_artifacts) || !entry.source_artifacts.length) {
    return { ok: false, reason: "VALIDATE_FAIL: source_artifacts empty" };
  }
  for (const [key, value] of Object.entries(entry.metrics ?? {})) {
    if (value == null) continue;
    const provenance = /(?:source|method|quality|reason|status)$/.test(key);
    if (provenance ? typeof value !== "string" : !Number.isFinite(value)) {
      const expected = provenance ? "is not a string" : "is not numeric";
      return { ok: false, reason: `VALIDATE_FAIL: metrics.${key} ${expected}` };
    }
  }
  return { ok: true };
}

function emptyEntry() {
  return {
    status: "missing", title: STAGE_SUMMARY_TITLE, layman: null,
    metrics: Object.fromEntries(METRIC_KEYS.map((key) => [key, null])),
    source_artifacts: [], source_fingerprint: null, generated_at: null,
    validated_at: null, reason: null,
  };
}

export function parseStageSummariesYaml(content) {
  const phases = {};
  let phase = null;
  let section = null;
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const phaseMatch = line.match(/^ {2}([\w]+):\s*$/);
    if (phaseMatch) {
      phase = phaseMatch[1];
      phases[phase] = emptyEntry();
      section = null;
      continue;
    }
    if (!phase) continue;
    if (/^ {4}metrics:\s*$/.test(line)) {
      section = "metrics";
      continue;
    }
    if (/^ {4}source_artifacts:\s*$/.test(line)) {
      section = "sources";
      continue;
    }
    const metric = section === "metrics" && line.match(/^ {6}([\w]+):\s*(.*)$/);
    if (metric) {
      phases[phase].metrics[metric[1]] = scalar(metric[2]);
      continue;
    }
    const source = section === "sources" && line.match(/^ {6}-\s+(.*)$/);
    if (source) {
      phases[phase].source_artifacts.push(String(scalar(source[1])));
      continue;
    }
    const field = line.match(/^ {4}([\w]+):\s*(.*)$/);
    if (!field) continue;
    section = null;
    const value = scalar(field[2]);
    if (field[1] === "status" && STATUSES.has(String(value))) {
      phases[phase].status = value;
    } else {
      phases[phase][field[1]] = value;
    }
  }
  return { phases };
}

export function serializeStageSummaries(doc) {
  const lines = ["phases:"];
  for (const phase of Object.keys(doc?.phases ?? {}).sort()) {
    const entry = doc.phases[phase];
    lines.push(`  ${phase}:`, `    status: ${quote(entry.status ?? "missing")}`);
    lines.push(`    title: ${quote(entry.title ?? STAGE_SUMMARY_TITLE)}`);
    lines.push(`    layman: ${quote(entry.layman)}`, "    metrics:");
    for (const key of METRIC_KEYS) lines.push(`      ${key}: ${quote(entry.metrics?.[key])}`);
    lines.push("    source_artifacts:");
    const sources = entry.source_artifacts ?? [];
    if (!sources.length) lines.push("      []");
    for (const source of sources) lines.push(`      - ${quote(source)}`);
    for (const key of ["source_fingerprint", "generated_at", "validated_at"]) {
      lines.push(`    ${key}: ${quote(entry[key])}`);
    }
    if (entry.reason) lines.push(`    reason: ${quote(entry.reason)}`);
  }
  if (lines.length === 1) lines.push("  {}");
  return `${lines.join("\n")}\n`;
}

export function missingStageSummaryEntry(prior, reason) {
  return { ...emptyEntry(), generated_at: prior?.generated_at ?? null, reason };
}
