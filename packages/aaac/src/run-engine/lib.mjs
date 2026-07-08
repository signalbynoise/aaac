#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveRoots() {
  const workspaceOverride = process.env.AAAC_WORKSPACE_ROOT;
  if (workspaceOverride) {
    const repoRoot = path.resolve(workspaceOverride);
    const cursorRoot = path.join(repoRoot, ".cursor");
    return { repoRoot, cursorRoot };
  }
  const monorepoRoot = path.resolve(__dirname, "../../../..");
  const dogfoodAaac = path.join(monorepoRoot, ".cursor", "aaac");
  if (fs.existsSync(path.join(dogfoodAaac, "enforcement.json"))) {
    return {
      repoRoot: monorepoRoot,
      cursorRoot: path.join(monorepoRoot, ".cursor"),
    };
  }
  const cursorRoot = path.resolve(__dirname, "../../..");
  return { repoRoot: path.resolve(cursorRoot, ".."), cursorRoot };
}

const { repoRoot: REPO_ROOT_VALUE, cursorRoot: CURSOR_ROOT_VALUE } = resolveRoots();

export const CURSOR_ROOT = CURSOR_ROOT_VALUE;
export const REPO_ROOT = REPO_ROOT_VALUE;
export const AAAC_ROOT = path.join(CURSOR_ROOT, "aaac");
export const STATE_ROOT = path.join(AAAC_ROOT, "state");
export const RUNS_ROOT = path.join(STATE_ROOT, "runs");
export const ACTIVE_RUN_PATH = path.join(STATE_ROOT, "active-run.json");
export const ACTIVE_RUNS_DIR = path.join(STATE_ROOT, "active-runs");
export const SESSIONS_DIR = path.join(STATE_ROOT, "sessions");
export const REGISTRY_PATH = path.join(AAAC_ROOT, "runtime-registry.json");
export const ENFORCEMENT_PATH = path.join(AAAC_ROOT, "enforcement.json");
export const ONTOLOGY_PATH = path.join(AAAC_ROOT, "ontology.json");
export const CAPABILITY_REGISTRY_PATH = path.join(AAAC_ROOT, "capabilities", "registry.json");
export const PROMOTION_RULES_PATH = path.join(AAAC_ROOT, "capabilities", "promotion-rules.json");
export const CAPABILITY_STATS_PATH = path.join(STATE_ROOT, "capability-stats.json");

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  maybeScheduleRunPersist(filePath, data);
}

function maybeScheduleRunPersist(filePath, data) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.endsWith("/run.json")) return;
  const runId = data?.run_id ?? path.basename(path.dirname(filePath));
  if (!runId) return;
  import("./persist-run.mjs")
    .then(({ scheduleRunPersist }) => scheduleRunPersist(runId, data))
    .catch(() => {
      // persist-run optional when not deployed
    });
}

export function loadRegistry() {
  const reg = readJson(REGISTRY_PATH);
  if (!reg?.commands) {
    throw new Error(`Missing ${REGISTRY_PATH}. Run: node .cursor/aaac/generate-graph.mjs`);
  }
  return reg;
}

export function loadEnforcement() {
  return readJson(ENFORCEMENT_PATH, {
    edit_phases: ["execute", "sync_inventory", "persist", "write"],
    swarm_min_agents: {},
    allowed_path_prefixes: {},
  });
}

export function conversationIdFromHook(hook) {
  return hook?.conversation_id ?? hook?.conversationId ?? hook?.session_id ?? hook?.sessionId ?? null;
}

export function activeRunPath(conversationId) {
  if (!conversationId) return ACTIVE_RUN_PATH;
  const safe = conversationId.replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(ACTIVE_RUNS_DIR, `${safe}.json`);
}

export function loadActiveRun(conversationId = null) {
  if (conversationId) return readJson(activeRunPath(conversationId));
  return readJson(ACTIVE_RUN_PATH);
}

export function saveActiveRun(conversationId, data) {
  if (!conversationId) {
    writeJson(ACTIVE_RUN_PATH, data);
    return;
  }
  writeJson(activeRunPath(conversationId), data);
}

export function loadRunManifest(runId) {
  return readJson(path.join(RUNS_ROOT, runId, "run.json"));
}

export function runDir(runId) {
  return path.join(RUNS_ROOT, runId);
}

export function parseAaacPrompt(text) {
  if (!text || typeof text !== "string") return null;
  const registry = loadRegistry();
  const trimmed = text.trim();
  const match = trimmed.match(/^\/([a-z][a-z0-9-]*)(?:\s+(\S+))?(?:\s+"([^"]*)"|(?:\s+([\s\S]+))?)?$/);
  if (!match) return null;
  let command = match[1];
  const aliasTarget = registry.aliases?.[command];
  if (aliasTarget) command = aliasTarget;
  if (!registry.commands[command]) return null;
  let domain = match[2] ?? null;
  let intent = (match[3] ?? match[4] ?? "").trim();
  if (domain && (domain.includes(" ") || domain.startsWith('"'))) {
    intent = `${domain} ${intent}`.trim();
    domain = null;
  }
  if (domain && !intent && !domain.match(/^[a-z]+$/)) {
    intent = domain;
    domain = null;
  }
  return { command, domain, intent, raw: trimmed };
}

export function resolvePending(command, registry) {
  const entry = registry.commands[command];
  if (!entry?.pending?.length) throw new Error(`No pending phases for command: ${command}`);
  return entry.pending;
}

export function slugify(s) {
  return (s || "run").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function isoNow() {
  return new Date().toISOString();
}

export function isGatePhase(phase, registry) {
  return Boolean(registry.gate_phases?.[phase]);
}

export function isEditPhase(phase, enforcement) {
  return enforcement.edit_phases.includes(phase);
}

/** Test/spec file paths — used for writer vs tester phase scoping. */
export function isTestPath(filePath) {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return (
    /\.(test|spec)\.(mjs|cjs|js|ts|tsx)$/.test(normalized) ||
    /(?:^|\/)__tests__(?:\/|$)/.test(normalized) ||
    /(?:^|\/)tests\/(?:unit|integration|e2e|fixtures)\//.test(normalized)
  );
}

/** Phase-scoped edit rules from enforcement.phase_edit_scopes (v3+). */
export function isPathAllowedForPhase(filePath, phase, enforcement) {
  if (!filePath) return true;
  const scopes = enforcement.phase_edit_scopes?.[phase];
  if (!scopes) return true;
  const isTest = isTestPath(filePath);
  if (scopes.deny_test_paths && isTest) return false;
  if (scopes.test_paths_only && !isTest) return false;
  return true;
}

export function isArtifactPath(filePath, enforcement) {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixes = [
    ...(enforcement.allowed_path_prefixes?.run_artifacts ?? []),
    ...(enforcement.allowed_path_prefixes?.write_article ?? []),
  ];
  return prefixes.some((p) => normalized.includes(p.replace(/^\.\//, "")));
}

/** Decision artifacts for a phase (global + verb-specific). */
export function phaseDecisionArtifacts(phase, manifest, enforcement) {
  const byVerb = enforcement.phase_artifacts_by_verb?.[manifest?.verb]?.[phase];
  const global = enforcement.phase_artifacts?.[phase] ?? [];
  return [...global, ...(byVerb ?? [])];
}

/** True when filePath is a phase decision artifact (requires swarm before parent may write). */
export function artifactMatchesPhaseDecision(filePath, phase, manifest, enforcement) {
  if (!filePath || !phase) return false;
  const normalized = filePath.replace(/\\/g, "/");
  if (!isArtifactPath(filePath, enforcement)) return false;
  const aliases = enforcement.phase_artifact_aliases ?? {};
  const decisions = phaseDecisionArtifacts(phase, manifest, enforcement);
  for (const artifact of decisions) {
    const candidates = [artifact, ...(aliases[artifact] ?? [])];
    if (candidates.some((c) => normalized.includes(c.replace(/^\.\//, "")))) {
      return true;
    }
  }
  return false;
}

/**
 * When agent_separation.parent_may_assess is false, block parent writes to decision
 * artifacts until Task swarm minimum is met for the current phase.
 * @returns {{ min: number, launches: number, phase: string } | null}
 */
export function parentAssessmentBlocked(manifest, enforcement, filePath) {
  if (enforcement.agent_separation?.parent_may_assess !== false) return null;
  if (!filePath || !manifest?.phase) return null;
  if (!artifactMatchesPhaseDecision(filePath, manifest.phase, manifest, enforcement)) {
    return null;
  }
  const min = resolveSwarmMinimum(manifest.phase, manifest, enforcement);
  if (!min) return null;
  const launches = manifest.swarm?.task_launches_this_phase ?? 0;
  if (launches >= min) return null;
  return { min, launches, phase: manifest.phase };
}

const EDITOR_DELEGATE_PHASES_DEFAULT = ["execute", "debt_sweep"];

/** True when subagent_id is registered as an active code editor with required agent_spec_id. */
export function isRegisteredCodeEditor(hook, manifest, enforcement) {
  const subagentId = hook?.subagent_id ?? hook?.subagentId ?? null;
  if (!subagentId) return false;
  const required = enforcement?.agent_separation?.required_execute_agent_spec;
  if (!required) return false;
  const editors = manifest?.swarm?.active_code_editors ?? [];
  return editors.some(
    (e) => e.subagent_id === subagentId && e.agent_spec_id === required,
  );
}

/** True when the hook originates from a Task subagent (not the parent orchestrator). */
export function isSubagentToolHook(hook, manifest, enforcement = null) {
  const subagentId = hook?.subagent_id ?? hook?.subagentId ?? null;
  if (subagentId) {
    const delegatePhases =
      enforcement?.agent_separation?.editor_delegate_phases ?? EDITOR_DELEGATE_PHASES_DEFAULT;
    const phase = manifest?.phase;
    if (phase && delegatePhases.includes(phase)) {
      if (!enforcement) return false;
      return isRegisteredCodeEditor(hook, manifest, enforcement);
    }
    const editors = manifest?.swarm?.active_code_editors ?? [];
    if (!editors.length) return true;
    return editors.some((e) => e.subagent_id === subagentId);
  }
  if (hook?.parent_conversation_id ?? hook?.parentConversationId) return true;
  return false;
}

/** Production/source path (not test, not run artifact). */
export function isProdEditPath(filePath, enforcement) {
  if (!filePath) return false;
  if (isTestPath(filePath)) return false;
  if (isArtifactPath(filePath, enforcement)) return false;
  return true;
}

/**
 * Block parent orchestrator from writing prod code in delegate phases (execute).
 * @returns {{ phase: string } | null}
 */
export function parentProdEditBlocked(manifest, enforcement, filePath, hook) {
  if (enforcement.agent_separation?.parent_may_edit_prod !== false) return null;
  const phase = manifest?.phase;
  const delegatePhases =
    enforcement.agent_separation?.editor_delegate_phases ?? EDITOR_DELEGATE_PHASES_DEFAULT;
  if (!phase || !delegatePhases.includes(phase)) return null;
  if (!isProdEditPath(filePath, enforcement)) return null;
  if (isSubagentToolHook(hook, manifest, enforcement)) return null;
  return { phase };
}

export function phaseKind(phase, registry) {
  return isGatePhase(phase, registry) ? "gate" : "work";
}

/** Swarm minimum for completed phase — uses dynamic targets when available on manifest. */
export function resolveSwarmMinimum(completedPhase, manifest, enforcement) {
  const fromManifest = manifest?.swarm?.target_agents?.[completedPhase];
  if (fromManifest != null && fromManifest > 0) return fromManifest;

  const mutating = enforcement.mutating_verbs ?? ["create", "update", "fix"];
  const isMutating =
    mutating.includes(manifest.verb) ||
    enforcement.fix_commands?.includes(manifest.command);

  if (completedPhase === "verify" && isMutating) {
    return (
      enforcement.swarm_min_agents?.verify ??
      enforcement.swarm_min_agents?.verify_fix
    );
  }
  if (completedPhase === "test_execute" && isMutating) {
    return enforcement.swarm_min_agents?.test_execute;
  }
  if (completedPhase === "execute" && isMutating) {
    return enforcement.swarm_min_agents?.execute;
  }
  if (completedPhase === "review_swarm" && isMutating) {
    return enforcement.swarm_min_agents?.review_swarm;
  }
  if (completedPhase === "discover" && manifest.verb === "check") {
    return (
      enforcement.swarm_min_agents?.check_swarm ??
      enforcement.swarm_min_agents?.discover
    );
  }
  if (completedPhase === "discover") {
    return enforcement.swarm_min_agents?.discover;
  }
  return enforcement.swarm_min_agents?.[completedPhase];
}

export function resolveSwarmTarget(completedPhase, manifest, enforcement) {
  return resolveSwarmMinimum(completedPhase, manifest, enforcement);
}


export function promptFromHook(hook) {
  return hook?.prompt ?? hook?.text ?? hook?.content ?? "";
}

/** User explicitly asked to halt the current Run (short prompts only). */
export function isUserStopIntent(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length > 60) return false;
  return (
    /^(stop|cancel|abort)([.!?]*)$/i.test(trimmed) ||
    /^(please\s+)?(stop|cancel|abort)([.!?]*)$/i.test(trimmed) ||
    /^(stop|cancel|abort)\s+(the\s+)?run([.!?]*)$/i.test(trimmed)
  );
}

export function cancelRunManifest(manifest, evidence = "user_stop") {
  manifest.status = "cancelled";
  manifest.awaiting_approval = false;
  manifest.blocked_reason = null;
  manifest.updated_at = isoNow();
  if (manifest.enforcement) {
    manifest.enforcement.edit_allowed = true;
  }
  return manifest;
}

export function clearActiveRun(conversationId) {
  if (!conversationId) return;
  const filePath = activeRunPath(conversationId);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already cleared
  }
}

export function saveSessionRun(sessionId, data) {
  if (!sessionId) return;
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  writeJson(path.join(SESSIONS_DIR, `${safe}.json`), data);
}


export function isMutatingVerb(manifest, enforcement) {
  const mutating = enforcement.mutating_verbs ?? ["create", "update", "fix"];
  return (
    mutating.includes(manifest.verb) ||
    (enforcement.fix_commands ?? []).includes(manifest.command)
  );
}

/** List items under a YAML field (lines starting with `-` before next top-level key). */
export function readYamlListField(content, fieldName) {
  if (!content) return [];
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${fieldName}:`));
  if (start < 0) return [];

  const inline = lines[start].slice(`${fieldName}:`.length).trim();
  if (inline === "[]") return [];
  if (inline && !inline.startsWith("-")) return [inline];

  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim()) break;
    const itemMatch = line.match(/^\s+-\s+(.*)$/);
    if (itemMatch) items.push(itemMatch[1].trim());
  }
  return items;
}

export function readYamlScalarField(content, fieldName) {
  if (!content) return null;
  const match = content.match(new RegExp(`^${fieldName}:\\s*(.+)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export function hasYamlField(content, fieldName) {
  if (!content) return false;
  return new RegExp(`^${fieldName}:`, "m").test(content);
}

export function planRequiresTests(planContent) {
  if (!planContent) return false;
  if (hasYamlField(planContent, "tests_to_add")) {
    return readYamlListField(planContent, "tests_to_add").length > 0;
  }
  return /^\s*create:[\s\S]*?^\s+-\s+path:.*\/lib\//m.test(planContent);
}

export function validateExecuteAgentSpec(manifest, enforcement, completedPhase = "execute") {
  if (completedPhase !== "execute") return { ok: true };
  if (!isMutatingVerb(manifest, enforcement)) return { ok: true };
  const required = enforcement.agent_separation?.required_execute_agent_spec;
  if (!required) return { ok: true };
  const agents = (manifest.swarm?.agents ?? []).filter((a) => a.phase === completedPhase);
  if (agents.some((a) => a.agent_spec_id === required)) return { ok: true };
  const observed = agents.length
    ? agents.map((a) => a.agent_spec_id ?? "(missing)").join(", ")
    : "(none)";
  return {
    ok: false,
    reason:
      `execute phase requires ≥1 Task agent with agent_spec_id "${required}" ` +
      `(found: ${observed}). Launch Task with description starting "${required}" ` +
      `or reference agents/${required}.md.`,
  };
}

export function validatePhaseArtifactContent(runId, completedPhase, manifest, enforcement) {
  if (!isMutatingVerb(manifest, enforcement)) {
    return { ok: true };
  }

  const planPath = path.join(runDir(runId), "artifacts/plan.yaml");
  const planContent = fs.existsSync(planPath)
    ? fs.readFileSync(planPath, "utf8")
    : "";

  if (completedPhase === "plan") {
    if (!hasYamlField(planContent, "tests_to_add")) {
      return {
        ok: false,
        reason:
          "plan.yaml must include tests_to_add (behaviors to cover, or tests_to_add: [] when no tests are needed)",
      };
    }
    return { ok: true };
  }

  if (completedPhase === "test_execute") {
    const testPlanPath = path.join(runDir(runId), "artifacts/test_plan.yaml");
    const testPlanContent = fs.existsSync(testPlanPath)
      ? fs.readFileSync(testPlanPath, "utf8")
      : "";

    const filesWritten = readYamlListField(testPlanContent, "files_written");
    const skippedReason = readYamlScalarField(testPlanContent, "skipped_reason");
    const testsRequired = planRequiresTests(planContent);

    if (/status:\s*deferred/i.test(testPlanContent) && filesWritten.length === 0) {
      return {
        ok: false,
        reason:
          "test_plan.yaml cannot defer tests — author test files in test_execute (files_written required)",
      };
    }

    if (testsRequired && filesWritten.length === 0) {
      return {
        ok: false,
        reason:
          "plan.yaml tests_to_add requires non-empty test_plan.files_written — launch test-author Task in test_execute",
      };
    }

    if (
      hasYamlField(planContent, "tests_to_add") &&
      /tests_to_add:\s*\[\]/m.test(planContent) &&
      filesWritten.length === 0 &&
      !skippedReason
    ) {
      return {
        ok: false,
        reason:
          "tests_to_add is empty — test_plan.yaml must include skipped_reason explaining why no tests were authored",
      };
    }

    return { ok: true };
  }

  if (completedPhase === "execute") {
    return validateExecuteAgentSpec(manifest, enforcement, completedPhase);
  }

  return { ok: true };
}

/** Parse workspace .env.local files (website first, then repo root). */
export function loadWorkspaceDotenv(repoRoot = REPO_ROOT) {
  const candidates = [
    path.join(repoRoot, "apps/website/.env.local"),
    path.join(repoRoot, ".env.local"),
  ];
  const merged = {};
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Resolve a required phase artifact path. When agents write a known alias
 * (e.g. impact_analysis.yaml), rename it to the canonical enforcement name.
 */
export function normalizePhaseArtifactPath(runId, canonicalRel, enforcement) {
  const canonicalPath = path.join(runDir(runId), canonicalRel);
  if (fs.existsSync(canonicalPath)) {
    return { ok: true, path: canonicalRel };
  }

  const aliases = enforcement.phase_artifact_aliases?.[canonicalRel] ?? [];
  for (const aliasRel of aliases) {
    const aliasPath = path.join(runDir(runId), aliasRel);
    if (fs.existsSync(aliasPath)) {
      fs.renameSync(aliasPath, canonicalPath);
      return { ok: true, path: canonicalRel, normalized_from: aliasRel };
    }
  }

  return { ok: false, path: canonicalRel };
}

/** Workspace env overrides process env (fixes stale shell SUPABASE_URL). */
export function applyWorkspaceEnv(repoRoot = REPO_ROOT) {
  for (const [key, value] of Object.entries(loadWorkspaceDotenv(repoRoot))) {
    process.env[key] = value;
  }
}
