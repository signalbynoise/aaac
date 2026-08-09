/**
 * First-class failure extraction from Run manifests / artifacts.
 */

import fs from "fs";
import path from "path";
import { runDir } from "../lib.mjs";

export const FAILURE_CLASSES = {
  ARTIFACT_TOO_LARGE: "ARTIFACT_TOO_LARGE",
  GATE_FAIL: "GATE_FAIL",
  RUN_FAILED: "RUN_FAILED",
  PHASE_BOTTLENECK: "PHASE_BOTTLENECK",
};

/**
 * @param {object} manifest
 * @param {{ artifactsDir?: string, artifactCharWarn?: number }} [options]
 * @returns {object[]}
 */
export function extractFailures(manifest, options = {}) {
  const failures = [];
  const warn = options.artifactCharWarn ?? 16000;
  const runId = manifest.run_id;
  const base = {
    run_id: runId,
    verb: manifest.verb ?? null,
    object: manifest.object ?? null,
    command: manifest.command ?? null,
    phase: manifest.phase ?? null,
  };

  const log = Array.isArray(manifest.log) ? manifest.log : [];
  for (const entry of log) {
    const detail = String(entry?.detail ?? entry?.message ?? "");
    if (
      entry?.event === "gate_fail" ||
      detail.includes("gate_fail") ||
      detail.includes("context_budget_exceeded")
    ) {
      const artifactMatch = detail.match(
        /artifacts\/([A-Za-z0-9_.-]+)\s+is\s+(\d+)\s+bytes/i,
      );
      if (
        detail.includes("context_budget_exceeded") ||
        detail.includes("ARTIFACT") ||
        artifactMatch
      ) {
        failures.push({
          ...base,
          class: FAILURE_CLASSES.ARTIFACT_TOO_LARGE,
          phase: entry?.phase ?? manifest.phase ?? null,
          artifact: artifactMatch?.[1]
            ? `artifacts/${artifactMatch[1]}`
            : null,
          bytes: artifactMatch ? Number(artifactMatch[2]) : null,
          limit: warn,
          detail: detail.slice(0, 400),
          source: "log",
        });
      } else {
        failures.push({
          ...base,
          class: FAILURE_CLASSES.GATE_FAIL,
          phase: entry?.phase ?? manifest.phase ?? null,
          detail: detail.slice(0, 400),
          source: "log",
        });
      }
    }
  }

  const blocked = String(manifest.blocked_reason ?? "");
  if (blocked.includes("context_budget_exceeded")) {
    const artifactMatch = blocked.match(
      /artifacts\/([A-Za-z0-9_.-]+)\s+is\s+(\d+)\s+bytes/i,
    );
    failures.push({
      ...base,
      class: FAILURE_CLASSES.ARTIFACT_TOO_LARGE,
      artifact: artifactMatch?.[1]
        ? `artifacts/${artifactMatch[1]}`
        : null,
      bytes: artifactMatch ? Number(artifactMatch[2]) : null,
      limit: warn,
      detail: blocked.slice(0, 400),
      source: "blocked_reason",
    });
  }

  // Measure artifact sizes on disk when present.
  const artifactsDir =
    options.artifactsDir ?? path.join(runDir(runId), "artifacts");
  if (fs.existsSync(artifactsDir)) {
    for (const name of ["plan.yaml", "report.md", "discover_brief.yaml"]) {
      const full = path.join(artifactsDir, name);
      if (!fs.existsSync(full)) continue;
      const bytes = fs.statSync(full).size;
      if (bytes > warn) {
        const already = failures.some(
          (f) =>
            f.class === FAILURE_CLASSES.ARTIFACT_TOO_LARGE &&
            String(f.artifact ?? "").endsWith(name),
        );
        if (!already) {
          failures.push({
            ...base,
            class: FAILURE_CLASSES.ARTIFACT_TOO_LARGE,
            phase:
              name.startsWith("plan")
                ? "plan"
                : name.startsWith("report")
                  ? "report"
                  : "discover",
            artifact: `artifacts/${name}`,
            bytes,
            limit: warn,
            detail: `${name} is ${bytes} bytes (warn threshold ${warn})`,
            source: "artifact_stat",
          });
        }
      }
    }
  }

  if (
    (manifest.status === "failed" || manifest.status === "cancelled") &&
    !failures.length
  ) {
    failures.push({
      ...base,
      class: FAILURE_CLASSES.RUN_FAILED,
      detail: `Run ended with status=${manifest.status}`,
      source: "status",
    });
  }

  // Dedupe by class+artifact+phase
  const seen = new Set();
  const out = [];
  for (const f of failures) {
    const key = `${f.class}|${f.phase}|${f.artifact ?? ""}|${f.detail?.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
