/**
 * Load swarm agent specs from graph.yaml + phases.json (SSOT).
 * Used by Agentic OS PhaseRunner and run telemetry.
 */
import fs from "fs";
import path from "path";

const PHASES_REL = "lifecycle/phases.json";
const GRAPH_REL = "graph.yaml";

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function flushGraphSkill(state) {
  if (!state.currentSkill) return;
  if (state.agents.length) {
    const target = state.listMode === "optional_agents"
      ? state.optionalSkills
      : state.skills;
    target[state.currentSkill] = [...state.agents];
  }
  state.agents = [];
  state.listMode = null;
}

function parseInlineAgentList(line, key) {
  const match = line.match(new RegExp(`^\\s+${key}: \\[(.+)\\]\\s*$`));
  return match
    ? match[1].split(",").map((value) => value.trim()).filter(Boolean)
    : null;
}

function processGraphSkillLine(state, line) {
  if (line.startsWith("skills:")) {
    state.inSkills = true;
    return;
  }
  if (state.inSkills && /^agents:/.test(line) && !line.startsWith("  ")) {
    flushGraphSkill(state);
    state.inSkills = false;
    state.currentSkill = null;
    return;
  }
  if (!state.inSkills) return;

  const skillMatch = line.match(/^  ([\w/-]+):\s*$/);
  if (skillMatch) {
    flushGraphSkill(state);
    state.currentSkill = skillMatch[1];
    return;
  }
  if (!state.currentSkill) return;

  const inlineAgents = parseInlineAgentList(line, "agents");
  if (inlineAgents) {
    state.skills[state.currentSkill] = inlineAgents;
    state.currentSkill = null;
    state.listMode = null;
    state.agents = [];
    return;
  }
  const inlineOptional = parseInlineAgentList(line, "optional_agents");
  if (inlineOptional) {
    state.optionalSkills[state.currentSkill] = inlineOptional;
    return;
  }
  if (/^\s+(?:optional_)?agents:\s*$/.test(line)) {
    flushGraphSkill(state);
    state.listMode = line.includes("optional_agents")
      ? "optional_agents"
      : "agents";
    state.agents = [];
    return;
  }
  if (!state.listMode) return;

  const itemMatch = line.match(/^\s+- ([\w-]+)\s*$/);
  if (itemMatch) {
    state.agents.push(itemMatch[1]);
    return;
  }
  if (!/^\s+-/.test(line) && !/^\s*$/.test(line)) {
    flushGraphSkill(state);
  }
}

function parseGraphSkillsAgents(graphText) {
  const state = {
    skills: {},
    optionalSkills: {},
    inSkills: false,
    currentSkill: null,
    listMode: null,
    agents: [],
  };
  for (const line of graphText.split("\n")) {
    processGraphSkillLine(state, line);
  }
  flushGraphSkill(state);
  return { skills: state.skills, optionalSkills: state.optionalSkills };
}

function parseGraphAgentPaths(graphText) {
  const agents = {};
  const lines = graphText.split("\n");
  let inAgents = false;
  let currentId = null;

  for (const line of lines) {
    if (line.startsWith("agents:")) {
      inAgents = true;
      continue;
    }
    if (inAgents && /^[a-z#]/.test(line) && !line.startsWith("  ")) {
      break;
    }
    if (!inAgents) continue;

    const idMatch = line.match(/^  ([\w-]+):\s*$/);
    if (idMatch) {
      currentId = idMatch[1];
      continue;
    }

    if (currentId) {
      const pathMatch = line.match(/^\s+path: agents\/([\w-]+)\.md\s*$/);
      if (pathMatch) {
        agents[currentId] = `agents/${pathMatch[1]}.md`;
        currentId = null;
      }
    }
  }

  return agents;
}

export function loadGraphSwarmConfig(aaacRoot) {
  const graphPath = path.join(aaacRoot, GRAPH_REL);
  const graphText = fs.readFileSync(graphPath, "utf8");
  const { skills, optionalSkills } = parseGraphSkillsAgents(graphText);
  return {
    skillAgents: skills,
    optionalSkillAgents: optionalSkills,
    agentPaths: parseGraphAgentPaths(graphText),
  };
}

export function loadPhasesConfig(aaacRoot) {
  return readJsonFile(path.join(aaacRoot, PHASES_REL));
}

/** @returns {{ id: string, path: string, relPath: string, cursorPath: string } | null} */
export function resolveAgentSpecById({ aaacRoot, id }) {
  if (typeof id !== "string" || !id.trim()) return null;
  const normalizedId = id.trim();
  const { agentPaths } = loadGraphSwarmConfig(aaacRoot);
  const relPath = agentPaths[normalizedId];
  if (!relPath) return null;
  const cursorPath = `.cursor/${relPath}`;
  return { id: normalizedId, path: cursorPath, relPath, cursorPath };
}

/** Resolve skill id for swarm agent lookup (check discover → check skill, etc.). */
export function resolveSwarmSkillId(phase, manifest, phasesConfig) {
  if (phase === "discover" && manifest?.verb === "check") {
    return "check";
  }
  if (phase === "check_swarm" && manifest?.command === "remediate-app") {
    return "remediation-check-swarm";
  }

  const entry = phasesConfig?.phases?.[phase];
  if (!entry) return null;

  if (phase === "verify") {
    return "testing";
  }

  return entry.skill ?? entry.skills?.[0] ?? null;
}

/** Recoverable slots when graph skill has path but no agents (stale installs). */
export function synthesizeFallbackAgentIds(phase, skillId, count) {
  const base = (skillId || phase || "swarm").replace(/[^\w-]+/g, "-");
  const n = Math.max(0, Number(count) || 0);
  return Array.from({ length: n }, (_, index) => `${base}-slot-${index + 1}`);
}

function selectAgentIds(mandatory, optional, targetCount, { phase, skillId } = {}) {
  const selected = [];
  const seen = new Set();

  for (const id of mandatory) {
    if (selected.length >= targetCount) break;
    if (!seen.has(id)) {
      seen.add(id);
      selected.push(id);
    }
  }

  for (const id of optional) {
    if (selected.length >= targetCount) break;
    if (!seen.has(id)) {
      seen.add(id);
      selected.push(id);
    }
  }

  while (selected.length < targetCount && mandatory.length > 0) {
    const id = mandatory[selected.length % mandatory.length];
    selected.push(`${id}-wave-${selected.length}`);
  }

  if (selected.length === 0 && targetCount > 0) {
    return synthesizeFallbackAgentIds(phase, skillId, targetCount);
  }

  return selected.slice(0, targetCount);
}

/** @returns {Array<{ id: string, path: string, relPath: string, cursorPath: string, synthetic?: boolean }>} */
export function resolveAgentSpecsForPhase({
  aaacRoot,
  phase,
  manifest,
  count = null,
}) {
  const phasesConfig = loadPhasesConfig(aaacRoot);
  const { skillAgents, optionalSkillAgents, agentPaths } = loadGraphSwarmConfig(aaacRoot);
  const skillId = resolveSwarmSkillId(phase, manifest, phasesConfig);

  const mandatory = skillId ? skillAgents[skillId] ?? [] : [];
  const optional = skillId ? optionalSkillAgents[skillId] ?? [] : [];
  let agentIds = mandatory;
  let synthetic = false;

  if (count != null && count > 0) {
    agentIds = selectAgentIds(agentIds, optional, count, { phase, skillId });
    synthetic = mandatory.length === 0 && optional.length === 0;
  }

  return agentIds.map((id) => {
    const baseId = id.replace(/-wave-\d+$/, "").replace(/-slot-\d+$/, "");
    // Keep wave/slot id for slot identity; path lookup uses baseId.
    // Synthetic slots bind to the phase skill so prompts stay useful without agent md files.
    const relPath = agentPaths[baseId]
      ?? (synthetic
        ? `skills/shared/${skillId || phase}/SKILL.md`
        : `agents/${baseId}.md`);
    const cursorPath = `.cursor/${relPath}`;
    return {
      id,
      path: cursorPath,
      relPath,
      cursorPath,
      ...(synthetic ? { synthetic: true } : {}),
    };
  });
}

export function readAgentSpecContent(cursorRoot, relPath, maxChars = 8000) {
  const fullPath = path.join(cursorRoot, relPath);
  if (!fs.existsSync(fullPath)) return "";
  return fs.readFileSync(fullPath, "utf8").slice(0, maxChars);
}

export function resolveSubagentTypeForPhase(phase, phasesConfig) {
  const entry = phasesConfig?.phases?.[phase];
  if (entry?.readonly) return "explore";
  if (phase === "test_execute") return "generalPurpose";
  return "generalPurpose";
}
