const CURSOR_CLI_NOISE_PATTERN_SOURCES = [
  "cursor-retrieval",
  "tracing to",
  "vs bridge",
  "run-engine loader",
  "load graph",
  "ENOENT",
  "\\.log['\"]",
  "^\\/(?:var|Users|tmp|private)\\/",
  "^\\|\\|[-|]+\\|\\|",
  "artifact path:",
  "^\\[debug\\]",
  "getaddrinfo",
  "api2\\.cursor\\.sh",
  "ENOTFOUND",
  "EAI_AGAIN",
];

const CURSOR_CLI_NOISE_PATTERNS = CURSOR_CLI_NOISE_PATTERN_SOURCES.map(
  (source) => new RegExp(source, "i"),
);

const TRANSIENT_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ESERVFAIL",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

const TRANSIENT_NETWORK_MESSAGE =
  /(?:getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN|ESERVFAIL|ETIMEDOUT)|(?:ENOTFOUND|EAI_AGAIN)\s+(?:api2\.cursor\.(?:sh|com)|[^\s]+\.cursor\.(?:sh|com))|(?:fetch failed|ConnectTimeoutError|socket hang up|network (?:error|unreachable)))/i;

export function isCursorCliNoiseLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed.length < 8) return true;
  return CURSOR_CLI_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function filterCursorCliStderr(stderr) {
  return String(stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCursorCliNoiseLine(line))
    .join("\n")
    .trim();
}

export function substantiveCursorCliOutput(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCursorCliNoiseLine(line))
    .join("\n")
    .trim();
}

export function hasSubstantiveCursorCliOutput(text, minChars = 80) {
  return substantiveCursorCliOutput(text).length >= minChars;
}

export function isTransientNetworkError(err) {
  const code = err?.code ?? err?.cause?.code;
  if (code && TRANSIENT_NETWORK_CODES.has(String(code))) return true;

  const text = [err?.message, err?.stderr, err?.stdout, String(err ?? "")]
    .filter(Boolean)
    .join(" ");

  return TRANSIENT_NETWORK_MESSAGE.test(text);
}

/** Parallel Cursor CLI processes race macOS keychain even when --api-key is set. */
export function isKeychainAuthError(err) {
  const text = [err?.message, err?.stderr, err?.stdout, String(err ?? "")]
    .filter(Boolean)
    .join(" ");
  return /couldn't find your saved login in the macOS keychain|unlock-keychain|keychain is locked/i.test(
    text,
  );
}

export function isRetryableCursorCliError(err) {
  const text = [err?.message, err?.stderr, err?.stdout, String(err ?? "")]
    .filter(Boolean)
    .join(" ");
  return (
    isTransientNetworkError(err) ||
    isKeychainAuthError(err) ||
    /resource_exhausted|RetriableError|rate.?limit|429|quota/i.test(text)
  );
}

export async function withTransientNetworkRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseBackoffMs = opts.baseBackoffMs ?? 1000;
  const maxBackoffMs = opts.maxBackoffMs ?? 8000;
  const shouldRetry = opts.shouldRetry ?? isTransientNetworkError;

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt >= maxAttempts - 1;
      if (isLast || !shouldRetry(err)) throw err;
      const delay = Math.min(baseBackoffMs * 2 ** attempt, maxBackoffMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("transient network retry exhausted");
}

export async function withCursorCliRetry(fn, opts = {}) {
  return withTransientNetworkRetry(fn, {
    maxAttempts: 6,
    baseBackoffMs: 5_000,
    maxBackoffMs: 60_000,
    shouldRetry: isRetryableCursorCliError,
    ...opts,
  });
}
