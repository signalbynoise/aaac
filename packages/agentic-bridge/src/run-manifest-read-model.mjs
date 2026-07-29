import fs from "fs";
import path from "path";
import {
  extractRoleInitialSummary,
  filterAgentsToLatestPhaseAttempt,
  normalizeSemanticText,
  validateCurrentStep,
  validateInitialSummary,
  validateSealedSummary,
} from "@ludecker/aaac/run-engine/agent-progress-contract";
import { resolveAgentSpecsForPhase } from "@ludecker/aaac/run-engine/swarm-agent-specs";
import { computeWorkspacePaths } from "./aaac-status.mjs";

const GENERIC_AGENT_ID =
  /^(?:agent|agentic-os-agent|generic-agent)(?:[-_\s]*\d+)?$/i;

function cloneManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== "object") return rawManifest;
  return structuredClone(rawManifest);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function finiteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeLegacyTokenSource(agent) {
  if (
    agent?.token_source == null &&
    (finiteMetric(agent?.tokens) || finiteMetric(agent?.context))
  ) {
    return { ...agent, token_source: "legacy_meter" };
  }
  return agent;
}

function latestAttemptAgents(manifest, agents, phase) {
  const phaseAgents = (agents ?? []).filter((agent) => agent?.phase === phase);
  const timestampedAttempt = filterAgentsToLatestPhaseAttempt(
    phaseAgents,
    manifest.log,
    phase,
  );
  if (timestampedAttempt.length || !phaseAgents.length) return timestampedAttempt;

  const latestBySlot = new Map();
  for (let index = phaseAgents.length - 1; index >= 0; index -= 1) {
    const agent = phaseAgents[index];
    const slot = positiveInteger(agent?.index) ?? `position:${index}`;
    if (!latestBySlot.has(slot)) latestBySlot.set(slot, agent);
  }
  const latest = new Set(latestBySlot.values());
  return phaseAgents.filter((agent) => latest.has(agent));
}

function rosterCount(manifest, phase, snapshot, agents) {
  const target = positiveInteger(
    snapshot?.target_agents ?? manifest.swarm?.target_agents?.[phase],
  );
  const latestAgents = latestAttemptAgents(manifest, agents, phase);
  const largestSlot = latestAgents.reduce(
    (largest, agent) => Math.max(largest, positiveInteger(agent?.index) ?? 0),
    0,
  );
  const agentCount = Math.max(latestAgents.length, largestSlot);
  return agentCount || target;
}

function readRoleSummary(cursorRoot, relPath) {
  try {
    const specPath = path.join(cursorRoot, relPath);
    if (!fs.existsSync(specPath)) return null;
    return extractRoleInitialSummary(fs.readFileSync(specPath, "utf8"));
  } catch {
    return null;
  }
}

function canonicalRoster(workspacePaths, manifest, phase, count) {
  try {
    return resolveAgentSpecsForPhase({
      aaacRoot: workspacePaths.aaacRoot,
      phase,
      manifest,
      count,
    }).map((spec) => ({
      ...spec,
      initial_summary: readRoleSummary(workspacePaths.cursorRoot, spec.relPath),
    }));
  } catch {
    return [];
  }
}

function expectedSpec(spec) {
  return {
    id: spec.id,
    path: spec.cursorPath,
    ...(spec.initial_summary
      ? { initial_summary: spec.initial_summary }
      : {}),
  };
}

function rosterIdsMatch(expected, roster) {
  if (!Array.isArray(expected) || expected.length !== roster.length) return false;
  return expected.every((entry, index) => entry?.id === roster[index]?.id);
}

function resolveRoster(
  workspacePaths,
  manifest,
  phase,
  snapshot,
  agents,
  expected,
  phaseMatches = true,
) {
  if (phaseMatches && Array.isArray(expected) && expected.length) {
    const persistedCountRoster = canonicalRoster(
      workspacePaths,
      manifest,
      phase,
      expected.length,
    );
    if (rosterIdsMatch(expected, persistedCountRoster)) {
      return persistedCountRoster;
    }
  }
  return canonicalRoster(
    workspacePaths,
    manifest,
    phase,
    rosterCount(manifest, phase, snapshot, agents),
  );
}

function normalizeExpectedRoster(expected, roster, phaseMatches = true) {
  if (!phaseMatches || !rosterIdsMatch(expected, roster)) {
    return roster.map(expectedSpec);
  }
  return expected.map((entry, index) => ({
    ...entry,
    path: roster[index].cursorPath,
    ...(roster[index].initial_summary
      ? { initial_summary: roster[index].initial_summary }
      : {}),
  }));
}

function resolveExplicitSpec(roster, agentSpecId) {
  if (typeof agentSpecId !== "string" || !agentSpecId.trim()) return null;
  const normalizedId = agentSpecId.trim();
  return roster.find((spec) => spec.id === normalizedId) ?? null;
}

function slotSpec(roster, agent, fallbackIndex) {
  const slot = positiveInteger(agent?.index);
  return roster[(slot ?? fallbackIndex + 1) - 1] ?? null;
}

function normalizeAgent(workspacePaths, roster, agent, fallbackIndex) {
  const explicitId =
    typeof agent?.agent_spec_id === "string" ? agent.agent_spec_id.trim() : "";
  const hasGenericIdentity = !explicitId || GENERIC_AGENT_ID.test(explicitId);
  const explicitSpec = !hasGenericIdentity
    ? resolveExplicitSpec(roster, explicitId)
    : null;
  const needsSlotIdentity = hasGenericIdentity || !explicitSpec;
  const spec = explicitSpec ?? slotSpec(roster, agent, fallbackIndex);
  const remappingIdentity = needsSlotIdentity && Boolean(spec);
  const normalizedAgent = normalizeLegacyTokenSource(agent);
  const persistedInitialSummary = validateInitialSummary(
    normalizedAgent?.initial_summary,
  );
  const currentProgress = validateCurrentStep(normalizedAgent?.last_progress);
  const persistedSummary = validateSealedSummary(normalizedAgent.summary);
  const canonicalSummary = validateInitialSummary(spec?.initial_summary);
  const summaryMatchesStaleRole =
    remappingIdentity &&
    persistedInitialSummary &&
    normalizeSemanticText(normalizedAgent.summary) === persistedInitialSummary;
  const next = { ...normalizedAgent };

  if (remappingIdentity) {
    next.agent_spec_id = spec.id;
    next.agent_spec_path = spec.cursorPath;
  }

  const initialSummary = remappingIdentity
    ? canonicalSummary
    : persistedInitialSummary;
  const completionFallback = initialSummary ?? canonicalSummary;
  if (initialSummary) {
    next.initial_summary = initialSummary;
  } else {
    delete next.initial_summary;
  }

  if (currentProgress) {
    next.last_progress = currentProgress;
  } else {
    delete next.last_progress;
  }

  if (persistedSummary && !summaryMatchesStaleRole) {
    next.summary = persistedSummary;
  } else if (normalizedAgent.completed_at && completionFallback) {
    next.summary = completionFallback;
  } else {
    delete next.summary;
  }

  return next;
}

function normalizeLatestAgents(workspacePaths, manifest, phase, agents, roster) {
  if (!Array.isArray(agents) || !agents.length || !roster.length) return agents;
  const latest = latestAttemptAgents(manifest, agents, phase);
  const latestPositions = new Map(latest.map((agent, index) => [agent, index]));
  return agents.map((agent) => {
    const position = latestPositions.get(agent);
    return position == null
      ? agent
      : normalizeAgent(workspacePaths, roster, agent, position);
  });
}

function normalizeHistory(workspacePaths, manifest) {
  for (const [phase, snapshot] of Object.entries(manifest.swarm_history ?? {})) {
    if (!snapshot || typeof snapshot !== "object") continue;
    const agents = snapshot.agents ?? [];
    const roster = resolveRoster(
      workspacePaths,
      manifest,
      phase,
      snapshot,
      agents,
      snapshot.expected_agent_specs,
    );
    snapshot.expected_agent_specs = normalizeExpectedRoster(
      snapshot.expected_agent_specs,
      roster,
    );
    snapshot.agents = normalizeLatestAgents(
      workspacePaths,
      manifest,
      phase,
      agents,
      roster,
    );
  }
}

function normalizeCurrentSwarm(workspacePaths, manifest) {
  if (!manifest.swarm || typeof manifest.swarm !== "object") return;
  const phase = manifest.swarm.phase ?? manifest.phase;
  if (typeof phase !== "string" || !phase) return;
  const agents = manifest.swarm.agents ?? [];
  const phaseMatches = manifest.swarm.expected_specs_phase === phase;
  const roster = resolveRoster(
    workspacePaths,
    manifest,
    phase,
    null,
    agents,
    manifest.swarm.expected_agent_specs,
    phaseMatches,
  );
  manifest.swarm.expected_agent_specs = normalizeExpectedRoster(
    manifest.swarm.expected_agent_specs,
    roster,
    phaseMatches,
  );
  manifest.swarm.expected_specs_phase = phase;
  manifest.swarm.agents = normalizeLatestAgents(
    workspacePaths,
    manifest,
    phase,
    agents,
    roster,
  );
}

/**
 * Normalize historical run data for bridge consumers without changing persisted state.
 */
export function normalizeRunManifestReadModel(workspaceRoot, rawManifest) {
  const manifest = cloneManifest(rawManifest);
  if (!manifest || typeof manifest !== "object") return manifest;
  const workspacePaths = computeWorkspacePaths(workspaceRoot);
  normalizeHistory(workspacePaths, manifest);
  normalizeCurrentSwarm(workspacePaths, manifest);
  return manifest;
}
