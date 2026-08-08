#!/usr/bin/env node
/**
 * Handle a runner yield — scriptable steps + Cursor agent for code waves.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { REPO_ROOT, readJson, writeJson, isoNow } from "../run-engine/lib.mjs";
import {
  campaignDir,
  iterDir,
  loadYield,
  runArtifactsDir,
} from "./lib/runner-state.mjs";
import { loadCampaignContext } from "./lib/campaign-focus.mjs";
import { invokeCursorAgent } from "./lib/invoke-cursor-agent.mjs";
import { runNode, parseDispatchQueueYaml, journal } from "./lib/runner-exec.mjs";

function parseArgs(argv) {
  const out = { runId: null, campaignId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id") out.runId = argv[++i];
    else if (argv[i] === "--campaign-id") out.campaignId = argv[++i];
  }
  return out;
}

function readWave(campaignId, runId, waveIndex) {
  const queuePath = path.join(campaignDir(campaignId), "dispatch-queue.yaml");
  if (fs.existsSync(queuePath)) {
    const waves = parseDispatchQueueYaml(fs.readFileSync(queuePath, "utf8"));
    if (waves[waveIndex]) return waves[waveIndex];
  }
  const planPath = path.join(runArtifactsDir(runId), "plan_waves.yaml");
  if (fs.existsSync(planPath)) {
    const waves = parseDispatchQueueYaml(fs.readFileSync(planPath, "utf8"));
    if (waves[waveIndex]) return waves[waveIndex];
  }
  return { index: waveIndex, command: "fix-module", intent: `Health wave ${waveIndex}`, risk: "low" };
}

function recordExecuteWave(campaignId, iteration, waveIndex, wave, status = "completed") {
  const artifact = path.join(campaignDir(campaignId), "artifacts", "execute_waves.json");
  const data = readJson(artifact, { campaign_id: campaignId, iteration, waves: [] });
  data.iteration = iteration;
  data.waves = (data.waves ?? []).filter((w) => w.index !== waveIndex);
  data.waves.push({
    index: waveIndex,
    priority: wave.priority ?? waveIndex + 1,
    command: wave.command ?? "fix-module",
    status,
    risk: wave.risk ?? "low",
    intent: wave.intent ?? "",
    completed_at: isoNow(),
  });
  writeJson(artifact, data);
}

function buildWavePrompt(ctx, yieldPayload, wave) {
  const protectedList = ctx.protected_paths.map((p) => `- ${p}`).join("\n");
  return [
    "You are executing a remediation campaign wave. Follow instructions exactly.",
    "",
    `Campaign intent: ${ctx.campaign.intent}`,
    `Focus: reduce functions over ${ctx.focus.max_function_loc} LOC (health decomposition)`,
    `Iteration: ${yieldPayload.iteration}`,
    `Wave ${yieldPayload.wave_index + 1} of ${yieldPayload.wave_total ?? "?"}`,
    "",
    "Wave intent:",
    wave.intent || yieldPayload.intent,
    "",
    "Protected paths — NEVER modify, delete, or split these files:",
    protectedList,
    "",
    "Rules:",
    "- Work in frontend/ when paths start with src/",
    "- Split large functions into focused modules; each function should be <= 60 LOC where practical",
    "- Preserve exports and public API; composition roots stay thin",
    "- Match existing code conventions",
    "- Run: cd frontend && pnpm exec tsc --noEmit — fix any errors you introduce",
    "- Do not commit",
  ].join("\n");
}

function buildRemediatorPrompt(ctx, yieldPayload, handoff) {
  const logHint = handoff.log_path ? `Read full log: ${handoff.log_path}` : "";
  return [
    "Fix remediation verify/debt-sweep failures introduced by the last wave.",
    "",
    `Campaign intent: ${ctx.campaign.intent}`,
    `Mode: ${handoff.mode ?? yieldPayload.phase}`,
    `Layer: ${handoff.layer ?? "unknown"}`,
    "",
    handoff.intent ?? handoff.message ?? "",
    logHint,
    "",
    "Fix only what is required to pass verification. Run tsc and relevant tests.",
  ].join("\n");
}

function handleCheckSwarm(args, ctx, yieldPayload) {
  const n = yieldPayload.iteration;
  const synth = runNode("auto-check-swarm-synthesis.mjs", [
    "--campaign-id", args.campaignId, "--iteration", String(n),
  ]);
  if (!synth.ok) throw new Error(`auto-check-swarm-synthesis failed: ${synth.stderr}`);

  const merge = runNode("merge-check-swarm.mjs", [
    "--campaign-id", args.campaignId, "--iteration", String(n), "--run-id", args.runId,
  ]);
  if (!merge.ok) throw new Error(`merge-check-swarm failed: ${merge.stderr}`);

  const dispatch = runNode("auto-dispatch-queue-from-health.mjs", [
    "--campaign-id", args.campaignId, "--iteration", String(n),
  ]);
  if (!dispatch.ok) throw new Error(`auto-dispatch-queue failed: ${dispatch.stderr}`);

  const synthesis = `# Auto check synthesis iter ${n}\n\nFocus: ${ctx.focus.health_functions_above_60_loc ? "Health Functions >60 LOC" : "general"}\n`;
  fs.writeFileSync(path.join(campaignDir(args.campaignId), "artifacts", "check_synthesis.md"), synthesis);
  journal(args.campaignId, `- **Yield handler** check_swarm iter ${n} (auto)`);
  return "check_swarm";
}

function handleDispatchQueue(args, ctx, yieldPayload) {
  const n = yieldPayload.iteration;
  const dispatch = runNode("auto-dispatch-queue-from-health.mjs", [
    "--campaign-id", args.campaignId, "--iteration", String(n),
  ]);
  if (!dispatch.ok) throw new Error(`auto-dispatch-queue failed: ${dispatch.stderr}`);
  journal(args.campaignId, `- **Yield handler** dispatch_queue iter ${n}`);
  return "dispatch_queue";
}

function runTsc(scope) {
  const cwd = scope === "frontend" ? path.join(REPO_ROOT, "frontend") : REPO_ROOT;
  return spawnSync("pnpm", ["exec", "tsc", "--noEmit"], { cwd, encoding: "utf8" });
}

function handleExecuteWave(args, ctx, yieldPayload) {
  const waveIndex = yieldPayload.wave_index ?? 0;
  const wave = readWave(args.campaignId, args.runId, waveIndex);
  const logPath = path.join(
    iterDir(args.campaignId, yieldPayload.iteration),
    "verify-logs",
    `yield-agent-wave-${waveIndex}.log`,
  );
  const prompt = buildWavePrompt(ctx, yieldPayload, wave);
  const agent = invokeCursorAgent(prompt, { cwd: REPO_ROOT, logPath, timeoutMs: 1_200_000 });
  if (!agent.ok) {
    recordExecuteWave(args.campaignId, yieldPayload.iteration, waveIndex, wave, "degraded");
    throw new Error(`cursor agent failed (${agent.status}): ${agent.stderr.slice(0, 500)}`);
  }
  const tsc = runTsc(ctx.scope);
  if (tsc.status !== 0) {
    recordExecuteWave(args.campaignId, yieldPayload.iteration, waveIndex, wave, "degraded");
    throw new Error(`tsc failed after wave: ${(tsc.stderr || tsc.stdout).slice(0, 500)}`);
  }
  recordExecuteWave(args.campaignId, yieldPayload.iteration, waveIndex, wave, "completed");
  journal(args.campaignId, `- **Yield handler** execute_wave ${waveIndex} iter ${yieldPayload.iteration}`);
  return "execute_wave";
}

function handleRemediator(args, ctx, yieldPayload) {
  const iterDirPath = iterDir(args.campaignId, yieldPayload.iteration);
  const handoffFiles = fs.existsSync(iterDirPath)
    ? fs.readdirSync(iterDirPath).filter((f) => f.startsWith("remediator-handoff-attempt-"))
    : [];
  handoffFiles.sort();
  const latest = handoffFiles[handoffFiles.length - 1];
  const handoff = latest ? readJson(path.join(iterDirPath, latest), {}) : {};
  const logPath = path.join(iterDirPath, "verify-logs", `yield-agent-remediator-${yieldPayload.attempt ?? 1}.log`);
  const prompt = buildRemediatorPrompt(ctx, yieldPayload, handoff);
  const agent = invokeCursorAgent(prompt, { cwd: REPO_ROOT, logPath, timeoutMs: 900_000 });
  if (!agent.ok) throw new Error(`remediator agent failed: ${agent.stderr.slice(0, 500)}`);
  journal(args.campaignId, `- **Yield handler** remediator iter ${yieldPayload.iteration}`);
  return "remediator";
}

function handleReport(args, ctx) {
  const reportPath = path.join(campaignDir(args.campaignId), "artifacts", "report.md");
  const history = path.join(campaignDir(args.campaignId), "satisfaction-history.yaml");
  const body = [
    "# Remediation report",
    "",
    `Campaign: ${args.campaignId}`,
    `Intent: ${ctx.campaign.intent}`,
    `Completed: ${isoNow()}`,
    "",
    fs.existsSync(history) ? fs.readFileSync(history, "utf8") : "",
  ].join("\n");
  fs.writeFileSync(reportPath, body);
  journal(args.campaignId, "- **Yield handler** report written");
  return "report";
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId || !args.campaignId) {
  console.error("Usage: handle-yield.mjs --run-id <id> --campaign-id <id>");
  process.exit(2);
}

const yieldPayload = loadYield(args.campaignId);
if (!yieldPayload?.type) {
  console.error("No pending yield");
  process.exit(2);
}

const ctx = loadCampaignContext(args.campaignId);
if (!ctx) {
  console.error("Campaign not found");
  process.exit(2);
}

let ackType;
try {
  switch (yieldPayload.type) {
    case "check_swarm":
      ackType = handleCheckSwarm(args, ctx, yieldPayload);
      break;
    case "dispatch_queue":
      ackType = handleDispatchQueue(args, ctx, yieldPayload);
      break;
    case "execute_wave":
      ackType = handleExecuteWave(args, ctx, yieldPayload);
      break;
    case "remediator":
      ackType = handleRemediator(args, ctx, yieldPayload);
      break;
    case "report":
      ackType = handleReport(args, ctx);
      break;
    default:
      throw new Error(`Unknown yield type: ${yieldPayload.type}`);
  }
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err), yield: yieldPayload.type }));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, ack_type: ackType, yield: yieldPayload.type }));
