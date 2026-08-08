---
name: shared-run
description: >-
  Create, update, and resume AAAC Runs. All execution state and observability
  lives on the Run manifest. Not user-facing.
disable-model-invocation: true
---

# Run management

**SSOT:** [run/schema.json](../../../aaac/run/schema.json), [run/RUN.md](../../../aaac/run/RUN.md)

Every AAAC command executes within a Run. No standalone execution-state or markdown logs.

## Create Run

At dispatch step 2.5:

1. `run_id` = `run_{YYYYMMDD}_{slug}` from command + object/domain
2. Load `verb_runtime.<verb>` from graph → initial `pending`
3. Write `state/runs/{run_id}/run.json`
4. Set `status: running`, first phase, `phase_kind` from phases.json (`gate: true` → gate)

## Update after each phase

1. Append `log[]` entry (`phase_start` / `phase_complete` / `gate_pass` / `gate_fail`)
2. Move phase from `pending` to `completed`
3. Write `checkpoints/{phase}.json`
4. Store phase outputs in `artifacts/` and reference in `artifacts{}`
5. Append routing choices to `decisions[]`
6. Update `phase`, `updated_at`; persist manifest

## Gate failure → human approval

```yaml
status: blocked
awaiting_approval: true
blocked_reason: "<specific reason>"
phase_kind: gate
```

STOP. On user approval: log decision, clear `awaiting_approval`, set `status: running`, retry gate.

## Capability resolution (record on Run)

When resolving object capabilities:

```yaml
capabilities_resolved:
  layer-boundaries:
    providers:
      - id: architecture
        type: skill
```

Include MCP providers (`type: mcp`) in decisions even though graph skills exclude them.

## Resume

Read `state/runs/{run_id}/run.json`. Continue from `phase` when `status` is `running` or user approved `blocked`.

## Complete

After `report`: set `status: completed`, write `artifacts.report`.
