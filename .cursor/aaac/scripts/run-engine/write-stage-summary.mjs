#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isoNow, loadEnforcement, loadRunManifest, runDir,
} from "./lib.mjs";
import {
  STAGE_SUMMARIES_REL,
  STAGE_SUMMARY_TITLE,
  missingStageSummaryEntry,
  parseStageSummariesYaml,
  serializeStageSummaries,
  validateStageSummaryEntry,
} from "./stage-summary-contract.mjs";
import {
  buildLaymanFromArtifacts,
  extractSealedStageMetrics,
  isStageSummaryEligible,
  prepareStageSummaryEvidence,
} from "./stage-summary-evidence.mjs";

export {
  STAGE_SUMMARIES_REL,
  STAGE_SUMMARY_TITLE,
  buildLaymanFromArtifacts,
  extractSealedStageMetrics,
  isStageSummaryEligible,
  parseStageSummariesYaml,
  serializeStageSummaries,
  validateStageSummaryEntry,
};

function loadDocument(filePath) {
  return fs.existsSync(filePath)
    ? parseStageSummariesYaml(fs.readFileSync(filePath, "utf8"))
    : { phases: {} };
}

function persist(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeStageSummaries(document));
}

export function writeStageSummary(runId, phase, options = {}) {
  const manifest = options.manifest ?? loadRunManifest(runId);
  const enforcement = options.enforcement ?? loadEnforcement();
  if (!manifest) return { status: "missing", skipped: true, reason: "run not found" };
  const filePath = path.join(runDir(runId), STAGE_SUMMARIES_REL);
  const document = loadDocument(filePath);
  const prior = document.phases[phase] ?? null;
  const evidence = prepareStageSummaryEvidence(runId, phase, manifest, enforcement);
  if (!evidence.selected) {
    document.phases[phase] = {
      ...missingStageSummaryEntry(prior, "VALIDATE_FAIL: no safe summary candidate"),
      status: "failed",
      source_artifacts: evidence.readable,
    };
    persist(filePath, document);
    return {
      status: "failed",
      reason: document.phases[phase].reason, path: STAGE_SUMMARIES_REL,
    };
  }
  if (
    prior?.status === "validated" &&
    prior.source_fingerprint === evidence.sourceFingerprint
  ) {
    return {
      status: "validated", skipped: true,
      reason: "unchanged semantic input", path: STAGE_SUMMARIES_REL,
    };
  }
  const now = isoNow();
  const entry = {
    status: "pending",
    title: STAGE_SUMMARY_TITLE,
    layman: evidence.selected.layman,
    metrics: evidence.metrics,
    source_artifacts: evidence.selected.source_artifacts,
    source_fingerprint: evidence.sourceFingerprint,
    generated_at: now,
    validated_at: null,
    reason: null,
  };
  const validation = validateStageSummaryEntry(entry);
  entry.status = validation.ok ? "validated" : "failed";
  entry.validated_at = validation.ok ? now : null;
  entry.reason = validation.ok ? null : validation.reason;
  document.phases[phase] = entry;
  persist(filePath, document);
  return validation.ok
    ? { status: "validated", path: STAGE_SUMMARIES_REL, layman: entry.layman }
    : { status: "failed", path: STAGE_SUMMARIES_REL, reason: entry.reason };
}

const isCli = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const result = writeStageSummary(process.argv[2], process.argv[3]);
  console.log(JSON.stringify({ ok: true, ...result }));
}
