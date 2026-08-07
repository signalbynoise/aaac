import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { runDir, normalizePhaseArtifactPath } from "./lib.mjs";
import { resolvePhaseArtifacts } from "./context-budget.mjs";
import { estimateStageCostUsd } from "./estimate-token-cost.mjs";
import { resolveExpectedAgentSpecs } from "./expected-agent-specs.mjs";
import {
  filterAgentsToLatestPhaseAttempt,
  validateCurrentStep,
  validateInitialSummary,
  validateSealedSummary,
  validateStageSummary,
} from "./agent-progress-contract.mjs";

const MAX_SENTENCES = 3;

function finite(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function phaseAgents(manifest, phase) {
  const candidates = [
    ...(manifest.swarm_history?.[phase]?.agents ?? []),
    ...(manifest.swarm?.agents ?? []).filter((agent) => agent.phase === phase),
  ];
  const distinct = new Map();
  for (const [index, agent] of filterAgentsToLatestPhaseAttempt(
    candidates,
    manifest.log,
    phase,
  ).entries()) {
    const key = agent.subagent_id ?? agent.cursor_run_id ??
      `${agent.agent_spec_id ?? agent.index ?? `anonymous-${index}`}:${agent.started_at ?? agent.at ?? index}`;
    distinct.set(key, agent);
  }
  return [...distinct.values()];
}

function sumComponent(agents, key) {
  const values = agents.map((agent) => finite(agent[key])).filter((value) => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function extractSealedStageMetrics(manifest, phase) {
  const agents = phaseAgents(manifest, phase);
  const metered = agents.filter((agent) => finite(agent.tokens) != null);
  const contexts = metered.map((agent) => finite(agent.context)).filter((value) => value != null);
  const fileMetered = agents.filter((agent) =>
    ["metered_hook", "metered_bridge", "metered_legacy"].includes(agent.files_source) ||
    ["files_read", "files_explored", "files_written", "files_edited"]
      .some((key) => finite(agent[key]) != null));
  const files = fileMetered.map((agent) =>
    ["files_read", "files_explored", "files_written", "files_edited"]
      .reduce((sum, key) => sum + (finite(agent[key]) ?? 0), 0));
  const cost = estimateStageCostUsd(manifest, phase, { agents });
  return {
    agent_count: agents.length || null,
    files_explored: files.length ? files.reduce((sum, value) => sum + value, 0) : null,
    duration_ms: finite(manifest.phase_metrics?.[phase]?.duration_ms),
    avg_context_percent: contexts.length
      ? contexts.reduce((sum, value) => sum + value, 0) / contexts.length
      : null,
    avg_tokens: metered.length
      ? metered.reduce((sum, agent) => sum + Number(agent.tokens), 0) / metered.length
      : null,
    input_tokens: sumComponent(metered, "input_tokens"),
    output_tokens: sumComponent(metered, "output_tokens"),
    cache_read_tokens: sumComponent(metered, "cache_read_tokens"),
    cache_write_tokens: sumComponent(metered, "cache_write_tokens"),
    estimated_cost_usd: cost.estimated_cost_usd,
    cost_method: cost.cost_method,
    cost_quality: cost.cost_quality,
  };
}

function readableArtifacts(runId, phase, manifest, enforcement) {
  const readable = [];
  const texts = [];
  for (const rel of resolvePhaseArtifacts(phase, manifest, enforcement)) {
    const resolved = normalizePhaseArtifactPath(runId, rel, enforcement);
    if (!resolved.ok) continue;
    const filePath = path.join(runDir(runId), resolved.path);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) continue;
    readable.push(rel);
    texts.push(text);
  }
  return { readable, texts };
}

function artifactTextCandidate(text) {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^[-*#\s]+/, "").replace(/^[\w.-]+:\s*/, "").trim();
    if (validateStageSummary(line)) return line;
  }
  return null;
}

export function buildLaymanFromArtifacts(texts) {
  const candidates = texts.map(artifactTextCandidate).filter(Boolean);
  return validateStageSummary(candidates.join(". ").slice(0, 280));
}

function rosterForPhase(manifest, phase) {
  if (manifest.swarm?.expected_specs_phase === phase) {
    return manifest.swarm.expected_agent_specs ?? [];
  }
  const historical = manifest.swarm_history?.[phase]?.expected_agent_specs ?? [];
  if (historical.length) return historical;
  if (!(manifest.swarm_history?.[phase]?.agents ?? []).length) return [];
  try {
    return resolveExpectedAgentSpecs(manifest, { phase });
  } catch {
    return [];
  }
}

function agentIdentity(agent, index) {
  return agent.agent_spec_id ?? agent.subagent_id ?? agent.cursor_run_id ??
    agent.description ?? index + 1;
}

function boundSummary(values) {
  const combined = values.slice(0, MAX_SENTENCES).join(". ");
  if (combined.length <= 280) return combined;
  const prefix = combined.slice(0, 279);
  const boundary = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, boundary > 168 ? boundary : 279).trim()}…`;
}

function semanticCandidates(manifest, phase) {
  const candidates = [];
  const sources = [];
  for (const [index, agent] of phaseAgents(manifest, phase).entries()) {
    for (const [field, value] of [
      ["summary", validateSealedSummary(agent.summary)],
      ["last_progress", validateCurrentStep(agent.last_progress)],
      ["initial_summary", validateInitialSummary(agent.initial_summary)],
    ]) {
      const normalized = value?.replace(/[.!?]+$/, "");
      if (!normalized || candidates.includes(normalized)) continue;
      candidates.push(normalized);
      sources.push(`agent:${agentIdentity(agent, index)}:${field}`);
    }
  }
  if (!candidates.length) {
    for (const spec of rosterForPhase(manifest, phase)) {
      const value = validateInitialSummary(spec.initial_summary);
      if (!value) continue;
      candidates.push(value.replace(/[.!?]+$/, ""));
      sources.push(`phase-roster:${phase}:agent-spec:${spec.path}#Role`);
      break;
    }
  }
  const layman = validateStageSummary(boundSummary(candidates));
  return layman ? { layman, source_artifacts: sources.slice(0, MAX_SENTENCES) } : null;
}

export function prepareStageSummaryEvidence(runId, phase, manifest, enforcement) {
  const artifacts = readableArtifacts(runId, phase, manifest, enforcement);
  const semantic = semanticCandidates(manifest, phase);
  const artifactLayman = buildLaymanFromArtifacts(artifacts.texts);
  const artifact = artifactLayman
    ? { layman: artifactLayman, source_artifacts: artifacts.readable }
    : null;
  const selected = semantic ?? artifact;
  const metrics = extractSealedStageMetrics(manifest, phase);
  const sourceFingerprint = createHash("sha256").update(JSON.stringify({
    phase,
    agents: phaseAgents(manifest, phase),
    roster: rosterForPhase(manifest, phase),
    artifacts,
    metrics,
  })).digest("hex");
  return { selected, metrics, sourceFingerprint, readable: artifacts.readable };
}

export function isStageSummaryEligible(runId, phase, manifest, enforcement) {
  const evidence = prepareStageSummaryEvidence(runId, phase, manifest, enforcement);
  return evidence.selected
    ? { ok: true, readable: evidence.readable }
    : { ok: false, reason: "no safe semantic or artifact summary candidate" };
}
