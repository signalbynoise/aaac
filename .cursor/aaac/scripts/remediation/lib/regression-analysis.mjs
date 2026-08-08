#!/usr/bin/env node
/**
 * Compare verify metrics: campaign baseline vs pre-wave vs current.
 */
import { readJson } from "../../run-engine/lib.mjs";

const LAYER_KEYS = ["typecheck", "vitest", "go_test", "build", "playwright"];

function layerCount(snapshot, layer) {
  if (!snapshot) return 0;
  return (
    snapshot.metrics?.[layer]?.error_count ??
    (snapshot.layers?.[layer]?.error_count ?? 0)
  );
}

function layerStatus(snapshot, layer) {
  if (!snapshot) return "pass";
  return snapshot.metrics?.[layer]?.status ?? snapshot.layers?.[layer]?.status ?? "pass";
}

export function analyzeRegression({ current, preWave, campaignBaseline }) {
  const deltas = {};
  const introduced = {};
  let introducedRegression = false;

  for (const layer of LAYER_KEYS) {
    const cur = layerCount(current, layer);
    const pre = layerCount(preWave, layer);
    const base = layerCount(campaignBaseline, layer);
    const deltaPre = cur - pre;
    const deltaBase = cur - base;
    deltas[layer] = { current: cur, pre_wave: pre, campaign_baseline: base, delta_pre_wave: deltaPre, delta_baseline: deltaBase };
    introduced[layer] = deltaPre > 0 || (layerStatus(current, layer) === "fail" && layerStatus(preWave, layer) === "pass" && cur > 0);
    if (introduced[layer]) introducedRegression = true;
  }

  const debtRemaining = LAYER_KEYS.some((l) => layerCount(current, l) > 0 || layerStatus(current, l) === "fail");
  const strictPass = current?.status === "pass" && (current?.metrics?.total_errors ?? 0) === 0;

  return {
    introduced_regression: introducedRegression,
    introduced_layers: Object.entries(introduced).filter(([, v]) => v).map(([k]) => k),
    deltas,
    debt_remaining: debtRemaining,
    strict_pass: strictPass,
    total_errors: current?.metrics?.total_errors ?? 0,
    total_errors_baseline: campaignBaseline?.metrics?.total_errors ?? layerCount(campaignBaseline, "typecheck"),
  };
}

export function loadSnapshot(path) {
  if (!path) return null;
  return readJson(path, null);
}
