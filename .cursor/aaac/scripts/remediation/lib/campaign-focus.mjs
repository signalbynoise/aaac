/**
 * Parse campaign intent into remediation focus constraints.
 */
import fs from "fs";
import path from "path";
import { campaignDir, loadCampaign } from "./runner-state.mjs";

const DEFAULT_PROTECTED = [
  "src/lib/views/hooks/useView.ts",
  "src/lib/views/hooks/useWidgetOperations.ts",
  "src/lib/views/hooks/useViewActionCallbacks.ts",
  "src/lib/views/utils/LayoutSaveQueue.ts",
  "src/operations/formula/evaluator.ts",
  "src/operations/formula/dsl.ts",
];

export function normalizeRepoPath(p) {
  return (p ?? "").replace(/^frontend\//, "").replace(/^\//, "").trim();
}

export function parseCampaignFocus(intent = "") {
  const text = (intent ?? "").toLowerCase();
  const healthFocus =
    /health\s*functions?\s*>\s*60\s*loc/.test(text) ||
    /functions?\s*>\s*60\s*loc/.test(text) ||
    /focus:\s*health/.test(text) ||
    text.includes("health functions");

  return {
    intent_raw: intent,
    health_functions_above_60_loc: healthFocus,
    primary_metric: healthFocus ? "functions_above_threshold" : "health_score",
    wave_command: "fix-module",
    defer_high_fan_in: true,
    max_function_loc: 60,
  };
}

export function loadProtectedPaths(campaignId) {
  const paths = new Set(DEFAULT_PROTECTED.map(normalizeRepoPath));

  for (const rel of ["artifacts/protected_paths.yaml", "dispatch-queue.yaml"]) {
    const filePath = path.join(campaignDir(campaignId), rel);
    if (!fs.existsSync(filePath)) continue;
    let inProtected = false;
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      if (line.trim() === "protected_paths:") {
        inProtected = true;
        continue;
      }
      const m = line.match(/^\s*-\s+(.+)/);
      if (inProtected && m) paths.add(normalizeRepoPath(m[1].trim()));
      if (inProtected && line.trim() && !line.startsWith(" ") && !m) inProtected = false;
    }
  }

  return [...paths];
}

export function loadCampaignContext(campaignId) {
  const campaign = loadCampaign(campaignId);
  if (!campaign) return null;
  return {
    campaign,
    focus: parseCampaignFocus(campaign.intent),
    protected_paths: loadProtectedPaths(campaignId),
    threshold: campaign.config?.satisfaction_threshold ?? 85,
    max_iterations: campaign.config?.max_iterations ?? 5,
    scope: campaign.scope ?? "frontend",
  };
}

export function isGoalAchieved(campaign, satisfaction = null) {
  const threshold = campaign.config?.satisfaction_threshold ?? 85;
  const score = satisfaction?.score ?? campaign.current?.satisfaction_score ?? 0;
  if (score < threshold) return false;
  if (campaign.status === "complete" || campaign.status === "satisfied") return true;
  if (satisfaction) {
    const verifyOk =
      satisfaction.e2e_pass !== false &&
      satisfaction.vitest_pass !== false &&
      satisfaction.typecheck_pass !== false &&
      satisfaction.build_pass !== false;
    if (!verifyOk) return false;
  }
  return score >= threshold;
}
