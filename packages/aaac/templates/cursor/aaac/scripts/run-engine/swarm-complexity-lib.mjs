/**
 * Shared helpers for scope/change complexity computation and YAML artifact IO.
 */
import fs from "fs";
import path from "path";
import { AAAC_ROOT, isoNow, readYamlScalarField, readYamlListField, hasYamlField, runDir, writeJson, loadRunManifest } from "./lib.mjs";
import { loadSwarmSizing, tierLookup } from "./load-swarm-sizing.mjs";

export function readArtifactYaml(runId, relPath) {
  const filePath = path.join(runDir(runId), relPath);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

export function writeArtifactYaml(runId, relPath, lines) {
  const filePath = path.join(runDir(runId), relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = Array.isArray(lines) ? lines.join("\n") + "\n" : lines;
  fs.writeFileSync(filePath, body);
}

export function readYamlNumber(content, fieldName, fallback = 0) {
  const raw = readYamlScalarField(content, fieldName);
  if (raw == null || raw === "") {
    const nested = content.match(new RegExp(`^\\s*${fieldName}:\\s*(.+)$`, "m"));
    if (!nested) return fallback;
    const n = Number(nested[1].trim());
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function readYamlBool(content, fieldName) {
  const raw =
    readYamlScalarField(content, fieldName) ??
    content.match(new RegExp(`^\\s*${fieldName}:\\s*(.+)$`, "m"))?.[1]?.trim();
  if (!raw) return false;
  return /^(true|yes|1)$/i.test(raw);
}

export function countIntentTokens(intent) {
  if (!intent || typeof intent !== "string") return 0;
  return intent.trim().split(/\s+/).filter(Boolean).length;
}

export function loadObjectMaturity(object) {
  if (!object) return null;
  try {
    const ontologyPath = path.join(AAAC_ROOT, "ontology.json");
    const ontology = JSON.parse(fs.readFileSync(ontologyPath, "utf8"));
    return ontology.object_maturity?.[object] ?? null;
  } catch {
    return null;
  }
}

export function computeBootstrapScopeScore(manifest, sizing) {
  const weights = sizing.bootstrap?.weights ?? {};
  const breakdown = {};
  let score = 0;

  const tokens = countIntentTokens(manifest.intent);
  if (tokens > 500 && weights.intent_tokens_over_500) {
    breakdown.intent_tokens_over_500 = weights.intent_tokens_over_500;
    score += weights.intent_tokens_over_500;
  } else if (tokens > 200 && weights.intent_tokens_over_200) {
    breakdown.intent_tokens_over_200 = weights.intent_tokens_over_200;
    score += weights.intent_tokens_over_200;
  }

  if (!manifest.domain && weights.no_domain_slug) {
    breakdown.no_domain_slug = weights.no_domain_slug;
    score += weights.no_domain_slug;
  }

  if (manifest.verb === "fix" && weights.verb_fix) {
    breakdown.verb_fix = weights.verb_fix;
    score += weights.verb_fix;
  }
  if (manifest.verb === "create" && weights.verb_create) {
    breakdown.verb_create = weights.verb_create;
    score += weights.verb_create;
  }

  const maturity = loadObjectMaturity(manifest.object);
  if (maturity === "critical" && weights.object_maturity_critical) {
    breakdown.object_maturity_critical = weights.object_maturity_critical;
    score += weights.object_maturity_critical;
  }
  if (maturity === "protected" && weights.object_maturity_protected) {
    breakdown.object_maturity_protected = weights.object_maturity_protected;
    score += weights.object_maturity_protected;
  }

  return { score, breakdown, signals: { intent_tokens: tokens, object_maturity: maturity } };
}

export function computeDiscoverScopeScore(briefContent, manifest, sizing) {
  const weights = sizing.scope_weights ?? {};
  const breakdown = {};
  let score = 0;

  if (hasYamlField(briefContent, "scope_signals")) {
    const signalsBlock = briefContent.match(/scope_signals:[\s\S]*?(?=\n\S|\n*$)/)?.[0] ?? "";
    const signalFiles = readYamlNumber(signalsBlock, "files_in_scope", 0);
    const paths = readYamlListField(signalsBlock, "paths_enumerated");
    const effectiveFiles = signalFiles || paths.length;
    const baseline = weights.files_in_scope_baseline ?? 5;
    const per5 = weights.files_in_scope_per_5 ?? 1;
    if (effectiveFiles > baseline) {
      const extra = Math.ceil((effectiveFiles - baseline) / 5);
      breakdown.files_in_scope = extra * per5;
      score += breakdown.files_in_scope;
    }

    if (readYamlBool(signalsBlock, "cross_domain") && weights.cross_domain) {
      breakdown.cross_domain = weights.cross_domain;
      score += weights.cross_domain;
    }
    if (readYamlBool(signalsBlock, "migration_mentioned") && weights.migration_mentioned) {
      breakdown.migration_mentioned = weights.migration_mentioned;
      score += weights.migration_mentioned;
    }
    if (readYamlBool(signalsBlock, "protected_object") && weights.protected_object) {
      breakdown.protected_object = weights.protected_object;
      score += weights.protected_object;
    }

    const ambiguity =
      readYamlScalarField(signalsBlock, "intent_ambiguity") ??
      signalsBlock.match(/^\s*intent_ambiguity:\s*(.+)$/m)?.[1]?.trim();
    if (ambiguity === "medium" && weights.intent_ambiguity_medium) {
      breakdown.intent_ambiguity_medium = weights.intent_ambiguity_medium;
      score += weights.intent_ambiguity_medium;
    }
    if (ambiguity === "high" && weights.intent_ambiguity_high) {
      breakdown.intent_ambiguity_high = weights.intent_ambiguity_high;
      score += weights.intent_ambiguity_high;
    }

    const openQuestions = readYamlNumber(signalsBlock, "open_questions_count", 0);
    if (openQuestions > 0 && weights.open_questions_per_item) {
      breakdown.open_questions = openQuestions * weights.open_questions_per_item;
      score += breakdown.open_questions;
    }
  } else {
    const filesInScope = readYamlNumber(briefContent, "files_in_scope", 0);
    const baseline = weights.files_in_scope_baseline ?? 5;
    const per5 = weights.files_in_scope_per_5 ?? 1;
    if (filesInScope > baseline) {
      const extra = Math.ceil((filesInScope - baseline) / 5);
      breakdown.files_in_scope = extra * per5;
      score += breakdown.files_in_scope;
    }
  }

  if (/diagram/i.test(manifest.intent ?? "") && weights.article_type_diagrams) {
    breakdown.article_type_diagrams = weights.article_type_diagrams;
    score += weights.article_type_diagrams;
  }

  return {
    score: Math.max(0, score),
    breakdown,
    signals: {
      files_in_scope: readYamlNumber(briefContent, "files_in_scope", 0),
      command: manifest.command,
    },
  };
}

export function computeRemediationScanScopeScore(runId, sizing) {
  const weights = sizing.scope_weights ?? {};
  const breakdown = {};
  let score = 0;

  const scanPath = path.join(runDir(runId), "artifacts/fallow_scan.json");
  const classPath = path.join(runDir(runId), "artifacts/fallow_classification.json");
  let actionable = 0;
  let protectedHits = 0;
  let crossApp = 0;

  if (fs.existsSync(scanPath)) {
    try {
      const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
      actionable = scan.actionable_total ?? scan.summary?.actionable_total ?? 0;
      protectedHits = scan.protected_path_hits ?? scan.summary?.protected_path_hits ?? 0;
      crossApp = scan.cross_app_violations ?? scan.summary?.cross_app_violations ?? 0;
    } catch {
      // ignore parse errors
    }
  }

  if (fs.existsSync(classPath)) {
    try {
      const classification = JSON.parse(fs.readFileSync(classPath, "utf8"));
      actionable =
        classification.summary?.actionable_total ??
        classification.actionable_total ??
        actionable;
    } catch {
      // ignore
    }
  }

  if (actionable > 0 && weights.remediation_actionable_per_10) {
    breakdown.remediation_actionable = Math.ceil(actionable / 10) * weights.remediation_actionable_per_10;
    score += breakdown.remediation_actionable;
  }
  if (protectedHits > 0 && weights.remediation_protected_hits) {
    breakdown.remediation_protected_hits = weights.remediation_protected_hits;
    score += weights.remediation_protected_hits;
  }
  if (crossApp > 0 && weights.remediation_cross_app) {
    breakdown.remediation_cross_app = weights.remediation_cross_app;
    score += weights.remediation_cross_app;
  }

  return {
    score,
    breakdown,
    signals: { actionable, protectedHits, crossApp },
  };
}

export function minConfidenceFromValidate(validateContent) {
  const arch = readYamlNumber(validateContent, "architecture", 1);
  const req = readYamlNumber(validateContent, "requirements", 1);
  const scope = readYamlNumber(validateContent, "scope", 1);
  if (hasYamlField(validateContent, "confidence:")) {
    const block = validateContent.match(/confidence:[\s\S]*?(?=\n\S|\n*$)/)?.[0] ?? "";
    const a = readYamlNumber(block, "architecture", arch);
    const r = readYamlNumber(block, "requirements", req);
    const s = readYamlNumber(block, "scope", scope);
    return Math.min(a, r, s);
  }
  return Math.min(arch, req, scope);
}

export function computeChangeScore(runId, manifest, sizing, source) {
  const weights = sizing.change_weights ?? {};
  const breakdown = {};
  let score = 0;

  const planContent = readArtifactYaml(runId, "artifacts/plan.yaml");
  const planScore = readYamlNumber(planContent, "complexity_score", 0);
  const multiplier = weights.plan_score_multiplier ?? 1;
  breakdown.plan_score = planScore * multiplier;
  score += breakdown.plan_score;

  const pathsModify = readYamlListField(planContent, "paths_to_touch");
  const pathsCount = pathsModify.length;
  const over = Math.max(0, pathsCount - 3);
  if (over > 0 && weights.paths_to_touch_per_path_over_3) {
    breakdown.paths_to_touch = over * weights.paths_to_touch_per_path_over_3;
    score += breakdown.paths_to_touch;
  }

  if (source === "post_impact" || fs.existsSync(path.join(runDir(runId), "artifacts/impact.yaml"))) {
    const impactContent = readArtifactYaml(runId, "artifacts/impact.yaml");
    const blast = readYamlScalarField(impactContent, "blast_radius") ?? "low";
    const blastWeight = weights.blast_radius?.[blast] ?? 0;
    if (blastWeight) {
      breakdown.blast_radius = blastWeight;
      score += blastWeight;
    }
  }

  const validateContent = readArtifactYaml(runId, "artifacts/validate.yaml");
  if (validateContent) {
    const minConf = minConfidenceFromValidate(validateContent);
    const penalty = (1 - minConf) * (weights.confidence_penalty_multiplier ?? 0);
    if (penalty > 0) {
      breakdown.confidence_penalty = Math.round(penalty * 100) / 100;
      score += breakdown.confidence_penalty;
    }
  }

  const depContent = readArtifactYaml(runId, "artifacts/dependency_graph.yaml");
  const violations = readYamlListField(depContent, "violations");
  if (violations.length > 0 && weights.dependency_violations_per_item) {
    breakdown.dependency_violations = violations.length * weights.dependency_violations_per_item;
    score += breakdown.dependency_violations;
  }

  return {
    score: Math.round(score * 100) / 100,
    breakdown,
    plan_score: planScore,
    modifiers: { source },
  };
}

export function targetFromScore(phase, score, sizing, phaseClass) {
  const tiers =
    phaseClass === "scope_driven"
      ? sizing.scope_tiers?.[phase]
      : sizing.change_tiers?.[phase];
  return tierLookup(tiers, score);
}

export function updateManifestComplexity(manifest, patch) {
  manifest.complexity = { ...(manifest.complexity ?? {}), ...patch };
  manifest.updated_at = isoNow();
  return manifest;
}

export function persistScopeComplexity(runId, manifest, data) {
  const lines = [
    `computed_at: ${isoNow()}`,
    `source: ${data.source}`,
    `score: ${data.score}`,
    "breakdown:",
    ...Object.entries(data.breakdown ?? {}).map(([k, v]) => `  ${k}: ${v}`),
    "signals:",
    ...Object.entries(data.signals ?? {}).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`),
  ];
  writeArtifactYaml(runId, "artifacts/scope_complexity.yaml", lines);
  updateManifestComplexity(manifest, {
    scope_score: data.score,
    scope_breakdown: data.breakdown,
    scope_source: data.source,
  });
}

export function persistChangeComplexity(runId, manifest, data) {
  const lines = [
    `computed_at: ${isoNow()}`,
    `source: ${data.modifiers?.source ?? "plan"}`,
    `score: ${data.score}`,
    `plan_score: ${data.plan_score ?? 0}`,
    "breakdown:",
    ...Object.entries(data.breakdown ?? {}).map(([k, v]) => `  ${k}: ${v}`),
  ];
  writeArtifactYaml(runId, "artifacts/change_complexity.yaml", lines);
  updateManifestComplexity(manifest, {
    change_score: data.score,
    change_breakdown: data.breakdown,
    change_source: data.modifiers?.source ?? "plan",
  });
}

export function loadManifestOrThrow(runId) {
  const manifest = loadRunManifest(runId);
  if (!manifest) throw new Error(`Run not found: ${runId}`);
  return manifest;
}

export function saveManifest(runId, manifest) {
  writeJson(path.join(runDir(runId), "run.json"), manifest);
}
