#!/usr/bin/env node
/**
 * AAAC Run manifest logging — SSOT: observability/telemetry.yaml
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isoNow } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AAAC_ROOT = path.resolve(__dirname, "../..");

export const LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LEVELS = new Set(Object.keys(LOG_LEVEL_PRIORITY));

export function normalizeLevel(level) {
  const normalized = (level ?? "info").toLowerCase();
  return VALID_LEVELS.has(normalized) ? normalized : "info";
}

export function getLogLevel() {
  return normalizeLevel(process.env.LOG_LEVEL);
}

export function shouldLog(level) {
  return LOG_LEVEL_PRIORITY[normalizeLevel(level)] >= LOG_LEVEL_PRIORITY[getLogLevel()];
}

export function recordLog(manifest, opts) {
  const level = normalizeLevel(opts.level ?? "info");
  const entry = {
    at: isoNow(),
    run_id: manifest.run_id,
    phase: opts.phase ?? manifest.phase ?? "dispatch",
    phase_kind: opts.phase_kind ?? manifest.phase_kind ?? "work",
    skill: opts.skill ?? null,
    event: opts.event,
    detail: opts.detail ?? "",
    level,
  };

  manifest.log = manifest.log ?? [];
  manifest.log.push(entry);

  if (shouldLog(level)) {
    debugPrint(entry);
  }

  return entry;
}

export function recordDecision(manifest, opts) {
  const entry = {
    at: isoNow(),
    phase: opts.phase ?? manifest.phase ?? "dispatch",
    decision: opts.decision,
    reason: opts.reason,
    evidence: opts.evidence ?? "",
  };

  manifest.decisions = manifest.decisions ?? [];
  manifest.decisions.push(entry);

  if (shouldLog("debug")) {
    debugPrint({
      level: "debug",
      run_id: manifest.run_id,
      phase: entry.phase,
      event: "decision",
      detail: entry.decision,
      reason: entry.reason,
      evidence: entry.evidence,
    });
  }

  return entry;
}

export function debugPrint(entry) {
  const level = normalizeLevel(entry.level ?? "info");
  const phase = entry.phase ?? "—";
  const event = entry.event ?? entry.decision ?? "—";
  const detail = entry.detail ?? entry.reason ?? "";
  const context = {};

  if (entry.run_id) context.run_id = entry.run_id;
  if (entry.skill) context.skill = entry.skill;
  if (entry.phase_kind) context.phase_kind = entry.phase_kind;
  if (entry.reason && entry.event === "decision") context.reason = entry.reason;
  if (entry.evidence) context.evidence = entry.evidence;

  const ctxStr = Object.keys(context).length ? ` ${JSON.stringify(context)}` : "";
  process.stderr.write(`[${level}] [run:${phase}:${event}] ${detail}${ctxStr}\n`);
}

export function filterLogByLevel(entries, minLevel) {
  const floor = LOG_LEVEL_PRIORITY[normalizeLevel(minLevel)];
  return (entries ?? []).filter((e) => {
    const entryLevel = e.level ? normalizeLevel(e.level) : "info";
    return LOG_LEVEL_PRIORITY[entryLevel] >= floor;
  });
}

export function loadVerbDebugProfiles() {
  const profilePath = path.join(AAAC_ROOT, "observability", "verb-debug.yaml");
  try {
    const raw = fs.readFileSync(profilePath, "utf8");
    return parseVerbDebugYaml(raw);
  } catch {
    return {};
  }
}

function parseVerbDebugYaml(raw) {
  const profiles = {};
  let current = null;
  let section = null;
  let eventPhase = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const profileMatch = trimmed.match(/^([a-z_]+):\s*$/);
    if (profileMatch && !line.startsWith(" ")) {
      current = profileMatch[1];
      profiles[current] = { phases: [], swarm_minimums: {}, description: "" };
      section = null;
      eventPhase = null;
      continue;
    }

    if (!current) continue;

    if (trimmed === "phases:") {
      section = "phases";
      continue;
    }
    if (trimmed === "expected_events:") {
      section = "events";
      continue;
    }
    if (trimmed === "swarm_minimums:") {
      section = "swarm_minimums";
      continue;
    }
    if (trimmed.startsWith("description:")) {
      profiles[current].description = trimmed.slice("description:".length).trim();
      section = null;
      continue;
    }

    const listItem = trimmed.match(/^- (.+)$/);
    if (listItem && section === "phases") {
      profiles[current].phases.push(listItem[1]);
      continue;
    }

    const phaseKey = trimmed.match(/^([a-z_]+):\s*$/);
    if (phaseKey && section === "events") {
      eventPhase = phaseKey[1];
      profiles[current].expected_events = profiles[current].expected_events ?? {};
      profiles[current].expected_events[eventPhase] = [];
      continue;
    }

    if (listItem && section === "events" && eventPhase) {
      profiles[current].expected_events[eventPhase].push(listItem[1]);
      continue;
    }

    const swarmEntry = trimmed.match(/^([a-z_]+):\s*(\d+)$/);
    if (swarmEntry && section === "swarm_minimums") {
      profiles[current].swarm_minimums[swarmEntry[1]] = Number(swarmEntry[2]);
    }
  }

  return profiles;
}

export function swarmCountForPhase(log, phase) {
  const entries = (log ?? []).filter((e) => e.phase === phase);
  const launches = entries.filter(
    (e) => e.event === "agent_spawned" || e.event === "task_launch",
  );
  if (launches.length) {
    const last = launches[launches.length - 1];
    const match = String(last.detail ?? "").match(/count=(\d+)/);
    return match ? Number(match[1]) : launches.length;
  }
  const complete = entries.find((e) => e.event === "phase_complete");
  if (complete) {
    const swarmMatch = String(complete.detail ?? "").match(/swarm_count=(\d+)/);
    if (swarmMatch) return Number(swarmMatch[1]);
  }
  return 0;
}

export function formatTimeline(manifest, { minLevel = "debug" } = {}) {
  const lines = [];
  const logs = filterLogByLevel(manifest.log ?? [], minLevel);
  const decisions = manifest.decisions ?? [];

  const merged = [
    ...logs.map((e) => ({ ...e, kind: "log" })),
    ...decisions.map((e) => ({
      at: e.at,
      phase: e.phase,
      event: `decision:${e.decision}`,
      detail: e.reason,
      level: "info",
      kind: "decision",
      evidence: e.evidence,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  for (const entry of merged) {
    const level = entry.level ?? "info";
    const skill = entry.skill ? ` skill=${entry.skill}` : "";
    const evidence = entry.evidence ? ` evidence="${entry.evidence}"` : "";
    lines.push(
      `${entry.at} [${level}] ${entry.phase} :: ${entry.event}${skill} — ${entry.detail}${evidence}`,
    );
  }

  return lines.join("\n");
}

export function buildTrace(manifest) {
  const verb = manifest.verb ?? "unknown";
  const profiles = loadVerbDebugProfiles();
  const profile = profiles[verb] ?? null;
  const log = manifest.log ?? [];
  const decisions = manifest.decisions ?? [];
  const sections = [];

  sections.push(`# AAAC trace: ${manifest.run_id}`);
  sections.push(`Command: /${manifest.command}  Verb: ${verb}  Status: ${manifest.status}`);
  if (manifest.blocked_reason) sections.push(`Blocked: ${manifest.blocked_reason}`);
  sections.push("");

  sections.push("## Why did it do this?");
  for (const d of decisions) {
    sections.push(`- [${d.phase}] ${d.decision}: ${d.reason}`);
    if (d.evidence) sections.push(`  evidence: ${d.evidence}`);
  }
  if (!decisions.length) sections.push("- (no decisions recorded)");
  sections.push("");

  sections.push("## Which skill ran?");
  const skillEvents = log.filter((e) => e.skill || e.event === "skill_loaded");
  if (skillEvents.length) {
    for (const e of skillEvents) {
      sections.push(`- ${e.at} ${e.phase}: ${e.skill ?? e.detail}`);
    }
  } else {
    sections.push("- (no skill_loaded events — infer from phase transitions)");
    for (const e of log.filter((x) => x.event === "phase_start")) {
      sections.push(`- phase ${e.phase} started`);
    }
  }
  sections.push("");

  sections.push("## Why was a route chosen?");
  const routing = decisions.filter((d) =>
    /route|orchestrator|capability|graph|dispatch/i.test(`${d.decision} ${d.reason}`),
  );
  if (routing.length) {
    for (const d of routing) sections.push(`- ${d.decision}: ${d.reason}`);
  } else if (manifest.orchestrator) {
    sections.push(`- orchestrator: ${manifest.orchestrator}`);
  } else {
    sections.push("- (see decisions and command registry entry)");
  }
  sections.push("");

  sections.push("## Why is the run blocked?");
  if (manifest.status === "blocked" || manifest.awaiting_approval) {
    sections.push(`- status=${manifest.status} awaiting_approval=${manifest.awaiting_approval}`);
    sections.push(`- ${manifest.blocked_reason ?? "gate or swarm incomplete"}`);
    for (const e of log.filter((x) => x.event === "edit_denied" || x.event === "gate_fail").slice(-5)) {
      sections.push(`- ${e.at} ${e.event}: ${e.detail}`);
    }
  } else if (manifest.status === "running") {
    sections.push(`- Not blocked. Current phase: ${manifest.phase}`);
    const minAgents = profile?.swarm_minimums?.[manifest.phase];
    if (minAgents) {
      const count = manifest.swarm?.task_launches_this_phase ?? swarmCountForPhase(log, manifest.phase);
      sections.push(`- Swarm: ${count}/${minAgents} agents this phase`);
    }
  } else {
    sections.push(`- Run ${manifest.status}`);
  }
  sections.push("");

  if (profile) {
    sections.push(`## Verb profile (${verb})`);
    if (profile.description) sections.push(profile.description);
    sections.push(`Highlight phases: ${(profile.phases ?? []).join(" → ")}`);
    for (const [phase, min] of Object.entries(profile.swarm_minimums ?? {})) {
      const actual = swarmCountForPhase(log, phase);
      sections.push(`- ${phase}: swarm ${actual}/${min} (${actual >= min ? "ok" : "INCOMPLETE"})`);
    }
  }

  sections.push("");
  sections.push("## Chronological timeline");
  sections.push(formatTimeline(manifest));

  return sections.join("\n");
}

export function debugRunSummary(manifest) {
  const log = manifest.log ?? [];
  const phase = manifest.phase;
  const swarmPhase = manifest.swarm?.phase ?? phase;
  const swarmCount =
    manifest.swarm?.task_launches_this_phase ?? swarmCountForPhase(log, swarmPhase);

  return {
    run_id: manifest.run_id,
    command: manifest.command,
    verb: manifest.verb,
    status: manifest.status,
    phase,
    phase_kind: manifest.phase_kind,
    blocked_reason: manifest.blocked_reason,
    awaiting_approval: manifest.awaiting_approval,
    completed: manifest.completed ?? [],
    pending: manifest.pending ?? [],
    swarm: { phase: swarmPhase, task_launches_this_phase: swarmCount },
    edit_allowed: manifest.enforcement?.edit_allowed ?? false,
    last_log_entries: log.slice(-10),
    decisions_count: (manifest.decisions ?? []).length,
    log_count: log.length,
  };
}
