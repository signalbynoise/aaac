import fs from "fs";
import path from "path";
import { createLogger } from "./logger.mjs";
import { resolveWorkspacePaths } from "./paths.mjs";
import {
  readAgentSpecContent,
  resolveAgentSpecsForPhase,
  loadPhasesConfig as loadPhasesConfigFromAaac,
} from "@ludecker/aaac/run-engine/swarm-agent-specs";
import {
  extractRoleInitialSummary,
} from "@ludecker/aaac/run-engine/agent-progress-contract";

const log = createLogger("agentic-bridge:prompt-compose");

export function loadPhasesConfig(workspaceRoot) {
  const { aaacRoot } = resolveWorkspacePaths(workspaceRoot);
  return loadPhasesConfigFromAaac(aaacRoot);
}

export function getSwarmAgentSpecs(workspaceRoot, manifest, phase, count) {
  const { aaacRoot } = resolveWorkspacePaths(workspaceRoot);
  return resolveAgentSpecsForPhase({
    aaacRoot,
    phase,
    manifest,
    count,
  });
}

export function resolveSkillForPhase(workspaceRoot, phase) {
  const config = loadPhasesConfig(workspaceRoot);
  const entry = config.phases?.[phase];
  if (!entry) return null;
  return entry.skill ?? entry.skills?.[0] ?? null;
}

function readOptionalFile(filePath, maxChars) {
  return filePath && fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").slice(0, maxChars)
    : "";
}

function readPolicySnippets(cursorRoot) {
  return [
    "policies/master-rules.md",
    "policies/implementation.md",
    "policies/mcp-and-deploy.md",
  ]
    .map((rel) => readOptionalFile(path.join(cursorRoot, rel), 2000))
    .filter(Boolean)
    .join("\n---\n");
}

export function composePhasePrompt(workspaceRoot, manifest, phase) {
  const { aaacRoot, cursorRoot, runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const skill = resolveSkillForPhase(workspaceRoot, phase);
  const artifactsDir = path.join(runsRoot, manifest.run_id, "artifacts");
  const skillPath = skill
    ? path.join(cursorRoot, "skills", "shared", skill, "SKILL.md")
    : null;
  const skillContent = readOptionalFile(skillPath, Number.POSITIVE_INFINITY);
  const policySnippets = readPolicySnippets(cursorRoot);

  const prompt = `# AAAC Phase Execution — Agentic OS

You are executing phase **${phase}** for Run \`${manifest.run_id}\`.

## Command
- Command: /${manifest.command}
- Domain: ${manifest.domain ?? "none"}
- Intent: ${manifest.intent}
- Verb: ${manifest.verb}
- Current phase: ${phase} (${manifest.phase_kind})
- Swarm target (Task agents): ${manifest.swarm?.target_agents?.[phase] ?? "see swarm-sizing.yaml floor"}
- Scope score: ${manifest.complexity?.scope_score ?? "pending"}
- Change score: ${manifest.complexity?.change_score ?? "pending"}

## Completed phases
${(manifest.completed ?? []).join(", ") || "none"}

## Pending phases
${(manifest.pending ?? []).join(", ") || "none"}

## Artifacts directory
Write phase outputs to: \`${artifactsDir}\`

Required artifact filenames by phase (when applicable):
- discover → ${manifest.verb === "check" ? "artifacts/discover_brief.yaml (must include answer: field, max 10 evidence list items)" : "artifacts/investigation.md or discovery summary"}
- investigate_swarm → artifacts/investigation.md
- root_cause → artifacts/root_cause.md
- plan → artifacts/plan.yaml (include tests_to_add)
- report → artifacts/report.md

Update Run manifest confidence fields when this phase produces them.

## Policies (summary)
${policySnippets.slice(0, 4000)}

## Phase skill
${skillContent.slice(0, 12000)}

## Agentic OS execution contract (mandatory)
- **Do NOT** run \`advance-phase.mjs\`, \`approve-run.mjs\`, or \`resume-run.mjs\`.
- PhaseRunner advances phases after you finish; only write artifacts to the artifacts directory.
- Do not change \`run.json\` directly.

Execute this phase completely. Write artifacts to disk. Do not skip validation steps.
`;

  log.debug("compose", "Phase prompt composed", {
    runId: manifest.run_id,
    phase,
    skill,
  });

  return prompt;
}

export function composeSwarmAgentPrompt(
  workspaceRoot,
  manifest,
  phase,
  agentIndex,
  agentTotal,
  agentSpec,
) {
  const { cursorRoot } = resolveWorkspacePaths(workspaceRoot);
  const specContent = agentSpec
    ? readAgentSpecContent(cursorRoot, agentSpec.relPath)
    : "";

  const taskPolicyPath = path.join(cursorRoot, "skills/shared/_task-prompt-policy.md");
  const taskPolicy = fs.existsSync(taskPolicyPath)
    ? fs.readFileSync(taskPolicyPath, "utf8").slice(0, 3000)
    : "";

  const base = composePhasePrompt(workspaceRoot, manifest, phase);

  const agentSection = agentSpec
    ? `## Agent spec (mandatory)
- Agent id: \`${agentSpec.id}\`
- Spec path: \`${agentSpec.cursorPath}\`

${specContent || "(spec file not found on disk)"}
`
    : `## Agent role
Swarm slot ${agentIndex + 1} of ${agentTotal} — follow the phase skill angle for this index.
`;

  return `${base}

${agentSection}

## Task prompt policy
${taskPolicy}

## Swarm agent ${agentIndex + 1} of ${agentTotal}
Focus on the angle defined in the agent spec above. Write findings to:
artifacts/${phase}_agent_${agentIndex + 1}.md

Return structured blocks: Findings, Evidence (path:line), Gaps, Confidence.

Do **not** write phase checkpoint artifacts (e.g. discover_brief.yaml, investigation.md) — a separate orchestrator synthesis step runs after all swarm agents finish.
`;
}

export function getAgentInitialSummary(workspaceRoot, agentSpec) {
  if (!agentSpec) return null;
  const { cursorRoot } = resolveWorkspacePaths(workspaceRoot);
  return extractRoleInitialSummary(readAgentSpecContent(cursorRoot, agentSpec.relPath));
}

export function composeSwarmCheckpointPrompt(
  workspaceRoot,
  manifest,
  phase,
  swarmAgentCount,
  missingArtifacts,
) {
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const artifactsDir = path.join(runsRoot, manifest.run_id, "artifacts");
  const swarmOutputs = Array.from({ length: swarmAgentCount }, (_, i) =>
    path.join(artifactsDir, `${phase}_agent_${i + 1}.md`),
  ).join("\n- ");
  const targets = missingArtifacts.map((rel) => `- \`${rel}\``).join("\n");

  return `# AAAC Swarm Checkpoint — Agentic OS

You are the **orchestrator synthesis step** after the ${phase} swarm (${swarmAgentCount} agents) for Run \`${manifest.run_id}\`.

## Command
- Command: /${manifest.command}
- Intent: ${manifest.intent}
- Phase: ${phase}

## Swarm outputs (read these; do not re-run discovery)
- ${swarmOutputs}

## Required checkpoint artifacts (write all missing)
${targets}

Merge swarm findings into compact checkpoint files only.
- Check discover: \`artifacts/discover_brief.yaml\` must include \`answer:\` and at most 10 evidence list items.
- Fix investigate_swarm: \`artifacts/investigation.md\` with merged findings per investigation skill.

## Agentic OS execution contract
- Write artifacts under \`${artifactsDir}\`
- Do **not** run advance-phase, approve-run, or resume-run
- Do not change run.json
`;
}
