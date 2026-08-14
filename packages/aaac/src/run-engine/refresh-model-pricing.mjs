#!/usr/bin/env node
/**
 * Refresh model-pricing.yaml from Cursor Models & Pricing docs.
 *
 * Usage:
 *   node packages/aaac/src/run-engine/refresh-model-pricing.mjs
 *   node .cursor/aaac/scripts/run-engine/refresh-model-pricing.mjs
 *
 * Writes dogfood + packaged template SSOT paths when present.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resetModelPricingCache } from "./load-model-pricing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = "https://cursor.com/docs/models-and-pricing.md";

const STATIC_ALIASES = {
  auto: "auto",
  "composer-1": "composer-1",
  "composer-2": "composer-2.5",
  "composer-2.5": "composer-2.5",
  "composer-2.5-fast": "composer-2.5",
  "grok-4.5": "grok-4.5",
  "cursor-grok-4.5": "grok-4.5",
  "cursor-grok-4.5-high": "grok-4.5",
  "cursor-grok-4.5-high-fast": "grok-4.5",
  "grok-4.6": "grok-4.6",
  "grok-4.6-fast": "grok-4.6-fast",
  "grok-4.6-high": "grok-4.6",
  "grok-4.6-high-fast": "grok-4.6-fast",
  "grok-4.6-xhigh": "grok-4.6",
  "grok-4.6-xhigh-fast": "grok-4.6-fast",
  "cursor-grok-4.6": "grok-4.6",
  "cursor-grok-4.6-fast": "grok-4.6-fast",
  "cursor-grok-4.6-high": "grok-4.6",
  "cursor-grok-4.6-high-fast": "grok-4.6-fast",
  "cursor-grok-4.6-xhigh": "grok-4.6",
  "cursor-grok-4.6-xhigh-fast": "grok-4.6-fast",
  "gpt-5.3-codex": "gpt-5.3-codex",
  "gpt-5.3-codex-fast": "gpt-5.3-codex",
  "gpt-5.3-codex-high": "gpt-5.3-codex",
  "gpt-5.3-codex-high-fast": "gpt-5.3-codex",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-sonnet-5-thinking": "claude-sonnet-5",
  "claude-sonnet-5-thinking-high": "claude-sonnet-5",
  "claude-4.5-haiku": "claude-4.5-haiku",
  "claude-4.5-sonnet": "claude-4.5-sonnet",
  "claude-4.6-opus": "claude-4.6-opus",
  "claude-4.6-sonnet": "claude-4.6-sonnet",
  "gpt-5.6-luna": "gpt-5.6-luna",
  "gpt-5.6-sol": "gpt-5.6-sol",
  "gpt-5.6-sol-medium": "gpt-5.6-sol",
  "gpt-5.6-terra": "gpt-5.6-terra",
  "gpt-5.6-terra-medium": "gpt-5.6-terra",
  inherit: "auto",
};

const SLUG_OVERRIDES = {
  "composer-2-5": "composer-2.5",
  "grok-4-5": "grok-4.5",
  "grok-4-6": "grok-4.6",
  "claude-4-5-haiku": "claude-4.5-haiku",
  "claude-4-5-opus": "claude-4.5-opus",
  "claude-4-5-sonnet": "claude-4.5-sonnet",
  "claude-4-6-opus": "claude-4.6-opus",
  "claude-4-6-sonnet": "claude-4.6-sonnet",
  "claude-4-7-opus": "claude-4.7-opus",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-fable-5": "claude-fable-5",
  "gpt-5-3-codex": "gpt-5.3-codex",
  "gpt-5-2-codex": "gpt-5.2-codex",
  "gpt-5-2": "gpt-5.2",
  "gpt-5-1-codex-max": "gpt-5.1-codex-max",
  "gpt-5-1-codex-mini": "gpt-5.1-codex-mini",
  "gpt-5-1-codex": "gpt-5.1-codex",
  "gpt-5-4-nano": "gpt-5.4-nano",
  "gpt-5-4-mini": "gpt-5.4-mini",
  "gpt-5-4": "gpt-5.4",
  "gpt-5-5": "gpt-5.5",
  "gpt-5-6-luna": "gpt-5.6-luna",
  "gpt-5-6-sol": "gpt-5.6-sol",
  "gpt-5-6-terra": "gpt-5.6-terra",
  "gemini-2-5-flash": "gemini-2.5-flash",
  "gemini-3-1-pro": "gemini-3.1-pro",
  "gemini-3-5-flash": "gemini-3.5-flash",
  "glm-5-2": "glm-5.2",
  "kimi-k2-7-code": "kimi-k2.7-code",
  "claude-opus-4-7-fast": "claude-opus-4.7-fast",
  "claude-opus-4-8": "claude-opus-4.8",
};

function money(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "-" || text === "—") return null;
  const n = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function slugify(name) {
  let s = String(name)
    .toLowerCase()
    .replace(/\(fast mode\)/g, "fast")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SLUG_OVERRIDES[s] ?? s;
}

function parseModels(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    if (line.includes("Model") && line.includes("Provider")) continue;
    if (/^\|\s*:?-+\s*\|/.test(line)) continue;
    const parts = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((p) => p.trim());
    if (parts.length < 6) continue;
    const name = parts[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    if (!name || name.toLowerCase() === "model") continue;
    const provider = parts[1];
    const input = money(parts[2]);
    const cacheWrite = money(parts[3]);
    const cacheRead = money(parts[4]);
    const output = money(parts[5]);
    if (input == null && output == null) continue;
    rows.push({ name, provider, input, cacheWrite, cacheRead, output });
  }
  return rows;
}

function yamlQuote(value) {
  if (value == null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value));
}

function emitModel(lines, key, row, pool) {
  lines.push(`  ${key}:`);
  lines.push(`    display_name: ${yamlQuote(row.name)}`);
  lines.push(`    provider: ${row.provider}`);
  lines.push(`    pool: ${pool}`);
  lines.push(`    input_per_million: ${row.input ?? 0}`);
  lines.push(`    output_per_million: ${row.output ?? 0}`);
  if (row.cacheRead != null) lines.push(`    cache_read_per_million: ${row.cacheRead}`);
  if (row.cacheWrite != null) lines.push(`    cache_write_per_million: ${row.cacheWrite}`);
}

function buildYaml(markdown, fetchedAt) {
  const rows = parseModels(markdown);
  if (!rows.length) {
    throw new Error("No model pricing rows parsed from Cursor docs");
  }

  const lines = [
    "# AAAC model pricing SSOT — Cursor API pool rates (USD per 1M tokens).",
    "# Refresh: node .cursor/aaac/scripts/run-engine/refresh-model-pricing.mjs",
    "# Source of truth for rates: Cursor Models & Pricing docs (not invented).",
    "# Do not hardcode prices in UI or estimators — load this file.",
    "version: 1",
    "currency: USD",
    "unit: per_million_tokens",
    "pricing_basis: api_pool",
    "source:",
    `  url: ${SOURCE_URL}`,
    `  fetched_at: ${yamlQuote(fetchedAt)}`,
    "  note: Official Cursor Models & Pricing (API pool). First-party Auto rates from Auto pricing table.",
    "",
    "# When only total tokens are known (no input/output split), apply this documented blend.",
    "# cost_method becomes blended_total; never silent.",
    "blend:",
    "  input_share: 0.75",
    "  output_share: 0.25",
    "",
    "# When phase/agent token meters are missing: null = fail-closed (no cost invent).",
    "# duration_share_of_conversation_tokens is retired — conversation_* is chrome only.",
    "allocation:",
    "  when_phase_tokens_missing: null",
    "",
    "# Teams/Enterprise surcharge on non-Auto third-party (off by default for individual).",
    "cursor_token_rate:",
    "  per_million: 0.25",
    "  default_enabled: false",
    "  exempt_pools: [first_party, auto]",
    "",
    "aliases:",
  ];

  for (const key of Object.keys(STATIC_ALIASES).sort()) {
    lines.push(`  ${key}: ${STATIC_ALIASES[key]}`);
  }

  lines.push("");
  lines.push("models:");

  // Auto pricing table (first-party pool).
  emitModel(
    lines,
    "auto",
    {
      name: "Auto",
      provider: "Cursor",
      input: 1.25,
      output: 6.0,
      cacheRead: 0.25,
      cacheWrite: 1.25,
    },
    "first_party",
  );

  const firstParty = new Set(["composer-2.5", "grok-4.5", "grok-4.6"]);
  const seen = new Set(["auto"]);
  for (const row of rows) {
    let key = slugify(row.name);
    if (seen.has(key)) key = `${key}-${row.provider.toLowerCase()}`;
    seen.add(key);
    const pool = firstParty.has(key) ? "first_party" : "api";
    emitModel(lines, key, row, pool);
    if (!(key in STATIC_ALIASES)) {
      // Keep aliases section complete for newly seen canonical keys.
    }
  }

  return `${lines.join("\n")}\n`;
}

function resolveWriteTargets() {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const dogfood = path.join(repoRoot, ".cursor", "aaac", "model-pricing.yaml");
  const packaged = path.join(
    repoRoot,
    "packages",
    "aaac",
    "templates",
    "cursor",
    "aaac",
    "model-pricing.yaml",
  );
  const targets = [];
  if (fs.existsSync(path.dirname(dogfood))) targets.push(dogfood);
  if (fs.existsSync(path.dirname(packaged))) targets.push(packaged);
  if (!targets.length) targets.push(dogfood);
  return targets;
}

export async function refreshModelPricing(opts = {}) {
  const url = opts.url ?? SOURCE_URL;
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pricing docs: HTTP ${response.status}`);
  }
  const markdown = await response.text();
  const yaml = buildYaml(markdown, fetchedAt);
  const targets = opts.targets ?? resolveWriteTargets();
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, yaml);
  }
  resetModelPricingCache();
  return { ok: true, fetched_at: fetchedAt, targets, bytes: yaml.length };
}

async function main() {
  const result = await refreshModelPricing();
  process.stdout.write(
    `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[error] [model-pricing:refresh] ${error.message}\n`);
    process.exit(1);
  });
}
