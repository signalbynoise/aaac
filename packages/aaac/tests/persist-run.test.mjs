import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildRunRow,
  buildEventRows,
  buildDecisionRows,
  buildPhaseRows,
  buildCapabilityRows,
  buildArtifactRows,
  getSupabasePersistConfig,
  isRunPersistEnabled,
  buildPostgrestHeaders,
  syncRunToSupabase,
  MAX_INLINE_ARTIFACT_BYTES,
} from "../../.cursor/aaac/scripts/run-engine/persist-run.mjs";
import { nextRunId, seedRun, writeArtifact, cleanupRun } from "./fixtures/run-state.mjs";

describe("persist-run", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.AAAC_PERSIST_RUNS;
  });

  afterEach(() => {
    process.env = envBackup;
    vi.unstubAllGlobals();
  });

  it("is disabled when AAAC_PERSIST_RUNS=0", () => {
    process.env.AAAC_PERSIST_RUNS = "0";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
    expect(isRunPersistEnabled()).toBe(false);
  });

  it("is enabled when URL and service role key are set", () => {
    delete process.env.AAAC_PERSIST_RUNS;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
    expect(getSupabasePersistConfig()).toEqual({
      url: "https://example.supabase.co",
      key: "secret",
    });
  });

  it("buildRunRow includes full manifest jsonb", () => {
    const manifest = {
      run_id: "run_test_1",
      command: "check-app",
      status: "completed",
      created_at: "2026-06-26T00:00:00.000Z",
      updated_at: "2026-06-26T01:00:00.000Z",
      log: [],
      decisions: [],
    };
    const row = buildRunRow(manifest, "/repo");
    expect(row.run_id).toBe("run_test_1");
    expect(row.workspace_root).toBe("/repo");
    expect(row.manifest).toEqual(manifest);
  });

  it("buildEventRows assigns event_seq from log order", () => {
    const manifest = {
      run_id: "run_test_2",
      log: [
        { at: "2026-06-26T00:00:01.000Z", event: "phase_start", phase: "discover" },
        { at: "2026-06-26T00:00:02.000Z", event: "phase_complete", phase: "discover" },
      ],
    };
    const rows = buildEventRows(manifest);
    expect(rows).toHaveLength(2);
    expect(rows[0].event_seq).toBe(0);
    expect(rows[1].event_seq).toBe(1);
    expect(rows[0].event).toBe("phase_start");
  });

  it("buildDecisionRows maps decisions with decision_seq", () => {
    const manifest = {
      run_id: "run_test_3",
      decisions: [
        {
          at: "2026-06-26T00:00:00.000Z",
          phase: "dispatch",
          decision: "run_created",
          reason: "hook",
          evidence: "x",
        },
      ],
    };
    const rows = buildDecisionRows(manifest);
    expect(rows[0].decision_seq).toBe(0);
    expect(rows[0].decision).toBe("run_created");
  });

  it("buildPhaseRows reads context.phases telemetry", () => {
    const manifest = {
      run_id: "run_test_4",
      context: {
        phases: {
          discover: { artifact_bytes: 1200, compaction_applied: false },
        },
      },
    };
    const rows = buildPhaseRows(manifest);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("discover");
    expect(rows[0].artifact_bytes).toBe(1200);
  });

  it("buildCapabilityRows merges resolved and evidence outcomes", () => {
    const manifest = {
      run_id: "run_test_5",
      capabilities_resolved: {
        "layer-boundaries": { providers: [{ id: "architecture" }] },
      },
      capability_evidence_outcomes: [
        { capability_id: "layer-boundaries", previous_state: "trusted", new_state: "trusted" },
      ],
    };
    const rows = buildCapabilityRows(manifest);
    expect(rows).toHaveLength(1);
    expect(rows[0].capability_id).toBe("layer-boundaries");
    expect(rows[0].evidence_outcome.new_state).toBe("trusted");
  });

  it("buildArtifactRows inlines small artifact bodies", () => {
    const runId = nextRunId("artifacts");
    seedRun({
      run_id: runId,
      command: "check-app",
      status: "running",
      phase: "discover",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    writeArtifact(runId, "artifacts/report.md", "# hello\n");
    const rows = buildArtifactRows(runId);
    expect(rows.some((r) => r.rel_path === "artifacts/report.md" && r.body === "# hello\n")).toBe(
      true,
    );
    cleanupRun(runId);
  });

  it("buildArtifactRows omits body when artifact exceeds inline cap", () => {
    const runId = nextRunId("large");
    seedRun({
      run_id: runId,
      command: "check-app",
      status: "running",
      phase: "discover",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const big = "x".repeat(MAX_INLINE_ARTIFACT_BYTES + 1);
    writeArtifact(runId, "artifacts/big.txt", big);
    const rows = buildArtifactRows(runId);
    const row = rows.find((r) => r.rel_path === "artifacts/big.txt");
    expect(row.body).toBeNull();
    expect(row.byte_size).toBeGreaterThan(MAX_INLINE_ARTIFACT_BYTES);
    cleanupRun(runId);
  });

  it("buildPostgrestHeaders omits Bearer for sb_secret keys", () => {
    const config = { url: "https://example.supabase.co", key: "sb_secret_test" };
    const headers = buildPostgrestHeaders(config);
    expect(headers.apikey).toBe("sb_secret_test");
    expect(headers.Authorization).toBeUndefined();
  });

  it("buildPostgrestHeaders includes Bearer for legacy JWT keys", () => {
    const config = { url: "https://example.supabase.co", key: "eyJhbG.test" };
    const headers = buildPostgrestHeaders(config);
    expect(headers.Authorization).toBe("Bearer eyJhbG.test");
  });

  it("syncRunToSupabase skips when persist disabled", async () => {
    process.env.AAAC_PERSIST_RUNS = "0";
    const result = await syncRunToSupabase("run_missing");
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("persist_disabled");
  });

  it("syncRunToSupabase posts run and child rows", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      if (init.method === "DELETE") {
        return { ok: true, text: async () => "" };
      }
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const runId = nextRunId("sync");
    const manifest = {
      run_id: runId,
      command: "check-app",
      verb: "check",
      status: "completed",
      phase: "report",
      created_at: "2026-06-26T00:00:00.000Z",
      updated_at: "2026-06-26T01:00:00.000Z",
      log: [{ at: "2026-06-26T00:00:01.000Z", event: "run_completed", phase: "report" }],
      decisions: [],
    };
    seedRun(manifest);
    writeArtifact(runId, "artifacts/report.md", "done");

    const config = { url: "https://example.supabase.co", key: "test-key" };
    const result = await syncRunToSupabase(runId, { manifest, config });
    expect(result.ok).toBe(true);
    expect(result.events).toBe(1);
    expect(result.artifacts).toBe(1);

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
    expect(postCalls.some(([url]) => String(url).includes("/aaac_runs"))).toBe(true);
    expect(postCalls.some(([url]) => String(url).includes("/aaac_run_events"))).toBe(true);

    cleanupRun(runId);
  });
});
