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
  "discovery-inventory",
  "discovery-ssot",
  "dependency-analysis",
];

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseGraphSkillsAgents(graphText) {
  const skills = {};
  const lines = graphText.split("\n");
  let inSkills = false;
  let currentSkill = null;
  let inAgentsList = false;
  let agents = [];

  for (const line of lines) {
    if (line.startsWith("skills:")) {
      inSkills = true;
      continue;
    }
    if (inSkills && /^agents:/.test(line)) {
      inSkills = false;
      if (currentSkill && agents.length) {
        skills[currentSkill] = [...agents];
      }
      currentSkill = null;
      agents = [];
      continue;
    }
    if (!inSkills) continue;

    const skillMatch = line.match(/^  ([\w/-]+):\s*$/);
    if (skillMatch) {
      if (currentSkill && agents.length) {
        skills[currentSkill] = [...agents];
      }
      currentSkill = skillMatch[1];
      agents = [];
      inAgentsList = false;
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
      agents = [];
      inAgentsList = false;
      continue;
    }

    if (/^\s+agents:\s*$/.test(line)) {
      inAgentsList = true;
      agents = [];
      continue;
    }

    if (inAgentsList) {
      const itemMatch = line.match(/^\s+- ([\w-]+)\s*$/);
      if (itemMatch) {
        agents.push(itemMatch[1]);
        continue;
      }
      if (!/^\s+-/.test(line) && !/^\s*$/.test(line)) {
        inAgentsList = false;
        if (agents.length) {
          skills[currentSkill] = [...agents];
        }
        currentSkill = null;
        agents = [];
      }
    }
  }

  if (currentSkill && agents.length) {
    skills[currentSkill] = [...agents];
  }

  return skills;
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
  return {
    skillAgents: parseGraphSkillsAgents(graphText),
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

/** @returns {Array<{ id: string, path: string, relPath: string, cursorPath: string }>} */
export function resolveAgentSpecsForPhase({
  aaacRoot,
  phase,
  manifest,
  count = null,
}) {
  const phasesConfig = loadPhasesConfig(aaacRoot);
  const { skillAgents, agentPaths } = loadGraphSwarmConfig(aaacRoot);
  const skillId = resolveSwarmSkillId(phase, manifest, phasesConfig);

  let agentIds = skillId ? skillAgents[skillId] ?? [] : [];
  if (!agentIds.length) {
    agentIds = fallbackAgentIds(skillId, phase);
  }

  const specs = agentIds.map((id) => {
    const relPath = agentPaths[id] ?? `agents/${id}.md`;
    const cursorPath = `.cursor/${relPath}`;
    return { id, path: cursorPath, relPath, cursorPath };
  });

  if (count != null && count > 0 && specs.length > count) {
    return specs.slice(0, count);
  }

  return specs;
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
