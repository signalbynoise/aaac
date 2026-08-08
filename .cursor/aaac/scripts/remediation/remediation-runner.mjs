#!/usr/bin/env node
/**
 * Shell runner for /remediate-app — drives scriptable phases, yields for agent work.
 *
 * Modes:
 *   --status              Print runner + campaign state (JSON)
 *   --tick                Run one automated step (may yield)
 *   --until-yield         Loop --tick until agent yield, complete, or blocked
 *   --ack-yield           Mark agent work done; resume automated steps
 *
 * Exit codes:
 *   0  complete (threshold met or max iterations — report allowed)
 *   1  blocked / fatal
 *   2  runtime error
 *   3  yield — agent must act (see runner-yield.json)
 *  10  progressed (internal; --until-yield continues)
 *
 * Usage:
 *   node remediation-runner.mjs --run-id <id> --campaign-id <id> [--tick|--until-yield|--ack-yield|--status]
 */
import fs from "fs";
import path from "path";
import {
  EXIT,
  PHASES,
  campaignDir,
  clearYield,
  defaultRunnerState,
  emitResult,
  fail,
  iterDir,
  loadCampaign,
  loadManifest,
  loadRunnerState,
  loadYield,
  runArtifactsDir,
  runnerStatePath,
  saveCampaign,
  saveRunnerState,
  syncRunnerFromManifest,
  writeYield,
  yieldArtifactPath,
} from "./lib/runner-state.mjs";
import {
  advancePhase,
  journal,
  parseDispatchQueueYaml,
  runNode,
  writeRunArtifact,
} from "./lib/runner-exec.mjs";
import {
  reconcileRemediationRun,
} from "./lib/reconcile-run-manifest.mjs";

const REQUIRED_SWARM_AGENTS = 7;
const CHECK_SWARM_AGENTS = [
  "remediation-check-app-inventory",
  "remediation-check-app-ssot",
  "remediation-check-app-trace",
  "remediation-check-architecture-boundaries",
  "remediation-check-architecture-deps",
  "remediation-check-architecture-decomposition",
  "remediation-check-risk",
];

function parseArgs(argv) {
  const out = {
    runId: null,
    campaignId: null,
    mode: "tick",
    scope: null,
    intent: null,
    ackType: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--scope") out.scope = argv[++i];
    else if (a === "--intent") out.intent = argv[++i];
    else if (a === "--status") out.mode = "status";
    else if (a === "--tick") out.mode = "tick";
    else if (a === "--until-yield") out.mode = "until-yield";
    else if (a === "--ack-yield") {
      out.mode = "ack-yield";
      out.ackType = argv[++i];
    }
  }
  return out;
}

function ensureRunnerState(args, campaign, manifest) {
  let state = loadRunnerState(args.campaignId);
  if (!state) {
    state = defaultRunnerState({
      runId: args.runId,
      campaignId: args.campaignId,
      iteration: campaign.iteration ?? 0,
      phase: manifest?.phase ?? "campaign_init",
    });
    saveRunnerState(state);
  }

  // Runner state owns phase while campaign is running; reconcile manifest from runner.
  if (manifest?.command === "remediate-app" && campaign.status === "running") {
    reconcileRemediationRun(args.runId, state);
  } else {
    syncRunnerFromManifest(state, manifest);
  }

  state.run_id = args.runId;
  state.iteration = campaign.iteration ?? state.iteration;
  saveRunnerState(state);
  return state;
}

function setYield(state, yieldPayload) {
  state.status = "yielded";
  state.yield = yieldPayload;
  writeYield(state.campaign_id, yieldPayload);
  saveRunnerState(state);
  emitResult(state, { action: "yield" });
  process.exit(EXIT.yield_agent);
}

function markProgress(state, campaign) {
  const satPath = path.join(iterDir(state.campaign_id, state.iteration), "satisfaction.json");
  const sat = fs.existsSync(satPath)
    ? JSON.parse(fs.readFileSync(satPath, "utf8"))
    : null;
  const score = sat?.score ?? campaign.current?.satisfaction_score ?? null;
  const clones = campaign.current?.fallow_dupes_clone_groups ?? null;
  if (score !== state.last_score || clones !== state.last_clone_groups) {
    state.last_score = score;
    state.last_clone_groups = clones;
    state.last_progress_at = new Date().toISOString();
    state.stall_count = 0;
  }
}

function advanceRunnerPhase(runId, completedPhase, runnerState) {
  reconcileRemediationRun(runId, {
    ...runnerState,
    phase: completedPhase,
  });
  const adv = advancePhase(runId, completedPhase, { force: true });
  if (!adv.ok) {
    fail(`advance ${completedPhase} failed: ${adv.stderr}`, EXIT.runtime_error);
  }
  const manifest = loadManifest(runId);
  runnerState.phase = manifest?.phase ?? completedPhase;
  return runnerState.phase;
}

function readPlanWaves(runId, campaignId) {
  const runPlan = path.join(runArtifactsDir(runId), "plan_waves.yaml");
  const campPlan = path.join(campaignDir(campaignId), "artifacts", "plan_waves.yaml");
  const text = fs.existsSync(runPlan)
    ? fs.readFileSync(runPlan, "utf8")
    : fs.existsSync(campPlan)
      ? fs.readFileSync(campPlan, "utf8")
      : null;
  if (!text) return [];
  return parseDispatchQueueYaml(text).map((w, index) => ({ ...w, index }));
}

function waveCount(runId, campaignId, campaign) {
  const waves = readPlanWaves(runId, campaignId);
  if (waves.length) return waves.length;
  return campaign.config?.max_waves_per_iteration ?? 3;
}

function checkSwarmRawReady(campaignId, iteration) {
  const rawPath = path.join(iterDir(campaignId, iteration), "check-swarm-raw.json");
  if (!fs.existsSync(rawPath)) return { ok: false, reason: "missing_check_swarm_raw" };
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const agents = raw.agents ?? [];
  if (agents.length < REQUIRED_SWARM_AGENTS) {
    return { ok: false, reason: "insufficient_agents", count: agents.length };
  }
  return { ok: true, raw };
}

function remediatorHandoffPath(campaignId, iteration, attempt) {
  return path.join(
    iterDir(campaignId, iteration),
    `remediator-handoff-attempt-${attempt}.json`,
  );
}

function handleCampaignInit(state, campaign, manifest, args) {
  const initArgs = [
    "--run-id",
    args.runId,
    "--campaign-id",
    state.campaign_id,
    "--scope",
    args.scope ?? campaign.scope ?? "whole-repo",
  ];
  if (args.intent) initArgs.push("--intent", args.intent);
  if (campaign.status === "running" && campaign.iteration > 0) {
    initArgs.push("--resume", state.campaign_id);
  }

  const init = runNode("init-campaign.mjs", initArgs);
  if (!init.ok && init.status !== 0) {
    fail(`init-campaign failed: ${init.stderr || init.stdout}`, EXIT.runtime_error);
  }

  const baseline = runNode("capture-verify-baseline.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--run-id",
    args.runId,
  ]);
  if (!baseline.ok) {
    fail(`capture-verify-baseline failed: ${baseline.stderr}`, EXIT.runtime_error);
  }

  writeRunArtifact(args.runId, "campaign.json", {
    campaign_id: state.campaign_id,
    iteration: campaign.iteration,
    config: campaign.config,
  });

  const adv = advancePhase(args.runId, "campaign_init", { force: true });
  if (!adv.ok) fail(`advance campaign_init failed: ${adv.stderr}`, EXIT.runtime_error);
  state.phase = advanceRunnerPhase(args.runId, "campaign_init", state);
  state.substep = null;
  state.status = "running";
  saveRunnerState(state);
  return EXIT.progressed;
}

function handleScan(state, campaign, args) {
  const n = state.iteration;
  const startBaseline = path.join(campaignDir(state.campaign_id), "fallow-start-baseline.json");
  const scanArgs = ["--campaign-id", state.campaign_id, "--iteration", String(n)];
  if (!fs.existsSync(startBaseline) && n === 0) scanArgs.push("--save-baseline");

  const scan = runNode("fallow-scan.mjs", scanArgs);
  if (!scan.ok) fail(`fallow-scan failed: ${scan.stderr}`, EXIT.runtime_error);

  const classify = runNode("classify-fallow-issues.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--iteration",
    String(n),
  ]);
  if (!classify.ok) fail(`classify-fallow-issues failed: ${classify.stderr}`, EXIT.runtime_error);

  const adv = advancePhase(args.runId, "scan", { force: true });
  if (!adv.ok) fail(`advance scan failed: ${adv.stderr}`, EXIT.runtime_error);
  state.phase = advanceRunnerPhase(args.runId, "scan", state);
  state.substep = "prepare";
  saveRunnerState(state);
  return EXIT.progressed;
}

function handleCheckSwarm(state, args) {
  const n = state.iteration;

  if (state.substep === "prepare" || !state.substep) {
    const prep = runNode("prepare-check-context.mjs", [
      "--campaign-id",
      state.campaign_id,
      "--iteration",
      String(n),
      "--run-id",
      args.runId,
    ]);
    if (!prep.ok) fail(`prepare-check-context failed: ${prep.stderr}`, EXIT.runtime_error);
    state.substep = "agents";
    saveRunnerState(state);
  }

  if (state.substep === "agents") {
    const rawCheck = checkSwarmRawReady(state.campaign_id, n);
    if (!rawCheck.ok) {
      setYield(state, {
        type: "check_swarm",
        phase: "check_swarm",
        iteration: n,
        reason: rawCheck.reason,
        required_agents: CHECK_SWARM_AGENTS,
        artifacts_required: [`iterations/${n}/check-swarm-raw.json`],
        skill: ".cursor/skills/shared/remediation/check-swarm/SKILL.md",
        instructions:
          "Launch 7 parallel readonly Task agents per check-swarm SKILL. Collect JSON into check-swarm-raw.json, then run --ack-yield check_swarm.",
        resume_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${state.campaign_id} --ack-yield check_swarm`,
      });
    }
    state.substep = "merge";
    saveRunnerState(state);
  }

  if (state.substep === "merge") {
    const merge = runNode("merge-check-swarm.mjs", [
      "--campaign-id",
      state.campaign_id,
      "--iteration",
      String(n),
      "--run-id",
      args.runId,
    ]);
    if (!merge.ok) fail(`merge-check-swarm failed: ${merge.stderr}`, EXIT.runtime_error);

    const adv = advancePhase(args.runId, "check_swarm", { force: true });
    if (!adv.ok) fail(`advance check_swarm failed: ${adv.stderr}`, EXIT.runtime_error);
    state.phase = advanceRunnerPhase(args.runId, "check_swarm", state);
    state.substep = null;
    saveRunnerState(state);
    return EXIT.progressed;
  }

  return EXIT.progressed;
}

function handlePlanWaves(state, campaign, args) {
  const queuePath = path.join(campaignDir(state.campaign_id), "dispatch-queue.yaml");
  if (!fs.existsSync(queuePath)) {
    setYield(state, {
      type: "dispatch_queue",
      phase: "plan_waves",
      iteration: state.iteration,
      reason: "missing_dispatch_queue",
      artifacts_required: ["dispatch-queue.yaml"],
      instructions:
        "Write dispatch-queue.yaml from check_swarm merge (waves with command, intent, risk). Then --ack-yield dispatch_queue.",
      resume_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${state.campaign_id} --ack-yield dispatch_queue`,
    });
  }

  const plan = runNode("plan-waves-from-queue.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--run-id",
    args.runId,
    "--iteration",
    String(state.iteration),
  ]);
  if (!plan.ok) fail(`plan-waves-from-queue failed: ${plan.stderr}`, EXIT.runtime_error);

  const adv = advancePhase(args.runId, "plan_waves", { force: true });
  if (!adv.ok) fail(`advance plan_waves failed: ${adv.stderr}`, EXIT.runtime_error);
  state.phase = advanceRunnerPhase(args.runId, "plan_waves", state);
  state.substep = "wave_fix";
  state.wave_index = 0;
  state.attempt = 1;
  saveRunnerState(state);
  return EXIT.progressed;
}

function handleExecute(state, campaign, args) {
  const totalWaves = waveCount(args.runId, state.campaign_id, campaign);
  const w = state.wave_index;

  if (w >= totalWaves) {
    const execJson = path.join(runArtifactsDir(args.runId), "execute_waves.json");
    const execYaml = path.join(runArtifactsDir(args.runId), "execute_waves.yaml");
    if (!fs.existsSync(execYaml)) {
      const wavesDone = fs.existsSync(execJson)
        ? JSON.parse(fs.readFileSync(execJson, "utf8"))
        : { waves: [] };
      fs.writeFileSync(
        execYaml,
        `campaign_id: ${state.campaign_id}\niteration: ${state.iteration}\nwaves: []\n`,
      );
      if (!fs.existsSync(execJson)) {
        writeRunArtifact(args.runId, "execute_waves.json", {
          campaign_id: state.campaign_id,
          iteration: state.iteration,
          waves: wavesDone.waves ?? [],
        });
      }
    }
    const adv = advancePhase(args.runId, "execute", { force: true });
    if (!adv.ok) fail(`advance execute failed: ${adv.stderr}`, EXIT.runtime_error);
    state.phase = advanceRunnerPhase(args.runId, "execute", state);
    state.substep = null;
    state.attempt = 1;
    saveRunnerState(state);
    return EXIT.progressed;
  }

  const waves = readPlanWaves(args.runId, state.campaign_id);
  const wave = waves[w] ?? {
    index: w,
    command: "fix-module",
    intent: `Remediation wave ${w} — see dispatch-queue.yaml`,
    risk: "low",
  };

  if (state.substep === "wave_fix") {
    setYield(state, {
      type: "execute_wave",
      phase: "execute",
      iteration: state.iteration,
      wave_index: w,
      wave_total: totalWaves,
      command: wave.command,
      intent: wave.intent,
      risk: wave.risk,
      instructions: `Run inline ${wave.command} (no nested AAAC Run). Respect protected_paths.yaml. Test-only waves need test_execute phase or mark degraded. Then --ack-yield execute_wave.`,
      artifacts_required: [`artifacts/execute_waves.json`],
      resume_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${state.campaign_id} --ack-yield execute_wave`,
    });
  }

  if (state.substep === "wave_verify") {
    runNode("capture-wave-snapshot.mjs", [
      "--campaign-id",
      state.campaign_id,
      "--iteration",
      String(state.iteration),
      "--wave-index",
      String(w),
    ]);

    const gate = runNode("remediator-gate.mjs", [
      "--campaign-id",
      state.campaign_id,
      "--iteration",
      String(state.iteration),
      "--mode",
      "wave",
      "--wave-index",
      String(w),
      "--run-id",
      args.runId,
      "--attempt",
      String(state.attempt),
    ]);

    if (gate.status === 0) {
      journal(
        state.campaign_id,
        `- Runner wave ${w} **promoted** iter ${state.iteration}`,
      );
      state.wave_index = w + 1;
      state.substep = "wave_fix";
      state.attempt = 1;
      saveRunnerState(state);
      return EXIT.progressed;
    }

    if (gate.status === 3 && gate.json) {
      setYield(state, {
        type: "remediator",
        phase: "execute",
        subphase: "wave",
        iteration: state.iteration,
        wave_index: w,
        attempt: state.attempt,
        gate_mode: "regression",
        handoff: gate.json.handoff,
        retry_command: gate.json.retry_command,
        instructions:
          "Exit 3 = remediate and retry. Run remediation-remediator handoff inline. Then --ack-yield remediator.",
        resume_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${state.campaign_id} --ack-yield remediator`,
      });
    }

    if (gate.status === 1) {
      state.status = "blocked";
      saveRunnerState(state);
      emitResult(state, { action: "blocked", gate: gate.json });
      process.exit(EXIT.blocked);
    }

    fail(`remediator-gate wave failed: ${gate.stderr}`, EXIT.runtime_error);
  }

  return EXIT.progressed;
}

function handleDebtSweep(state, args) {
  const gate = runNode("debt-sweep-gate.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--iteration",
    String(state.iteration),
    "--run-id",
    args.runId,
    "--round",
    "1",
    "--attempt",
    String(state.attempt),
  ]);

  if (gate.status === 0) {
    const adv = advancePhase(args.runId, "debt_sweep", { force: true });
    if (!adv.ok) fail(`advance debt_sweep failed: ${adv.stderr}`, EXIT.runtime_error);
    state.phase = advanceRunnerPhase(args.runId, "debt_sweep", state);
    state.substep = null;
    state.attempt = 1;
    saveRunnerState(state);
    return EXIT.progressed;
  }

  if (gate.status === 3 && gate.json) {
    setYield(state, {
      type: "remediator",
      phase: "debt_sweep",
      iteration: state.iteration,
      attempt: state.attempt,
      gate_mode: "strict",
      handoff: gate.json.handoff ?? gate.json.primary,
      retry_command: gate.json.retry_command,
      instructions:
        "Debt sweep exit 3 — fix strict verify failures inline, then --ack-yield remediator.",
      resume_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${state.campaign_id} --ack-yield remediator`,
    });
  }

  if (gate.status === 1) {
    state.status = "blocked";
    saveRunnerState(state);
    emitResult(state, { action: "blocked", gate: gate.json });
    process.exit(EXIT.blocked);
  }

  fail(`debt-sweep-gate failed: ${gate.stderr}`, EXIT.runtime_error);
}

function handleSatisfactionGate(state, campaign, args) {
  const compute = runNode("compute-satisfaction.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--iteration",
    String(state.iteration),
  ]);
  if (!compute.ok) fail(`compute-satisfaction failed: ${compute.stderr}`, EXIT.runtime_error);

  const loop = runNode("satisfaction-loop-gate.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--iteration",
    String(state.iteration),
    "--run-id",
    args.runId,
    "--advance",
  ]);

  if (loop.status === 0) {
    const adv = advancePhase(args.runId, "satisfaction_gate", { force: true });
    if (!adv.ok) fail(`advance satisfaction_gate failed: ${adv.stderr}`, EXIT.runtime_error);
    state.phase = advanceRunnerPhase(args.runId, "satisfaction_gate", state);
    state.status = "complete";
    state.substep = null;
    saveRunnerState(state);
    clearYield(state.campaign_id);
    emitResult(state, { action: "complete", gate: loop.json });
    process.exit(EXIT.complete);
  }

  if (loop.status === 3) {
    campaign = loadCampaign(state.campaign_id);
    state.iteration = campaign?.iteration ?? state.iteration + 1;
    state.phase = "scan";
    state.substep = null;
    state.wave_index = 0;
    state.attempt = 1;
    state.status = "running";
    saveRunnerState(state);
    journal(
      state.campaign_id,
      `- Runner **CONTINUE** → iteration ${state.iteration} (score below threshold)`,
    );
    return EXIT.progressed;
  }

  fail(`satisfaction-loop-gate failed: ${loop.stderr}`, EXIT.runtime_error);
}

function handleReport(state, args) {
  const validate = runNode("validate-campaign-complete.mjs", [
    "--campaign-id",
    state.campaign_id,
    "--iteration",
    String(state.iteration),
    "--require-debt-sweep",
    "--require-satisfaction-loop",
  ]);
  if (!validate.ok) {
    fail(`validate-campaign-complete failed: ${validate.stderr}`, EXIT.blocked);
  }

  setYield(state, {
    type: "report",
    phase: "report",
    iteration: state.iteration,
    instructions:
      "Write artifacts/report.md from campaign journal + satisfaction-history. Advance phase report and mark Run completed.",
    resume_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${state.campaign_id} --ack-yield report`,
  });
}

function ackYield(state, args, ackType) {
  const pending = loadYield(state.campaign_id);
  if (!pending && state.status !== "yielded") {
    fail("No pending yield to acknowledge", EXIT.runtime_error);
  }

  clearYield(state.campaign_id);
  state.status = "running";
  state.yield = null;
  state.tick_count += 1;

  switch (ackType) {
    case "check_swarm": {
      const check = checkSwarmRawReady(state.campaign_id, state.iteration);
      if (!check.ok) fail(`check_swarm ack failed: ${check.reason}`, EXIT.runtime_error);
      state.substep = "merge";
      break;
    }
    case "dispatch_queue":
      state.substep = null;
      break;
    case "execute_wave":
      state.substep = "wave_verify";
      break;
    case "remediator":
      state.attempt += 1;
      if (state.phase === "execute") state.substep = "wave_verify";
      break;
    case "report": {
      const adv = advancePhase(args.runId, "report", { force: true });
      if (!adv.ok) fail(`advance report failed: ${adv.stderr}`, EXIT.runtime_error);
      state.status = "complete";
      state.phase = "report";
      saveRunnerState(state);
      emitResult(state, { action: "complete" });
      process.exit(EXIT.complete);
    }
    default:
      fail(`Unknown ack type: ${ackType}`, EXIT.runtime_error);
  }

  saveRunnerState(state);
  emitResult(state, { action: "ack", ack_type: ackType });
  process.exit(EXIT.progressed);
}

function runTick(state, campaign, manifest, args) {
  markProgress(state, campaign);
  state.tick_count += 1;

  const manifestPhase = state.phase;

  switch (manifestPhase) {
    case "campaign_init":
      return handleCampaignInit(state, campaign, manifest, args);
    case "scan":
      return handleScan(state, campaign, args);
    case "check_swarm":
      return handleCheckSwarm(state, args);
    case "plan_waves":
      return handlePlanWaves(state, campaign, args);
    case "execute":
      return handleExecute(state, campaign, args);
    case "debt_sweep":
      return handleDebtSweep(state, args);
    case "satisfaction_gate":
      return handleSatisfactionGate(state, campaign, args);
    case "report":
      handleReport(state, args);
      return EXIT.yield_agent;
    default:
      fail(`Unknown phase: ${state.phase}`, EXIT.runtime_error);
  }
}

function printStatus(state, campaign) {
  const payload = {
    runner_state_path: runnerStatePath(state.campaign_id),
    yield_path: yieldArtifactPath(state.campaign_id),
    campaign_status: campaign.status,
    config: campaign.config,
    current: campaign.current,
    runner: state,
    yield: loadYield(state.campaign_id),
  };
  console.log(JSON.stringify(payload, null, 2));
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId || !args.campaignId) {
  console.error(
    "Usage: remediation-runner.mjs --run-id <id> --campaign-id <id> [--tick|--until-yield|--ack-yield <type>|--status]",
  );
  process.exit(2);
}

const campaign = loadCampaign(args.campaignId);
if (!campaign) fail(`Campaign not found: ${args.campaignId}`, EXIT.runtime_error);

const manifest = loadManifest(args.runId);
const state = ensureRunnerState(args, campaign, manifest);

if (args.mode === "status") {
  printStatus(state, campaign);
  process.exit(0);
}

if (args.mode === "ack-yield") {
  if (!args.ackType) fail("--ack-yield requires a type", EXIT.runtime_error);
  ackYield(state, args, args.ackType);
}

if (args.mode === "tick") {
  const code = runTick(state, campaign, manifest, args);
  emitResult(loadRunnerState(args.campaignId), { action: "tick" });
  process.exit(code === EXIT.yield_agent ? EXIT.yield_agent : code);
}

if (args.mode === "until-yield") {
  const maxTicks = 500;
  for (let i = 0; i < maxTicks; i++) {
    const freshCampaign = loadCampaign(args.campaignId);
    const freshManifest = loadManifest(args.runId);
    const freshState = ensureRunnerState(args, freshCampaign, freshManifest);
    if (freshState.status === "complete") {
      emitResult(freshState, { action: "complete" });
      process.exit(EXIT.complete);
    }
    if (freshState.status === "blocked") {
      emitResult(freshState, { action: "blocked" });
      process.exit(EXIT.blocked);
    }
    if (freshState.status === "yielded") {
      emitResult(freshState, { action: "yield" });
      process.exit(EXIT.yield_agent);
    }

    try {
      const code = runTick(freshState, freshCampaign, freshManifest, args);
      if (code === EXIT.yield_agent) process.exit(EXIT.yield_agent);
      if (code === EXIT.complete) process.exit(EXIT.complete);
      if (code === EXIT.blocked) process.exit(EXIT.blocked);
    } catch (err) {
      fail(String(err?.message ?? err), EXIT.runtime_error);
    }
  }
  fail(`until-yield exceeded ${maxTicks} ticks`, EXIT.blocked);
}

fail(`Unknown mode: ${args.mode}`, EXIT.runtime_error);
