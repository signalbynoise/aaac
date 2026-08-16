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

const MAX_INLINE_PACKET_CHARS = 14_000;
const MAX_ENVELOPE_CHARS = 600;
const MAX_FOCUS_PATHS = 24;
const MAX_READ_PACK_ITEMS = 8;
const MAX_LESSONS = 5;

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

/**
 * Load phase_context.json for a run (repo memory packet).
 */
export function loadPhaseContextPacket(workspaceRoot, runId) {
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const pcPath = path.join(runsRoot, runId, "artifacts", "phase_context.json");
  if (!fs.existsSync(pcPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pcPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Compact inlined graph packet for swarm prompts — finding is graph-native.
 */
export function formatInlineRepoMemoryPacket(phaseContext) {
  if (!phaseContext) {
    return `## Repo vector graph packet
(none — phase_context.json missing; emit retrieval_miss if you cannot proceed without finding tools)
`;
  }

  const rm = phaseContext.experience?.repo_memory ?? {};
  const budgets = rm.meta?.read_budgets ?? {};
  const focusPaths = (rm.focus_paths ?? []).slice(0, MAX_FOCUS_PATHS);
  const lessons = (phaseContext.experience?.lessons ?? []).slice(0, MAX_LESSONS);
  const spans = rm.focus_spans ?? rm.read_pack?.spans ?? [];
  const packItems = Array.isArray(rm.read_pack)
    ? rm.read_pack
    : spans.length
      ? spans
      : rm.read_pack?.files ?? [];

  const lines = [
    "## Repo vector graph packet (SSOT for FINDING)",
    "",
    "**Finding is graph-native. You can only inspect granted SOURCE context.**",
    "- Find paths/symbols **only** from this packet — do **not** Glob, Grep, or list directories.",
    "- **Read** granted paths only (prefer envelope_text → symbol range → full file).",
    "- If this packet is insufficient: call **request_context** (`need`, `because`, optional granted `anchor`). Do **not** retry illegal Reads. The run engine may expand the grant set.",
    "",
    `Budgets: max_agent_files_read=${budgets.max_agent_files_read ?? 6}, max_full_file_opens=${budgets.max_full_file_opens ?? 2}, max_gap_search_globs=${budgets.max_gap_search_globs ?? 8}`,
    `authorized_fallback: ${phaseContext.authorized_fallback?.enabled ? JSON.stringify({
      paths: phaseContext.authorized_fallback.paths,
      tools: phaseContext.authorized_fallback.tools,
      max_searches: phaseContext.authorized_fallback.max_searches,
    }) : "none (finding-tools denied)"}`,
    "",
    "### focus_paths",
    focusPaths.length ? focusPaths.map((p) => `- ${p}`).join("\n") : "(empty)",
    "",
    "### read_pack / envelopes",
  ];

  let used = lines.join("\n").length;
  let n = 0;
  for (const item of packItems) {
    if (n >= MAX_READ_PACK_ITEMS) break;
    const p = item?.path ?? item?.file ?? "?";
    const env = String(item?.envelope_text ?? item?.text ?? "").slice(0, MAX_ENVELOPE_CHARS);
    const start = item?.start ?? item?.start_line ?? "";
    const end = item?.end ?? item?.end_line ?? "";
    const block = `\n#### ${p}${start !== "" ? `:${start}-${end}` : ""}\n\`\`\`\n${env || "(no envelope)"}\n\`\`\`\n`;
    if (used + block.length > MAX_INLINE_PACKET_CHARS) break;
    lines.push(block);
    used += block.length;
    n += 1;
  }
  if (n === 0) lines.push("(empty read_pack)");

  lines.push("", "### lessons");
  if (lessons.length) {
    for (const lesson of lessons) {
      const id = lesson.id ?? lesson.lesson_id ?? "lesson";
      const summary = String(lesson.summary ?? lesson.title ?? lesson.remedy ?? "").slice(0, 200);
      lines.push(`- ${id}: ${summary}`);
    }
  } else {
    lines.push("(none)");
  }

  const impact = rm.impact ?? rm.relations?.impact;
  if (impact && Array.isArray(impact) && impact.length) {
    lines.push("", "### impact (trust as structure)", ...impact.slice(0, 8).map((x) => `- ${typeof x === "string" ? x : JSON.stringify(x).slice(0, 120)}`));
  }

  let text = lines.join("\n");
  if (text.length > MAX_INLINE_PACKET_CHARS) {
    text = `${text.slice(0, MAX_INLINE_PACKET_CHARS)}\n…(packet truncated)`;
  }
  return text;
}

export function composePhasePrompt(workspaceRoot, manifest, phase) {
  const { cursorRoot, runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const skill = resolveSkillForPhase(workspaceRoot, phase);
  const artifactsDir = path.join(runsRoot, manifest.run_id, "artifacts");
  const skillPath = skill
    ? path.join(cursorRoot, "skills", "shared", skill, "SKILL.md")
    : null;
  const skillContent = readOptionalFile(skillPath, Number.POSITIVE_INFINITY);
  const policySnippets = readPolicySnippets(cursorRoot);
  const phaseContext = loadPhaseContextPacket(workspaceRoot, manifest.run_id);
  const inlinePacket = formatInlineRepoMemoryPacket(phaseContext);

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

${inlinePacket}

## Policies (summary)
${policySnippets.slice(0, 4000)}

## Phase skill
${skillContent.slice(0, 12000)}

## Agentic OS execution contract (mandatory)
- **Do NOT** run \`advance-phase.mjs\`, \`approve-run.mjs\`, or \`resume-run.mjs\`.
- PhaseRunner advances phases after you finish; only write artifacts to the artifacts directory.
- Do not change \`run.json\` directly.
- On graph miss: write retrieval_miss (sought + reason) via \`node .cursor/aaac/scripts/run-engine/record-retrieval-miss.mjs --run-id ${manifest.run_id} --sought "…" --reason not_in_focus\` — never silent Glob/Grep.

Execute this phase completely. Write artifacts to disk. Do not skip validation steps.
`;

  log.debug("compose", "Phase prompt composed", {
    runId: manifest.run_id,
    phase,
    skill,
    packetChars: inlinePacket.length,
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
.aaac/OUTPUT.md

Return structured blocks: Findings, Evidence (path:line), Gaps, Confidence.
If you need a source file that is not granted, call request_context — do not search the filesystem.

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
