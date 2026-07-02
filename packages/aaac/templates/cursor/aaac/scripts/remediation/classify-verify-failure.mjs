#!/usr/bin/env node
/**
 * Classify verify-remediation report failures → fix-module / fix-bug handoffs.
 *
 * Usage:
 *   node classify-verify-failure.mjs --report <path> --campaign-id <id> [--iteration n] [--wave-index n] [--attempt n]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REPO_ROOT, readJson } from "../run-engine/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, "dispatch-rules.json");

function parseArgs(argv) {
  const out = {
    reportPath: null,
    campaignId: "",
    iteration: 0,
    waveIndex: null,
    attempt: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") out.reportPath = argv[++i];
    else if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--wave-index") out.waveIndex = Number(argv[++i]);
    else if (a === "--attempt") out.attempt = Number(argv[++i]);
  }
  return out;
}

function loadRules() {
  return readJson(RULES_PATH, { layers: {}, evidence_priority: [] });
}

function readLogFile(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return "";
  try {
    return fs.readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

function evidenceText(step) {
  if (!step) return "";
  const fromLog = readLogFile(step.log_path);
  if (fromLog) return fromLog;
  return [
    step.stdout_full,
    step.stderr_full,
    step.stderr_tail,
    step.stdout_tail,
    step.detail,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractFilePaths(text) {
  const paths = new Set();
  const patterns = [
    /(?:frontend|backend)\/[^\s:'"]+\.(?:tsx?|jsx?|go)/g,
    /src\/[^\s:'"]+\.(?:tsx?|jsx?)/g,
    /internal\/[^\s:'"]+\.go/g,
    /[^\s('"]+\.(?:test|spec)\.(?:tsx?|jsx?)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      paths.add(m[0].replace(/^[('"]+/, ""));
    }
  }
  return [...paths];
}

function inferDomain(layer, evidence, ruleDomain) {
  const paths = extractFilePaths(evidence);
  if (paths.some((p) => p.startsWith("backend/") || p.includes("/internal/") || p.endsWith(".go"))) {
    return "backend";
  }
  if (paths.some((p) => p.startsWith("frontend/") || p.startsWith("src/"))) {
    return "frontend";
  }
  return ruleDomain ?? "frontend";
}

function pickCommand(layer, rule, evidence) {
  if (layer === "playwright" && /frontend not reachable|launch via/i.test(evidence)) {
    return { command: null, level: "infrastructure", handoff: rule.layers?.playwright_infra?.handoff ?? "/launch-se100" };
  }
  if (layer === "playwright" && /does not provide an export|Failed to fetch dynamically imported module|Cannot find module/i.test(evidence)) {
    return { command: rule.module_import_command ?? "fix-module", level: "code" };
  }
  if (layer === "vitest" && /\.(test|spec)\.(tsx?|jsx?)/.test(evidence) && !/src\/(?!.*\.test\.)/.test(evidence.split("\n")[0] ?? "")) {
    return { command: rule.test_file_command ?? rule.command, level: "test" };
  }
  return { command: rule.command, level: rule.level ?? "code" };
}

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

function classifyReport(report, ctx) {
  const rules = loadRules();
  const failedLayers = rules.evidence_priority.filter((layer) => report[layer]?.status === "fail");
  const handoffs = [];

  for (const layer of failedLayers) {
    const rule = rules.layers[layer];
    if (!rule) continue;
    const evidence = evidenceText(report[layer]);
    const picked = pickCommand(layer, rule, evidence);
    if (picked.level === "infrastructure") {
      handoffs.push({
        layer,
        level: "infrastructure",
        command: null,
        domain: null,
        intent: null,
        handoff: picked.handoff,
        evidence: evidence.slice(0, 16000),
        evidence_truncated: evidence.length > 16000,
        log_path: report[layer]?.log_path ?? null,
        file_paths: extractFilePaths(evidence),
      });
      continue;
    }
    const domain = inferDomain(layer, evidence, rule.domain);
    const intent = fillTemplate(rule.intent_template, {
      campaign_id: ctx.campaignId,
      iteration: ctx.iteration,
      wave_index: ctx.waveIndex ?? "n/a",
      attempt: ctx.attempt,
      evidence: evidence.slice(0, 16000),
    });
    handoffs.push({
      layer,
      level: picked.level,
      command: picked.command,
      domain,
      intent,
      slash_command: `/${picked.command} ${domain} "${intent.replace(/"/g, '\\"').slice(0, 500)}…"`,
      evidence: evidence.slice(0, 16000),
      evidence_truncated: evidence.length > 16000,
      log_path: report[layer]?.log_path ?? null,
      file_paths: extractFilePaths(evidence),
    });
  }

  return {
    status: handoffs.length ? "fail" : "pass",
    failed_layers: failedLayers,
    handoffs,
    primary: handoffs.find((h) => h.command) ?? handoffs[0] ?? null,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.reportPath) {
  console.error("classify-verify-failure: --report required");
  process.exit(2);
}

const report = readJson(args.reportPath, null);
if (!report) {
  console.error(`classify-verify-failure: cannot read report ${args.reportPath}`);
  process.exit(2);
}

const classification = classifyReport(report, args);
console.log(JSON.stringify({ ok: true, classification }));
process.exit(classification.status === "pass" ? 0 : 1);
