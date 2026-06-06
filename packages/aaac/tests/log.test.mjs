#!/usr/bin/env node
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLevel,
  shouldLog,
  recordLog,
  recordDecision,
  filterLogByLevel,
  swarmCountForPhase,
  debugRunSummary,
} from "../src/run-engine/log.mjs";

describe("log.mjs", () => {
  it("normalizeLevel defaults to info", () => {
    assert.equal(normalizeLevel(), "info");
    assert.equal(normalizeLevel("DEBUG"), "debug");
    assert.equal(normalizeLevel("bogus"), "info");
  });

  it("shouldLog respects LOG_LEVEL", () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    assert.equal(shouldLog("info"), false);
    assert.equal(shouldLog("warn"), true);
    assert.equal(shouldLog("error"), true);
    process.env.LOG_LEVEL = prev;
  });

  it("recordLog appends required telemetry fields", () => {
    const manifest = {
      run_id: "run_test",
      phase: "discover",
      phase_kind: "work",
      log: [],
    };
    const entry = recordLog(manifest, {
      event: "phase_start",
      detail: "test",
      level: "info",
    });
    assert.equal(manifest.log.length, 1);
    assert.equal(entry.run_id, "run_test");
    assert.equal(entry.phase, "discover");
    assert.equal(entry.event, "phase_start");
    assert.ok(entry.at);
  });

  it("recordDecision appends decision entry", () => {
    const manifest = { run_id: "run_test", phase: "dispatch", decisions: [] };
    recordDecision(manifest, {
      decision: "run_created",
      reason: "hook",
      evidence: "/fix-module",
    });
    assert.equal(manifest.decisions.length, 1);
    assert.equal(manifest.decisions[0].decision, "run_created");
  });

  it("filterLogByLevel filters by priority", () => {
    const entries = [
      { event: "a", level: "debug" },
      { event: "b", level: "info" },
      { event: "c", level: "error" },
    ];
    const filtered = filterLogByLevel(entries, "info");
    assert.deepEqual(filtered.map((e) => e.event), ["b", "c"]);
  });

  it("swarmCountForPhase reads agent_spawned and legacy task_launch", () => {
    const log = [
      { phase: "discover", event: "task_launch", detail: "count=3" },
      { phase: "discover", event: "agent_spawned", detail: "count=4" },
    ];
    assert.equal(swarmCountForPhase(log, "discover"), 4);
  });

  it("debugRunSummary includes last entries", () => {
    const manifest = {
      run_id: "run_x",
      command: "fix-module",
      verb: "fix",
      status: "running",
      phase: "discover",
      phase_kind: "work",
      log: [{ at: "t", phase: "discover", event: "phase_start", detail: "ok" }],
      decisions: [],
      completed: [],
      pending: ["investigate_swarm"],
      swarm: { phase: "discover", task_launches_this_phase: 2 },
    };
    const summary = debugRunSummary(manifest);
    assert.equal(summary.swarm.task_launches_this_phase, 2);
    assert.equal(summary.last_log_entries.length, 1);
  });
});
