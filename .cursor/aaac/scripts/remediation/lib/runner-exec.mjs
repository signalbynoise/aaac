/**
 * Subprocess helpers for remediation runner.
 */
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
import { REPO_ROOT, isoNow, writeJson } from "../../run-engine/lib.mjs";
import { runArtifactsDir } from "./runner-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, "..");
const ADVANCE = path.join(REPO_ROOT, ".cursor/aaac/scripts/run-engine/advance-phase.mjs");

export function runNode(scriptName, args = [], { cwd = REPO_ROOT } = {}) {
  const scriptPath = path.join(SCRIPTS, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    cwd,
  });
  let json = null;
  const lines = (result.stdout ?? "").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      json = JSON.parse(lines[i]);
      break;
    } catch {
      /* continue */
    }
  }
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json,
  };
}

export function advancePhase(runId, completedPhase, { force = false } = {}) {
  const args = [ADVANCE, runId, completedPhase];
  if (force) args.push("--force");
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function copyFileIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

export function writeRunArtifact(runId, rel, content) {
  const dest = path.join(runArtifactsDir(runId), rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (typeof content === "string") {
    fs.writeFileSync(dest, content);
  } else {
    writeJson(dest, content);
  }
  return dest;
}

export function parseDispatchQueueYaml(text) {
  const waves = [];
  const lines = text.split("\n");
  let inWaves = false;
  let current = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "waves:") {
      inWaves = true;
      continue;
    }
    if (!inWaves) continue;
    if (line.startsWith("- priority:")) {
      if (current) waves.push(current);
      current = { priority: Number(line.split(":")[1].trim()) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("command:")) {
      current.command = line.slice("command:".length).trim();
    } else if (line.startsWith("intent:")) {
      current.intent = line.slice("intent:".length).trim();
    } else if (line.startsWith("risk:")) {
      current.risk = line.slice("risk:".length).trim();
    } else if (line.startsWith("est_clone_groups_delta:")) {
      current.est_clone_groups_delta = Number(line.split(":")[1].trim());
    } else if (line.startsWith("intent: >-")) {
      current.intent = "";
      current._intentBlock = true;
    } else if (current._intentBlock && line && !line.includes(":")) {
      current.intent = `${current.intent} ${line.trim()}`.trim();
    } else if (line.includes(":") && !line.startsWith(" ")) {
      current._intentBlock = false;
    }
  }
  if (current) waves.push(current);
  return waves.map((w, index) => ({
    index,
    priority: w.priority ?? index + 1,
    command: w.command ?? "fix-module",
    intent: (w.intent ?? "").trim(),
    risk: w.risk ?? "low",
    est_clone_groups_delta: w.est_clone_groups_delta ?? null,
    status: "pending",
  }));
}

export function buildPlanWavesYaml({ campaign, waves, source = "dispatch-queue.yaml" }) {
  const header = [
    `# Iteration ${campaign.iteration} plan waves`,
    "",
    `campaign_id: ${campaign.campaign_id}`,
    `iteration: ${campaign.iteration}`,
    `scope: ${campaign.scope ?? "whole-repo"}`,
    `max_waves: ${campaign.config?.max_waves_per_iteration ?? 3}`,
    `source: ${source}`,
    "",
    "waves:",
  ];
  const body = waves.flatMap((w) => [
    `  - index: ${w.index}`,
    `    priority: ${w.priority}`,
    `    command: ${w.command}`,
    `    status: pending`,
    `    risk: ${w.risk}`,
    w.est_clone_groups_delta != null
      ? `    est_clone_groups_delta: ${w.est_clone_groups_delta}`
      : null,
    `    intent: >-`,
    `      ${w.intent}`,
    "",
  ].filter(Boolean));
  return `${header.join("\n")}\n${body.join("\n")}`;
}

export function journal(campaignId, line) {
  const journalPath = path.join(
    REPO_ROOT,
    ".cursor/aaac/state/campaigns",
    campaignId,
    "journal.md",
  );
  fs.appendFileSync(journalPath, `\n${line}\n`);
}

export { isoNow };
