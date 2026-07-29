/**
 * Parse Cursor CLI `--output-format stream-json` NDJSON and map tool_call
 * events to IDE tool names for AAAC file metering.
 *
 * @see https://cursor.com/docs/cli/reference/output-format
 */
import { parseCursorUsageEvent } from "./cursor-usage.mjs";

/** CLI tool_call object keys → Cursor IDE tool names used by classifyToolFileMutation. */
const CLI_TOOL_KEY_TO_IDE = {
  readToolCall: "Read",
  writeToolCall: "Write",
  editToolCall: "StrReplace",
  strReplaceToolCall: "StrReplace",
  deleteToolCall: "Delete",
  grepToolCall: "Grep",
  globToolCall: "Glob",
  lsToolCall: "Glob",
  semSearchToolCall: "SemanticSearch",
  semanticSearchToolCall: "SemanticSearch",
  shellToolCall: "Shell",
  awaitToolCall: "Shell",
  function: null, // resolved via .name below
};

/**
 * @param {object} toolCallObj - event.tool_call payload
 * @returns {{ toolName: string, path: string|null, arguments: object|null, cliKey: string|null } | null}
 */
export function mapStreamJsonToolCall(toolCallObj) {
  if (!toolCallObj || typeof toolCallObj !== "object") return null;

  for (const [cliKey, ideName] of Object.entries(CLI_TOOL_KEY_TO_IDE)) {
    if (!(cliKey in toolCallObj)) continue;
    const payload = toolCallObj[cliKey];
    if (cliKey === "function") {
      const name = payload?.name ?? payload?.function?.name;
      return mapNamedToolCall(name, payload?.arguments ?? payload?.args, cliKey);
    }
    const args = parseToolArguments(payload?.args ?? payload);
    return {
      toolName: ideName,
      path: extractPathFromArgs(args),
      cliKey,
    };
  }

  // Unknown shape — try top-level name (SDK-style)
  if (typeof toolCallObj.name === "string" && toolCallObj.name) {
    return mapNamedToolCall(
      toolCallObj.name,
      toolCallObj.args ?? toolCallObj.arguments,
      null,
    );
  }

  return null;
}

function mapNamedToolCall(name, rawArgs, cliKey) {
  if (!name) return null;
  const args = parseToolArguments(rawArgs);
  const toolName = normalizeFunctionToolName(name);
  return {
    toolName,
    path: extractPathFromArgs(args),
    ...(toolName === "UpdateCurrentStep" ? { arguments: args } : {}),
    cliKey,
  };
}

function normalizeFunctionToolName(name) {
  const raw = String(name);
  if (/(?:^|[.:/])UpdateCurrentStep$/.test(raw)) return "UpdateCurrentStep";
  if (/^read$/i.test(raw) || raw === "readToolCall") return "Read";
  if (/^write$/i.test(raw) || raw === "writeToolCall") return "Write";
  if (/^strReplace$/i.test(raw) || /^searchReplace$/i.test(raw)) return "StrReplace";
  if (/^delete$/i.test(raw)) return "Delete";
  if (/^grep$/i.test(raw)) return "Grep";
  if (/^glob$/i.test(raw) || /^ls$/i.test(raw)) return "Glob";
  if (/sem(antic)?Search/i.test(raw)) return "SemanticSearch";
  if (/^shell$/i.test(raw) || /^Bash$/i.test(raw)) return "Shell";
  // PascalCase IDE names pass through
  if (/^[A-Z][A-Za-z]+$/.test(raw)) return raw;
  return raw;
}

function extractPathFromArgs(args) {
  const obj = parseToolArguments(args);
  if (obj == null) return null;
  const path =
    obj.path ?? obj.file_path ?? obj.filePath ?? obj.target_directory ?? null;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

function parseToolArguments(args) {
  if (args == null) return null;
  let obj = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
}

/**
 * Parse one NDJSON line into a metering event, or null.
 * Counts tool_call on subtype completed (or started when completed never seen —
 * callers should dedupe by call_id).
 *
 * @param {string} line
 * @returns {{ kind: 'tool', toolName: string, path: string|null, callId: string|null, subtype: string }
 *   | { kind: 'assistant', text: string }
 *   | { kind: 'result', text: string, sessionId: string|null }
 *   | { kind: 'usage', tokens: number, context: number|null, requestId: string|null }
 *   | null}
 */
export function parseStreamJsonLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed[0] !== "{") return null;

  const event = parseJsonEvent(trimmed);
  if (!event) return null;
  const usage = parseCursorUsageEvent(event);
  if (usage) return usage;
  if (event.type === "tool_call") return parseToolCallEvent(event);
  if (event.type === "assistant") return parseAssistantEvent(event);
  return event.type === "result" ? parseResultEvent(event) : null;
}

function parseJsonEvent(trimmed) {
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseToolCallEvent(event) {
  const mapped = mapStreamJsonToolCall(event.tool_call ?? event);
  if (!mapped?.toolName) return null;
  return {
    kind: "tool",
    toolName: mapped.toolName,
    path: mapped.path,
    ...(mapped.arguments ? { arguments: mapped.arguments } : {}),
    callId: event.call_id ?? event.callId ?? null,
    subtype: event.subtype ?? event.status ?? "started",
  };
}

function parseAssistantEvent(event) {
  const text = extractAssistantText(event);
  if (!text) return null;
  // Skip duplicate flushes (partial-output mode): model_call_id present = buffered
  if (event.model_call_id && event.timestamp_ms) return null;
  return { kind: "assistant", text };
}

function parseResultEvent(event) {
  return {
    kind: "result",
    text: typeof event.result === "string" ? event.result : "",
    sessionId: event.session_id ?? null,
  };
}

function extractAssistantText(event) {
  const content = event?.message?.content;
  if (!Array.isArray(content)) {
    if (typeof event?.text === "string") return event.text.trim() || null;
    return null;
  }
  const parts = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  const joined = parts.join("").trim();
  return joined || null;
}

/**
 * Line-buffer for chunked stdout → NDJSON events.
 */
export function createStreamJsonLineBuffer() {
  let pending = "";
  return {
    /**
     * @param {string} chunk
     * @returns {string[]} complete lines
     */
    push(chunk) {
      pending += String(chunk ?? "");
      const lines = [];
      let idx;
      while ((idx = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, idx);
        pending = pending.slice(idx + 1);
        if (line.trim()) lines.push(line);
      }
      return lines;
    },
    flush() {
      const rest = pending.trim();
      pending = "";
      return rest ? [rest] : [];
    },
  };
}
