const STEP_MIN = 8, STEP_MAX = 120, INITIAL_MAX = 180, STAGE_MAX = 280;
const GENERIC_ACTIVITY_NOUNS = [
  "activity", "artifact", "change", "code", "codebase", "command", "component", "file",
  "implementation", "issue", "item", "module", "operation", "process", "project", "request",
  "script", "step", "stuff", "system", "task", "test", "thing", "tool", "work", "workflow",
];
const GENERIC_ACTIVITY_OBJECT = `(?:(?:${GENERIC_ACTIVITY_NOUNS.join("|")})s?|it|something|that|this)`;
export const normalizeSemanticText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
function cutAtWord(text, max) {
  if (text.length <= max) return text; const candidate = text.slice(0, max);
  const boundary = candidate.lastIndexOf(" "), cut = boundary >= max * 0.6 ? boundary : max - 1; return `${candidate.slice(0, cut).trim()}…`;
}
export function hasTechnicalShape(text) {
  return (
    /`|https?:\/\/|(?:^|\s)(?:~?\/|\.{1,2}\/)[\w.@-]+/i.test(text) ||
    /(?:^|\s)[A-Za-z]:\\/.test(text) ||
    /(?:^|\s)(?:npm|pnpm|yarn|node|git|bash|sh|zsh)\s+[-\w./]/i.test(text) ||
    /(?:^|\s)(?:tokens|context|duration_ms|agent_index|exit_code|stdout|stderr)=\S+/i.test(text) || /^\s*[{[]/.test(text) ||
    /(?:^|\s)(?:[\w.@-]+\/){2,}[\w.@-]+(?:\s|$)/i.test(text) ||
    /(?:^|\s)(?:apps|packages|\.cursor)\/[\w./-]+/i.test(text) ||
    /(?:^|\s)@[a-z0-9-]+\/[a-z0-9-]+/i.test(text) ||
    /\b[A-Za-z_$][\w$]*\s*\[[^\]\r\n]+\](?:\s*\([^)\r\n]*\))?/.test(text) ||
    /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/.test(text) ||
    /\b[A-Za-z_$][\w$]*\([^)\r\n]*\)/.test(text) ||
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i.test(text) ||
    /\b[a-z]+(?:[A-Z][A-Za-z0-9]*)+\b/.test(text) ||
    /(?:=>|::|[{}])/.test(text) ||
    /(?:^|\s)[\w.@-]+\/[\w.@-]+\.[\w-]+(?::\d+)?(?:\s|$)/i.test(text) ||
    /(?:^|\s)[\w.-]+\.(?:m?js|cjs|ts|tsx|json|ya?ml|md|sh)(?::\d+)?(?:\s|$)/i.test(text)
  );
}
export function hasGenericActivityObject(text) {
  const phrase = normalizeSemanticText(text).replace(/[.!?]+$/, "").toLowerCase();
  const article = "(?:(?:a|an|the|some)\\s+)?";
  const vagueWorking = new RegExp(
    `^(?:currently\\s+)?(?:looking\\s+into|working\\s+(?:on|through))\\s+${article}${GENERIC_ACTIVITY_OBJECT}$`,
    "i",
  );
  const genericAction = new RegExp(
    `^(?:currently\\s+)?(?:checking|creating|editing|executing|fixing|handling|implementing|inspecting|reading|reviewing|running|testing|updating|using|writing)\\s+${article}${GENERIC_ACTIVITY_OBJECT}$`,
    "i",
  );
  return vagueWorking.test(phrase) || genericAction.test(phrase);
}
export function validateSemanticSummary(value, options = {}) {
  const text = normalizeSemanticText(value);
  const minLength = options.minLength ?? STEP_MIN;
  const maxLength = options.maxLength ?? STEP_MAX;
  return text.length < minLength || text.length > maxLength ||
    hasTechnicalShape(text) || hasGenericActivityObject(text)
    ? null
    : text;
}
export function latestPhaseAttemptStartAt(log, phase) {
  for (let index = (log?.length ?? 0) - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (entry?.phase === phase && entry?.event === "phase_start") return entry.at ?? null;
  }
  return null;
}
export function filterAgentsToLatestPhaseAttempt(agents, log, phase) {
  const phaseAgents = (agents ?? []).filter((agent) => agent.phase === phase);
  const attemptStart = latestPhaseAttemptStartAt(log, phase);
  if (!attemptStart) return phaseAgents;
  const startMs = Date.parse(attemptStart);
  if (!Number.isFinite(startMs)) return phaseAgents;
  return phaseAgents.filter((agent) => {
    const startedMs = Date.parse(agent.started_at ?? agent.at ?? "");
    return Number.isFinite(startedMs) && startedMs >= startMs;
  });
}
export function validateCurrentStep(value) {
  return validateSemanticSummary(value);
}
export function validateInitialSummary(value) {
  return validateSemanticSummary(value, { maxLength: INITIAL_MAX });
}
export function validateSealedSummary(value) {
  if (typeof value !== "string" || /```/.test(value)) return null;
  const text = normalizeSemanticText(value);
  return validateSemanticSummary(text, { maxLength: INITIAL_MAX });
}
export function validateStageSummary(value) {
  if (typeof value !== "string" || /```|\*\*/.test(value)) return null;
  const text = normalizeSemanticText(value);
  if (/^(?:[-*]\s+)?[\w.-]+\s*:\s*\S+/.test(text)) return null;
  return validateSemanticSummary(text, { minLength: 20, maxLength: STAGE_MAX });
}
export function validateFinalSummary(value) {
  if (typeof value !== "string" || /```/.test(value)) return null;
  const lines = value.split(/\r?\n/).map(normalizeSemanticText).filter(Boolean);
  if (lines.length < 1 || lines.length > 2) return null;
  if (lines.some((line) => !validateSemanticSummary(line))) return null;
  return lines.join("\n");
}
export function extractRoleInitialSummary(specContent) {
  const lines = String(specContent ?? "").split(/\r?\n/), roleIndex = lines.findIndex((line) => /^#{1,6}\s+Role\s*$/i.test(line.trim()));
  if (roleIndex < 0) return null;
  const paragraph = [];
  for (const raw of lines.slice(roleIndex + 1)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) break;
    if (!line && paragraph.length) break;
    if (line) paragraph.push(line.replace(/^[-*]\s+/, ""));
  }
  return validateInitialSummary(cutAtWord(normalizeSemanticText(paragraph.join(" ")), INITIAL_MAX));
}
export function normalizeSubagentId(value) {
  const normalized = value == null ? "" : String(value).replace(/\n+/g, "").trim(); return normalized || null;
}
export function findAgentArrayIndexBySubagentId(manifest, phase, subagentId) {
  const target = normalizeSubagentId(subagentId);
  if (!target) return null;
  const index = (manifest.swarm?.agents ?? []).findIndex(
    (agent) => agent.phase === phase && normalizeSubagentId(agent.subagent_id) === target,
  );
  return index >= 0 ? index : null;
}
export function findAgentIndexToComplete(manifest, phase) {
  const agents = manifest.swarm?.agents ?? [];
  for (let index = agents.length - 1; index >= 0; index -= 1) {
    if (agents[index].phase === phase && !agents[index].completed_at) return index;
  }
  for (let index = agents.length - 1; index >= 0; index -= 1) {
    if (agents[index].phase === phase) return index;
  }
  return null;
}
export function findAgentArrayIndexByPhasePosition(manifest, phase, position = 0) {
  const matches = (manifest.swarm?.agents ?? [])
    .map((agent, arrayIndex) => ({ agent, arrayIndex }))
    .filter(({ agent }) => agent.phase === phase);
  const incomplete = matches.filter(({ agent }) => !agent.completed_at);
  return (incomplete.length ? incomplete : matches)[position]?.arrayIndex ??
    findAgentIndexToComplete(manifest, phase);
}
function resolveAgentIndex(manifest, { phase, subagentId, agentIndex }) {
  return findAgentArrayIndexBySubagentId(manifest, phase, subagentId) ??
    (agentIndex != null && agentIndex >= 0
      ? findAgentArrayIndexByPhasePosition(manifest, phase, agentIndex)
      : findAgentIndexToComplete(manifest, phase));
}
export function classifyToolFileMutation(toolName) {
  if (["Grep", "Glob", "SemanticSearch"].includes(toolName)) return "search";
  if (toolName === "Read") return "read";
  if (toolName === "Write") return "written";
  if (["StrReplace", "Delete"].includes(toolName)) return "edited";
  return null;
}

function isFullFileReadInput(toolInput = {}) {
  const hasOffset =
    toolInput.offset != null ||
    toolInput.start_line != null ||
    toolInput.startLine != null;
  const hasLimit =
    toolInput.limit != null ||
    toolInput.end_line != null ||
    toolInput.endLine != null;
  return !hasOffset && !hasLimit;
}
export function formatHookProgressSummary(hook = {}) {
  const toolName = String(hook.tool_name ?? hook.toolName ?? "");
  if (!toolName.endsWith("UpdateCurrentStep")) return null;
  const input = hook.tool_input ?? hook.toolInput ?? hook.arguments ?? {};
  return validateCurrentStep(input.current_step ?? input.currentStep);
}
export function applyAgentToolProgress(manifest, options = {}) {
  const phase = options.phase ?? manifest.phase;
  manifest.swarm = manifest.swarm ?? { task_launches_this_phase: 0, phase, agents: [] };
  manifest.swarm.agents = manifest.swarm.agents ?? [];
  const index = resolveAgentIndex(manifest, {
    phase,
    subagentId: options.hook?.subagent_id ?? options.hook?.subagentId,
    agentIndex: options.agentIndex,
  });
  if (index == null) return { applied: false, arrayIndex: null, mutation: null };
  const prior = manifest.swarm.agents[index];
  const mutation = classifyToolFileMutation(options.toolName ?? options.hook?.tool_name);
  const source = ["metered_hook", "metered_bridge"].includes(prior.files_source)
    ? prior.files_source
    : (options.filesSource ?? "metered_hook");
  const toolInput =
    options.toolInput ??
    options.hook?.tool_input ??
    options.hook?.toolInput ??
    options.hook?.arguments ??
    {};
  const next = {
    ...prior,
    files_source: source,
    files_read: prior.files_read ?? 0,
    files_written: prior.files_written ?? 0,
    files_edited: prior.files_edited ?? 0,
    full_file_opens: prior.full_file_opens ?? 0,
    gap_searches: prior.gap_searches ?? 0,
  };
  if (mutation === "read") {
    next.files_read += 1;
    if (isFullFileReadInput(toolInput)) next.full_file_opens += 1;
  }
  if (mutation === "search") {
    next.files_read += 1; // keep aggregate for legacy metrics
    next.gap_searches += 1;
  }
  if (mutation === "written") next.files_written += 1;
  if (mutation === "edited") next.files_edited += 1;
  manifest.swarm.agents[index] = next;
  return { applied: true, arrayIndex: index, mutation, summary: null, sealed: Boolean(prior.completed_at) };
}
export function applyAgentSemanticProgress(manifest, options = {}) {
  const phase = options.phase ?? manifest.phase;
  manifest.swarm = manifest.swarm ?? { task_launches_this_phase: 0, phase, agents: [] };
  manifest.swarm.agents = manifest.swarm.agents ?? [];
  const index = resolveAgentIndex(manifest, { phase, ...options });
  const summary = validateCurrentStep(options.currentStep);
  if (index == null || !summary) return { applied: false, arrayIndex: index, summary: null };
  const prior = manifest.swarm.agents[index];
  if (prior.completed_at) return { applied: false, arrayIndex: index, summary: null, sealed: true };
  manifest.swarm.agents[index] = { ...prior, last_progress: summary };
  return { applied: true, arrayIndex: index, summary, sealed: false };
}
export function applyAgentFinalSummaryCandidate(manifest, options = {}) {
  const phase = options.phase ?? manifest.phase;
  const index = resolveAgentIndex(manifest, { phase, ...options });
  const summary = validateSealedSummary(options.finalSummary);
  const prior = index == null ? null : manifest.swarm?.agents?.[index];
  if (!prior || prior.completed_at || !summary)
    return { applied: false, arrayIndex: index, summary: null };
  manifest.swarm.agents[index] = { ...prior, final_summary_candidate: summary };
  return { applied: true, arrayIndex: index, summary };
}
function durationMsBetween(start, end) {
  if (!start || !end) return null; const duration = Date.parse(end) - Date.parse(start); return duration >= 0 ? duration : null;
}
function parseDetailMetric(detail, key) {
  const match = String(detail ?? "").match(new RegExp(`${key}=(\\d+(?:\\.\\d+)?)`)); return match ? Number(match[1]) : null;
}
function finiteTokenComponent(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;
}

function resolveTokenComponents(options) {
  return {
    input_tokens:
      finiteTokenComponent(options.input_tokens ?? options.inputTokens) ??
      parseDetailMetric(options.detail, "input"),
    output_tokens:
      finiteTokenComponent(options.output_tokens ?? options.outputTokens) ??
      parseDetailMetric(options.detail, "output"),
    cache_read_tokens:
      finiteTokenComponent(options.cache_read_tokens ?? options.cacheReadTokens) ??
      parseDetailMetric(options.detail, "cache_read"),
    cache_write_tokens:
      finiteTokenComponent(options.cache_write_tokens ?? options.cacheWriteTokens) ??
      parseDetailMetric(options.detail, "cache_write"),
  };
}

function totalFromComponents(components) {
  const parts = [
    components.input_tokens,
    components.output_tokens,
    components.cache_read_tokens,
    components.cache_write_tokens,
  ].filter((value) => value != null);
  if (!parts.length) return null;
  return parts.reduce((sum, value) => sum + value, 0);
}

function resolveCompletionMetrics(options) {
  const components = resolveTokenComponents(options);
  const tokens =
    options.tokens ??
    parseDetailMetric(options.detail, "tokens") ??
    totalFromComponents(components);
  return {
    tokens,
    context: options.context ?? parseDetailMetric(options.detail, "context") ??
      parseDetailMetric(options.detail, "score"),
    ...components,
  };
}
function resolveCompletionSummary(prior, finalSummary) {
  const initialSummary = validateInitialSummary(prior?.initial_summary);
  const currentSummary = validateCurrentStep(prior?.last_progress);
  const stored = initialSummary && normalizeSemanticText(prior?.last_progress) === initialSummary
    ? initialSummary
    : currentSummary ?? initialSummary;
  return validateSealedSummary(prior?.summary) ?? validateSealedSummary(finalSummary) ??
    validateSealedSummary(prior?.final_summary_candidate) ??
    validateSealedSummary(stored);
}
function hasMeteredFiles(prior) {
  return ["metered_hook", "metered_bridge", "metered_legacy"].includes(prior?.files_source) ||
    ["files_read", "files_written", "files_edited"].some((key) => prior?.[key] != null);
}
function completedTokenFields(prior, options, tokens, context, components) {
  const tokenSource = options.tokenSource ?? prior?.token_source;
  const sealedTokens = tokens ?? prior?.tokens ?? null;
  return {
    cursor_run_id: options.cursorRunId ?? prior?.cursor_run_id ?? null,
    tokens: sealedTokens,
    context: context ?? prior?.context ?? null,
    input_tokens: components.input_tokens ?? prior?.input_tokens ?? null,
    output_tokens: components.output_tokens ?? prior?.output_tokens ?? null,
    cache_read_tokens: components.cache_read_tokens ?? prior?.cache_read_tokens ?? null,
    cache_write_tokens: components.cache_write_tokens ?? prior?.cache_write_tokens ?? null,
    token_source: sealedTokens != null || prior?.tokens != null
      ? (tokenSource ?? "cursor_hook")
      : "unavailable",
  };
}
function completedFileFields(prior) {
  const metered = hasMeteredFiles(prior);
  return {
    files_read: metered ? prior?.files_read ?? 0 : null,
    files_written: metered ? prior?.files_written ?? 0 : null,
    files_edited: metered ? prior?.files_edited ?? 0 : null,
    files_source: metered ? (prior?.files_source ?? "metered_legacy") : "unavailable",
  };
}
function buildCompletedAgentEntry(prior, completion) {
  const { phase, phaseSlot, completedAt, options, tokens, context, components } = completion;
  const startedAt = prior?.started_at ?? prior?.at ?? completedAt;
  const entry = {
    ...(prior ?? { index: phaseSlot, phase, description: `${phase} agent ${phaseSlot}` }),
    phase,
    completed_at: completedAt,
    started_at: startedAt,
    duration_ms: durationMsBetween(startedAt, completedAt),
    ...completedTokenFields(prior, options, tokens, context, components),
    ...completedFileFields(prior),
  };
  delete entry.summary;
  delete entry.last_progress;
  delete entry.final_summary_candidate;
  if (completion.summary) entry.summary = completion.summary;
  return entry;
}
function storeCompletedAgent(manifest, index, entry) {
  if (index == null) {
    manifest.swarm.agents.push(entry);
    return manifest.swarm.agents.length - 1;
  }
  manifest.swarm.agents[index] = entry;
  return index;
}
function updatePhaseCompletionMetrics(manifest, phase, tokens, context) {
  manifest.phase_metrics = manifest.phase_metrics ?? {};
  const phaseMetrics = manifest.phase_metrics[phase] ?? {};
  manifest.phase_metrics[phase] = {
    ...phaseMetrics,
    ...(tokens != null ? { tokens: (phaseMetrics.tokens ?? 0) + tokens } : {}),
    ...(context != null ? { context: Math.max(phaseMetrics.context ?? 0, context) } : {}),
  };
}
export function applyAgentComplete(manifest, options = {}) {
  const phase = options.phase ?? manifest.phase;
  const completedAt = options.completedAt ?? new Date().toISOString();
  manifest.swarm = manifest.swarm ?? { task_launches_this_phase: 0, phase, agents: [] };
  manifest.swarm.agents = manifest.swarm.agents ?? [];
  let index = resolveAgentIndex(manifest, { phase, ...options });
  const prior = index == null ? null : manifest.swarm.agents[index];
  const { tokens, context, ...components } = resolveCompletionMetrics(options);
  const phaseSlot = options.agentIndex != null ? options.agentIndex + 1 : (prior?.index ?? 1);
  const entry = buildCompletedAgentEntry(prior, {
    phase, phaseSlot, completedAt, options, tokens, context, components,
    summary: resolveCompletionSummary(prior, options.finalSummary),
  });
  index = storeCompletedAgent(manifest, index, entry);
  updatePhaseCompletionMetrics(manifest, phase, tokens, context);
  return { agentIndex: index, phaseSlot, agentEntry: entry, tokens, context, durationMs: entry.duration_ms };
}
