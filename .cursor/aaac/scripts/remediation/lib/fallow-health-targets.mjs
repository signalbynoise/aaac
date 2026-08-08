/**
 * Fetch ranked Fallow health decomposition targets for wave planning.
 */
import { spawnSync } from "child_process";
import path from "path";
import { REPO_ROOT } from "../../run-engine/lib.mjs";
import { normalizeRepoPath } from "./campaign-focus.mjs";

const HIGH_FAN_IN_DEFER = new Set([
  "src/operations/formula/evaluator.ts",
  "src/operations/formula/dsl.ts",
]);

export function fetchHealthTargets({ scope = "frontend", limit = 12 } = {}) {
  const cwd = scope === "frontend" ? path.join(REPO_ROOT, "frontend") : REPO_ROOT;
  const npx = spawnSync("npx", ["fallow", "health", "--score", "--targets", "--format", "json", "--quiet"], {
    cwd,
    encoding: "utf8",
  });

  try {
    const parsed = JSON.parse(npx.stdout || "{}");
    const targets = (parsed.targets ?? []).map((t) => ({
      ...t,
      path: normalizeRepoPath(t.path),
    }));
    return {
      score: parsed.health_score?.score ?? parsed.score ?? null,
      targets: targets.slice(0, limit),
    };
  } catch {
    return { score: null, targets: [] };
  }
}

export function filterTargetsForWaves(targets, { protected_paths = [], defer_high_fan_in = true } = {}) {
  const protectedSet = new Set(protected_paths.map(normalizeRepoPath));
  return targets.filter((t) => {
    const p = normalizeRepoPath(t.path);
    if (protectedSet.has(p)) return false;
    if (defer_high_fan_in && HIGH_FAN_IN_DEFER.has(p)) return false;
    const fanIn = (t.factors ?? []).find((f) => f.metric === "fan_in")?.value;
    if (defer_high_fan_in && fanIn != null && fanIn >= 10) return false;
    return true;
  });
}

export function targetToWaveIntent(target) {
  const rec = target.recommendation ?? target.actions?.[0]?.description ?? "";
  const filePath = normalizeRepoPath(target.path);
  const fn = target.evidence?.complex_functions?.[0]?.name;
  if (fn) {
    return `Extract ${fn} from ${filePath} into focused modules; keep every function under 60 LOC; preserve exports`;
  }
  return `Health decompose ${filePath}: ${rec}`.slice(0, 260);
}
