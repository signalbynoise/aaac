/**
 * Graph-native finding / filesystem-native reading — pure evaluation API.
 * Finding tools (Glob / unscoped Grep / SemanticSearch) are denied unless
 * phase_context.authorized_fallback deliberately allows them after a retrieval_miss.
 */

export const FINDING_TOOLS = /^(Grep|Glob|SemanticSearch)$/i;
export const READ_TOOL = /^Read$/i;

const DEFAULT_BUDGETS = {
  max_agent_files_read: 6,
  max_full_file_opens: 2,
  max_gap_search_globs: 8,
};

/**
 * @param {string} p
 * @returns {string}
 */
const OPERATIONAL_READ_PREFIXES = [
  ".cursor/aaac/state/runs/",
  ".cursor/agents/",
  ".cursor/skills/",
];

export function workspaceRootForPaths() {
  return String(process.env.AAAC_WORKSPACE_ROOT || process.cwd())
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
}

export function normalizeRepoPath(p) {
  let n = String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^file:\/\//, "")
    .replace(/^\.\//, "")
    .trim();
  if (!n) return "";
  const root = workspaceRootForPaths();
  if (root && (n === root || n.startsWith(`${root}/`))) {
    n = n.slice(root.length).replace(/^\//, "");
  }
  return n;
}

export function isOperationalReadPath(p) {
  const n = normalizeRepoPath(p);
  return OPERATIONAL_READ_PREFIXES.some((prefix) => n.startsWith(prefix));
}

/**
 * @param {object|null|undefined} phaseContext
 * @returns {string[]}
 */
export function knownPathsFromPhaseContext(phaseContext) {
  const pc = phaseContext ?? {};
  const rm = pc.experience?.repo_memory ?? pc.repo_memory ?? {};
  const out = new Set();
  const add = (p) => {
    const n = normalizeRepoPath(p);
    if (n) out.add(n);
  };
  for (const p of rm.focus_paths ?? []) add(p);
  for (const p of rm.healed_paths ?? []) add(p);
  for (const p of pc.healed_paths ?? []) add(p);
  for (const n of rm.nodes ?? []) add(n?.path);
  for (const s of rm.focus_spans ?? []) add(s?.path);
  const pack = rm.read_pack;
  if (Array.isArray(pack)) {
    for (const item of pack) add(item?.path);
  } else if (pack && typeof pack === "object") {
    for (const s of pack.spans ?? []) add(s?.path);
    for (const f of pack.files ?? []) add(f?.path ?? f);
  }
  const af = getAuthorizedFallback(pc);
  for (const p of af?.paths ?? []) add(p);
  return [...out];
}

/**
 * @param {object|null|undefined} phaseContext
 * @returns {{ enabled: boolean, paths: string[], tools: string[], max_searches: number } | null}
 */
export function getAuthorizedFallback(phaseContext) {
  const raw =
    phaseContext?.authorized_fallback ??
    phaseContext?.experience?.repo_memory?.meta?.authorized_fallback ??
    null;
  if (!raw || typeof raw !== "object") return null;
  if (raw.enabled === false) return null;
  const paths = (raw.paths ?? []).map(normalizeRepoPath).filter(Boolean);
  const tools = (raw.tools ?? ["Grep"]).map((t) => String(t));
  const max_searches = Number.isFinite(Number(raw.max_searches))
    ? Number(raw.max_searches)
    : 2;
  return { enabled: true, paths, tools, max_searches };
}

/**
 * @param {object|null|undefined} phaseContext
 * @param {object|null|undefined} retrievalDefaults
 */
export function budgetsFromPhaseContext(phaseContext, retrievalDefaults = {}) {
  const defaults = {
    max_agent_files_read:
      retrievalDefaults.max_agent_files_read ?? DEFAULT_BUDGETS.max_agent_files_read,
    max_full_file_opens:
      retrievalDefaults.max_full_file_opens ?? DEFAULT_BUDGETS.max_full_file_opens,
    max_gap_search_globs:
      retrievalDefaults.max_gap_search_globs ?? DEFAULT_BUDGETS.max_gap_search_globs,
  };
  const rb = phaseContext?.experience?.repo_memory?.meta?.read_budgets;
  if (rb && typeof rb === "object") {
    for (const key of Object.keys(defaults)) {
      if (Number.isFinite(Number(rb[key]))) defaults[key] = Number(rb[key]);
    }
  }
  return defaults;
}

/**
 * @param {string} toolName
 * @param {object} toolInput
 */
export function isFullFileRead(toolName, toolInput = {}) {
  if (!READ_TOOL.test(toolName)) return false;
  const input = toolInput ?? {};
  const hasOffset =
    input.offset != null || input.start_line != null || input.startLine != null;
  const hasLimit =
    input.limit != null || input.end_line != null || input.endLine != null;
  return !hasOffset && !hasLimit;
}

/**
 * Path scope from Grep/Glob/Read tool input.
 * @param {object} toolInput
 * @returns {string|null}
 */
export function toolPathScope(toolInput = {}) {
  const input = toolInput ?? {};
  const raw =
    input.path ??
    input.file_path ??
    input.filePath ??
    input.target_directory ??
    input.glob ??
    input.glob_pattern ??
    null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeRepoPath(raw);
}

/**
 * True when Grep/Glob path is under a known or authorized path.
 * @param {string|null} scope
 * @param {string[]} knownPaths
 */
export function pathInKnownSet(scope, knownPaths) {
  if (!scope) return false;
  const s = normalizeRepoPath(scope);
  return knownPaths.some((k) => {
    const known = normalizeRepoPath(k);
    return s === known || s.startsWith(`${known}/`) || known.startsWith(`${s}/`);
  });
}

/**
 * Evaluate finding-tool access (Glob / Grep / SemanticSearch).
 * @returns {{ allow: boolean, reason?: string, message?: string }}
 */
export function evaluateFindingTool({
  toolName,
  toolInput = {},
  phaseContext = null,
  gapSearchesUsed = 0,
} = {}) {
  if (!FINDING_TOOLS.test(toolName)) {
    return { allow: true };
  }

  const missMsg =
    "Finding is graph-native. Do not Glob/Grep the repo. A retrieval_miss is recorded automatically so the index can expand, repair, or authorize fallback. Read known paths from the inlined packet with the Read tool.";
  const sought =
    toolPathScope(toolInput) ||
    String(toolInput?.pattern ?? toolInput?.query ?? toolName).trim() ||
    toolName;

  const fallback = getAuthorizedFallback(phaseContext);
  if (!fallback) {
    return {
      allow: false,
      reason: "finding_requires_authorized_fallback",
      message: missMsg,
      miss: { sought, reason: "not_in_focus" },
    };
  }

  const toolOk = fallback.tools.some((t) => new RegExp(`^${t}$`, "i").test(toolName));
  if (!toolOk) {
    return {
      allow: false,
      reason: "tool_not_in_authorized_fallback",
      message: `authorized_fallback does not include ${toolName}. ${missMsg}`,
    };
  }

  // Glob / SemanticSearch: never self-serve path discovery even with fallback unless listed
  if (/^Glob$/i.test(toolName) && !fallback.tools.some((t) => /^Glob$/i.test(t))) {
    return {
      allow: false,
      reason: "glob_forbidden",
      message: missMsg,
    };
  }

  if (/^SemanticSearch$/i.test(toolName)) {
    // Semantic search is finding — only when explicitly authorized
    if (!fallback.tools.some((t) => /^SemanticSearch$/i.test(t))) {
      return {
        allow: false,
        reason: "semantic_search_forbidden",
        message: missMsg,
      };
    }
  }

  if (gapSearchesUsed >= fallback.max_searches) {
    return {
      allow: false,
      reason: "authorized_fallback_budget",
      message: `authorized_fallback max_searches=${fallback.max_searches} exhausted. Emit another retrieval_miss or answer from the packet.`,
    };
  }

  // Grep must be scoped to authorized / known paths
  if (/^Grep$/i.test(toolName)) {
    const scope = toolPathScope(toolInput);
    const known = knownPathsFromPhaseContext(phaseContext);
    const allowedPaths = [
      ...new Set([...(fallback.paths ?? []), ...known]),
    ];
    if (!scope || !pathInKnownSet(scope, allowedPaths)) {
      return {
        allow: false,
        reason: "grep_not_scoped_to_known_paths",
        message: `Grep must target a known/authorized path from the graph packet. Got scope=${scope ?? "(none)"}. ${missMsg}`,
      };
    }
  }

  return { allow: true };
}

/**
 * Progressive-read budgets for filesystem Read (and legacy search counters).
 * @returns {{ allow: boolean, reason?: string, message?: string }}
 */
export function evaluateReadBudget({
  toolName,
  toolInput = {},
  budgets = DEFAULT_BUDGETS,
  counters = { files_read: 0, full_file_opens: 0, gap_searches: 0 },
} = {}) {
  if (FINDING_TOOLS.test(toolName)) {
    if (counters.gap_searches >= (budgets.max_gap_search_globs ?? 8)) {
      return {
        allow: false,
        reason: "gap_search_budget",
        message: `max_gap_search_globs=${budgets.max_gap_search_globs} already used.`,
      };
    }
    return { allow: true };
  }

  if (!READ_TOOL.test(toolName)) {
    return { allow: true };
  }

  if (counters.files_read >= (budgets.max_agent_files_read ?? 6)) {
    return {
      allow: false,
      reason: "files_read_budget",
      message: `max_agent_files_read=${budgets.max_agent_files_read}. Prefer inlined envelope_text / read_pack.`,
    };
  }

  if (
    isFullFileRead(toolName, toolInput) &&
    counters.full_file_opens >= (budgets.max_full_file_opens ?? 2)
  ) {
    return {
      allow: false,
      reason: "full_file_budget",
      message: `max_full_file_opens=${budgets.max_full_file_opens}. Read with offset/limit.`,
    };
  }

  return { allow: true };
}

/**
 * Read must target a path already in the graph packet / healed set.
 * @returns {{ allow: boolean, reason?: string, message?: string, miss?: object }}
 */
export function evaluateReadScope({
  toolName,
  toolInput = {},
  phaseContext = null,
} = {}) {
  if (!READ_TOOL.test(toolName)) {
    return { allow: true };
  }
  const scope = toolPathScope(toolInput);
  if (scope && isOperationalReadPath(scope)) {
    return { allow: true };
  }
  const known = knownPathsFromPhaseContext(phaseContext);
  if (scope && pathInKnownSet(scope, known)) {
    return { allow: true };
  }
  const sought = scope ?? "(none)";
  return {
    allow: false,
    reason: "read_not_in_packet",
    message: `Read is filesystem-native for packet paths only. ${sought} is not in focus_paths / read_pack / healed_paths. retrieval_miss recorded — if this path exists it is added to the packet; retry Read of that path.`,
    miss: { sought, reason: "not_in_focus" },
  };
}

/**
 * Combined gate decision for Read | Grep | Glob | SemanticSearch.
 * @returns {{ allow: boolean, reason?: string, message?: string, user_message?: string, miss?: object }}
 */
export function evaluateToolAccess({
  toolName,
  toolInput = {},
  phaseContext = null,
  budgets = DEFAULT_BUDGETS,
  counters = { files_read: 0, full_file_opens: 0, gap_searches: 0 },
} = {}) {
  if (!READ_TOOL.test(toolName) && !FINDING_TOOLS.test(toolName)) {
    return { allow: true };
  }

  if (READ_TOOL.test(toolName)) {
    const scope = evaluateReadScope({ toolName, toolInput, phaseContext });
    if (!scope.allow) {
      return {
        ...scope,
        user_message: "Graph-native finding: Read denied",
      };
    }
  }

  if (FINDING_TOOLS.test(toolName)) {
    const finding = evaluateFindingTool({
      toolName,
      toolInput,
      phaseContext,
      gapSearchesUsed: counters.gap_searches ?? 0,
    });
    if (!finding.allow) {
      return {
        ...finding,
        user_message: "Graph-native finding: tool denied",
        miss: finding.miss ?? {
          sought: toolPathScope(toolInput) || toolName,
          reason: "not_in_focus",
        },
      };
    }
  }

  const budget = evaluateReadBudget({
    toolName,
    toolInput,
    budgets,
    counters,
  });
  if (!budget.allow) {
    return {
      ...budget,
      user_message: "Read budget exceeded",
    };
  }

  return { allow: true };
}
