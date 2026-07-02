#!/usr/bin/env node
/**
 * Shared verify execution + metric extraction for remediation campaigns.
 * Layer commands come from project.config.json → remediation.verify.layers.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { REPO_ROOT, isoNow } from "../../run-engine/lib.mjs";
import { loadRemediationConfig, resolveLayerKeys } from "./remediation-config.mjs";

export function countTypeScriptErrors(text) {
  const matches = text.match(/error TS\d+:/g);
  return matches ? matches.length : 0;
}

export function countVitestFailures(text) {
  const summary = text.match(/Tests\s+\d+\s+failed\s+\((\d+)\)/);
  if (summary) return Number(summary[1]);
  const failedBlocks = text.match(/^\s*FAIL\s+/gm);
  return failedBlocks ? failedBlocks.length : text.includes("FAIL") ? 1 : 0;
}

export function countGoTestFailures(text) {
  const failLines = text.match(/^--- FAIL:/gm);
  if (failLines) return failLines.length;
  return text.includes("FAIL") && text.includes("go test") ? 1 : 0;
}

export function layerErrorCount(layer, step) {
  if (!step || step.status === "skipped") return 0;
  if (step.status === "pass") return 0;
  const combined = `${step.stdout_full ?? step.stdout_tail ?? ""}\n${step.stderr_full ?? step.stderr_tail ?? ""}\n${step.detail ?? ""}`;
  if (layer === "typecheck") return countTypeScriptErrors(combined);
  if (layer === "vitest") return countVitestFailures(combined);
  if (layer === "go_test") return countGoTestFailures(combined);
  return 1;
}

export function runStep(name, cmd, cmdArgs, cwd, optional = false) {
  const started = isoNow();
  const result = spawnSync(cmd, cmdArgs, {
    cwd: path.resolve(REPO_ROOT, cwd),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  const status =
    result.status === 0 ? "pass" : optional && result.status !== 0 ? "skipped" : "fail";
  return {
    name,
    status,
    exit_code: result.status,
    started_at: started,
    completed_at: isoNow(),
    stdout_full: result.stdout || "",
    stderr_full: result.stderr || "",
    stdout_tail: (result.stdout || "").slice(-4000),
    stderr_tail: (result.stderr || "").slice(-4000),
  };
}

export async function waitForDevServer(url, maxWaitSec = 30) {
  for (let i = 0; i < maxWaitSec; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function runConfiguredLayer(layerDef) {
  const name = layerDef.name ?? layerDef.id;
  return runStep(
    name,
    layerDef.command,
    layerDef.args ?? [],
    layerDef.cwd ?? ".",
    Boolean(layerDef.optional),
  );
}

async function runPlaywrightLayer(config, mode) {
  const pw = config.verify.playwright;
  if (!pw?.enabled) {
    return {
      name: "playwright_remediation",
      status: "skipped",
      reason: "playwright disabled in project.config.json",
    };
  }
  if (!config.verify.strict_modes.includes(mode)) {
    return {
      name: "playwright_remediation",
      status: "skipped",
      reason: `playwright not run for mode ${mode}`,
    };
  }

  const pwCwd = path.resolve(REPO_ROOT, pw.cwd ?? ".");
  const configPath = pw.config ? path.resolve(REPO_ROOT, pw.config) : null;
  if (configPath && !fs.existsSync(configPath)) {
    return {
      name: "playwright_remediation",
      status: "fail",
      detail: `playwright config missing: ${pw.config}`,
    };
  }

  const devUrl = config.verify.dev_server?.url;
  const serverUp = devUrl ? await waitForDevServer(devUrl) : true;
  if (!serverUp) {
    return {
      name: "playwright_remediation",
      status: "fail",
      detail: `dev server not reachable at ${devUrl} — ${config.verify.dev_server?.launch_hint ?? "start dev server"}`,
    };
  }

  const playwrightCli = path.join(pwCwd, "node_modules", "@playwright", "test", "cli.js");
  const args = configPath
    ? [playwrightCli, "test", "-c", configPath]
    : [playwrightCli, "test"];
  const step = runStep("playwright_remediation", process.execPath, args, pw.cwd ?? ".");
  step.base_url = devUrl ?? null;
  return step;
}

export async function runVerifySteps(mode) {
  const config = loadRemediationConfig();
  const layerKeys = resolveLayerKeys(config);
  const report = {
    status: "pass",
    mode,
    checked_at: isoNow(),
    metrics: {},
  };

  for (const layerDef of config.verify.layers) {
    report[layerDef.id] = runConfiguredLayer(layerDef);
  }

  if (config.verify.playwright?.enabled) {
    report.playwright = await runPlaywrightLayer(config, mode);
  }

  for (const key of layerKeys) {
    const step = report[key];
    if (step && step.status === "fail") report.status = "fail";
    report.metrics[key] = {
      status: step?.status ?? "skipped",
      error_count: layerErrorCount(key, step),
    };
  }

  report.metrics.total_errors = layerKeys.reduce(
    (sum, k) => sum + (report.metrics[k]?.error_count ?? 0),
    0,
  );

  return report;
}

export function writeVerifyLogs(report, logDir, prefix) {
  fs.mkdirSync(logDir, { recursive: true });
  const keys = Object.keys(report).filter(
    (k) => k !== "status" && k !== "mode" && k !== "checked_at" && k !== "metrics",
  );
  for (const key of keys) {
    const step = report[key];
    if (!step || typeof step !== "object") continue;
    const logPath = path.join(logDir, `${prefix}-${key}.log`);
    const body = [
      `# ${key} exit=${step.exit_code} status=${step.status}`,
      "## stdout",
      step.stdout_full ?? step.stdout_tail ?? "",
      "## stderr",
      step.stderr_full ?? step.stderr_tail ?? "",
    ].join("\n");
    fs.writeFileSync(logPath, body);
    step.log_path = logPath;
  }
}

export function summarizeMetrics(report) {
  const keys = Object.keys(report.metrics ?? {}).filter((k) => k !== "total_errors");
  return {
    status: report.status,
    total_errors: report.metrics?.total_errors ?? 0,
    layers: Object.fromEntries(
      keys.map((k) => [
        k,
        {
          status: report.metrics?.[k]?.status ?? report[k]?.status,
          error_count: report.metrics?.[k]?.error_count ?? 0,
        },
      ]),
    ),
  };
}
