---
name: aaac-log-debug
description: Debug blocked or failed AAAC create/update/fix/check Runs using manifest log tools.
---

# AAAC Log Debug Agent

Use when a `/create-*`, `/update-*`, `/fix-*`, or `/check-*` Run is blocked, incomplete, or behaving unexpectedly.

## SSOT

- Run manifest: `.cursor/aaac/state/runs/{run_id}/run.json`
- Telemetry events: `.cursor/aaac/observability/telemetry.yaml`
- Verb profiles: `.cursor/aaac/observability/verb-debug.yaml`

All observability lives on the Run manifest — never create standalone markdown debug logs.

## Quick triage

1. Find the run id from the chat hook message or `.cursor/aaac/state/active-runs/{conversation_id}.json`.
2. One-shot status:

```bash
node .cursor/aaac/scripts/run-engine/debug-run.mjs <run_id>
```

3. Full timeline:

```bash
node .cursor/aaac/scripts/run-engine/log-dump.mjs <run_id> --format pretty
```

4. Answer "why did it do X?":

```bash
node .cursor/aaac/scripts/run-engine/log-trace.mjs <run_id>
```

Or via npm CLI when installed:

```bash
aaac debug-run <run_id>
aaac log-dump <run_id> --format timeline
```

## What to look for

| Symptom | Log events | Action |
|---------|------------|--------|
| Edits denied | `edit_denied` | Advance to `execute` phase first |
| Swarm blocked | `gate_fail` + `swarm_count` | Launch more Task subagents; check verb-debug swarm_minimums |
| Missing artifact | `gate_fail` + `missing artifact` | Write required file under `artifacts/` |
| Stuck at gate | `gate_blocked`, `awaiting_approval` | Complete gate skill; user approval if blocked |
| Wrong route | `decisions[]`, `graph_resolved` | Check orchestrator in registry |

## Verb-specific checks

- **create / update**: `discover` needs 4 agents; phases `investigate_lite` → `plan` → gates → `execute`.
- **fix**: `investigate_swarm` needs 7 agents; `verify` needs 3 (`verify_fix`); `root_cause` artifact required.
- **check** (readonly): `discover` needs 4 run-engine agents + 3 explore agents in `check_swarm`; no `execute` — `edit_denied` is expected for all code paths.

## Environment

Set `LOG_LEVEL=debug` when running run-engine scripts locally for stderr structured output:

```
[level] [run:phase:event] detail {"run_id":"..."}
```

## Report back

Summarize: run_id, phase, blocked_reason, swarm counts vs minimums, last 3 log events, and recommended next command (`advance-phase.mjs` or spawn agents).
