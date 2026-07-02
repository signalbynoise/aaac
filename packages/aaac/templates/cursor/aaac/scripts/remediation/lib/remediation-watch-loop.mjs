/**
 * Shared remediation watch loop — used by yield-watcher and remediation-cli.
 */
import fs from "fs";
import path from "path";
import { isoNow, writeJson } from "../../run-engine/lib.mjs";
import { campaignDir, loadCampaign, saveCampaign } from "./runner-state.mjs";
import { isGoalAchieved } from "./campaign-focus.mjs";
import { runNode } from "./runner-exec.mjs";
import {
  buildProgressSnapshot,
  formatProgressLine,
  loadSatisfaction,
  writeProgressArtifact,
} from "./remediation-progress.mjs";

const RUNNER = "remediation-runner.mjs";
const HANDLE = "handle-yield.mjs";
const HEALTH = "runner-health-check.mjs";

function extendMaxIterationsIfNeeded(campaign, satisfaction) {
  const threshold = campaign.config?.satisfaction_threshold ?? 85;
  const score = satisfaction?.score ?? campaign.current?.satisfaction_score ?? 0;
  if (score >= threshold) return false;
  const iter = campaign.iteration ?? 0;
  const max = campaign.config?.max_iterations ?? 5;
  if (iter + 1 < max) return false;
  campaign.config.max_iterations = max + 25;
  campaign.status = "running";
  saveCampaign(campaign);
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} args
 * @param {string} args.runId
 * @param {string} args.campaignId
 * @param {number} [args.pollMs]
 * @param {number} [args.maxRetries]
 * @param {object} [args.reporter]
 */
export async function runRemediationWatchLoop(args) {
  const pollMs = args.pollMs ?? 5000;
  const maxRetries = args.maxRetries ?? 5;
  const reporter = args.reporter ?? {};
  const emit = (event, detail = {}) => reporter.onEvent?.(event, detail);
  const progress = (event, extra = {}) => {
    const snap = buildProgressSnapshot(args.campaignId, args.runId, { event, ...extra });
    writeProgressArtifact(args.campaignId, snap);
    reporter.onProgress?.(snap, event);
    return snap;
  };

  const statePath = path.join(campaignDir(args.campaignId), "watcher-state.json");
  let watcherState = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : { started_at: isoNow(), cycles: 0, failures: 0 };
  watcherState.status = "running";
  writeJson(statePath, watcherState);

  emit("start", { run_id: args.runId, campaign_id: args.campaignId });
  progress("start");

  while (true) {
    const campaign = loadCampaign(args.campaignId);
    if (!campaign) {
      emit("error", { message: "campaign missing" });
      process.exit(2);
    }

    const satisfaction = loadSatisfaction(args.campaignId, campaign.iteration ?? 0);
    if (isGoalAchieved(campaign, satisfaction)) {
      progress("goal_achieved", { satisfaction_score: satisfaction?.score ?? campaign.current?.satisfaction_score });
      watcherState.status = "complete";
      watcherState.completed_at = isoNow();
      writeJson(statePath, watcherState);
      emit("goal_achieved");
      return 0;
    }

    if (extendMaxIterationsIfNeeded(campaign, satisfaction)) {
      progress("extend_max_iterations");
    }

    runNode(HEALTH, ["--campaign-id", args.campaignId]);
    progress("health_ok");

    const runner = runNode(RUNNER, [
      "--run-id", args.runId,
      "--campaign-id", args.campaignId,
      "--until-yield",
    ]);

    watcherState.cycles += 1;
    writeJson(statePath, watcherState);

    if (runner.status === 10) {
      progress("runner_progressed");
      continue;
    }

    if (runner.status === 0) {
      progress("runner_complete");
      watcherState.status = "complete";
      watcherState.completed_at = isoNow();
      writeJson(statePath, watcherState);
      emit("runner_complete");
      return 0;
    }

    if (runner.status === 3) {
      const yieldType = runner.json?.yield?.type ?? "unknown";
      progress("yield", { yield_type: yieldType });
      emit("yield", { yield_type: yieldType, runner: runner.json });

      let handled = false;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        progress("handle_start", { yield_type: yieldType, attempt });
        const handle = runNode(HANDLE, ["--run-id", args.runId, "--campaign-id", args.campaignId]);
        if (!handle.ok) {
          emit("handle_failed", { attempt, stderr: handle.stderr.slice(0, 300) });
          watcherState.failures += 1;
          writeJson(statePath, watcherState);
          progress("handle_failed", { attempt });
          await sleep(pollMs * attempt);
          continue;
        }
        const ackType = handle.json?.ack_type;
        const ack = runNode(RUNNER, [
          "--run-id", args.runId,
          "--campaign-id", args.campaignId,
          "--ack-yield", ackType,
        ]);
        if (ack.status === 0 || ack.status === 10 || ack.ok) {
          handled = true;
          progress("yield_acked", { ack_type: ackType, attempt });
          emit("yield_acked", { ack_type: ackType, attempt });
          break;
        }
        progress("ack_failed", { ack_type: ackType, attempt });
        await sleep(pollMs);
      }
      if (!handled) {
        progress("yield_stuck");
        emit("yield_stuck");
        await sleep(pollMs * 2);
      }
      continue;
    }

    if (runner.status === 1) {
      progress("blocked");
      emit("blocked", { stderr: runner.stderr.slice(0, 300) });
      await sleep(pollMs * 3);
      continue;
    }

    progress("runner_error", { exit: runner.status });
    emit("runner_error", { exit: runner.status, stderr: runner.stderr.slice(0, 300) });
    watcherState.failures += 1;
    writeJson(statePath, watcherState);
    await sleep(pollMs * 2);
  }
}
