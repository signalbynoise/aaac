/**
 * Autonomous mode resolution for /remediate-app.
 * When true, orchestrator MUST use remediation-runner + babysit (not manual chat phases).
 */

export const AUTONOMOUS_DEFAULTS = {
  max_iterations_auto: 10,
  satisfaction_threshold_auto: 100,
};

/**
 * @param {string} intent
 * @param {object} config - parsed intent config (threshold, max_iterations, …)
 * @returns {{ autonomous: boolean, reason: string }}
 */
export function resolveAutonomousMode(intent, config) {
  const text = (intent ?? "").toLowerCase();

  if (/\bautonomous\b/.test(text) || /\bauto[-_]?babysit\b/.test(text)) {
    return { autonomous: true, reason: "intent_token_autonomous" };
  }
  if (/\bmanual\b/.test(text) || /\bno[-_]?autonomous\b/.test(text)) {
    return { autonomous: false, reason: "intent_token_manual" };
  }
  if (config.satisfaction_threshold >= AUTONOMOUS_DEFAULTS.satisfaction_threshold_auto) {
    return {
      autonomous: true,
      reason: `satisfaction_threshold_${config.satisfaction_threshold}`,
    };
  }
  if (config.max_iterations >= AUTONOMOUS_DEFAULTS.max_iterations_auto) {
    return {
      autonomous: true,
      reason: `max_iterations_${config.max_iterations}`,
    };
  }
  return { autonomous: false, reason: "default_manual_orchestrator" };
}

export function applyAutonomousToConfig(config, intent) {
  const { autonomous, reason } = resolveAutonomousMode(intent, config);
  return {
    ...config,
    autonomous,
    autonomous_reason: reason,
    runner_mode: autonomous ? "shell_runner_yield_watcher" : "chat_orchestrator",
  };
}

export const BABYSIT_SKILL = ".cursor/skills/shared/remediation/babysit/SKILL.md";

export function autonomousBootstrapCommands(runId, campaignId) {
  return {
    health: `node .cursor/aaac/scripts/remediation/runner-health-check.mjs --campaign-id ${campaignId}`,
    cli_watch: `node .cursor/aaac/scripts/remediation/remediation-cli.mjs watch --run-id ${runId} --campaign-id ${campaignId}`,
    cli_cursor: `node .cursor/aaac/scripts/remediation/remediation-cli.mjs cursor --run-id ${runId} --campaign-id ${campaignId}`,
    cli_status: `node .cursor/aaac/scripts/remediation/remediation-cli.mjs status --run-id ${runId} --campaign-id ${campaignId}`,
    yield_watcher: `node .cursor/aaac/scripts/remediation/remediation-yield-watcher.mjs --run-id ${runId} --campaign-id ${campaignId}`,
    runner_until_yield: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${runId} --campaign-id ${campaignId} --until-yield`,
    runner_status: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${runId} --campaign-id ${campaignId} --status`,
    skill: BABYSIT_SKILL,
  };
}
