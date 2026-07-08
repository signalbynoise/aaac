/**
 * Load swarm agent specs from graph.yaml + phases.json (SSOT).
 * Used by Agentic OS PhaseRunner and run telemetry.
 */
import fs from "fs";
import path from "path";

const PHASES_REL = "lifecycle/phases.json";
const GRAPH_REL = "graph.yaml";

const REMEDIATION_CHECK_SWARM_AGENTS = [
  "remediation-check-app-inventory",
  "remediation-check-app-ssot",
  "remediation-check-app-trace",
  "remediation-check-architecture-boundaries",
  "remediation-check-architecture-deps",
  "remediation-check-architecture-decomposition",
  "remediation-check-risk",
];

const INVESTIGATION_LITE_AGENTS = [
  "investigate-lite-exists",
  "investigate-lite-dependencies",
  "investigate-lite-constraints",
];

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseGraphSkillsAgents(graphText) {
  const skills = {};
  const optionalSkills = {};
  const lines = graphText.split("\n");
  let inSkills = false;
  let currentSkill = null;
  let listMode = null;
  let agents = [];

  function flushSkill() {
    if (!currentSkill) return;
    if (agents.length) {
      if (listMode === "optional_agents") {
        optionalSkills[currentSkill] = [...agents];
      } else {
        skills[currentSkill] = [...agents];
      }
    }
    agents = [];
    listMode = null;
  }

  for (const line of lines) {
    if (line.startsWith("skills:")) {
      inSkills = true;
      continue;
    }
    if (inSkills && /^agents:/.test(line) && !line.startsWith("  ")) {
      flushSkill();
      inSkills = false;
      currentSkill = null;
      continue;
    }
    if (!inSkills) continue;

    const skillMatch = line.match(/^  ([\w/-]+):\s*$/);
    if (skillMatch) {
      flushSkill();
      currentSkill = skillMatch[1];
      continue;
    }

    if (!currentSkill) continue;

    const inlineAgents = line.match(/^\s+agents: \[(.+)\]\s*$/);
    if (inlineAgents) {
      skills[currentSkill] = inlineAgents[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      currentSkill = null;
      listMode = null;
      agents = [];
      continue;
    }

    const inlineOptional = line.match(/^\s+optional_agents: \[(.+)\]\s*$/);
    if (inlineOptional) {
      optionalSkills[currentSkill] = inlineOptional[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    if (/^\s+agents:\s*$/.test(line)) {
      flushSkill();
      listMode = "agents";
      agents = [];
      continue;
    }

    if (/^\s+optional_agents:\s*$/.test(line)) {
      flushSkill();
      listMode = "optional_agents";
      agents = [];
      continue;
    }

    if (listMode) {
      const itemMatch = line.match(/^\s+- ([\w-]+)\s*$/);
      if (itemMatch) {
        agents.push(itemMatch[1]);
        continue;
      }
      if (!/^\s+-/.test(line) && !/^\s*$/.test(line)) {
        flushSkill();
      }
    }
  }

  flushSkill();

  return { skills, optionalSkills };
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

function fallbackAgentIds(skillId, phase) {
  if (skillId === "remediation-check-swarm") return REMEDIATION_CHECK_SWARM_AGENTS;
  if (skillId === "investigation-lite" || phase === "investigate_lite") {
    return INVESTIGATION_LITE_AGENTS;
  }
  return [];
}

function selectAgentIds(mandatory, optional, targetCount) {
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

  return selected.slice(0, targetCount);
}

/** @returns {Array<{ id: string, path: string, relPath: string, cursorPath: string }>} */
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
  let agentIds = mandatory.length ? mandatory : fallbackAgentIds(skillId, phase);

  if (count != null && count > 0) {
    agentIds = selectAgentIds(
      agentIds,
      optional.length ? optional : fallbackAgentIds(skillId, phase),
      count,
    );
  }

  return agentIds.map((id) => {
    const baseId = id.replace(/-wave-\d+$/, "");
    const relPath = agentPaths[baseId] ?? `agents/${baseId}.md`;
    const cursorPath = `.cursor/${relPath}`;
    return { id: baseId, path: cursorPath, relPath, cursorPath };
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
