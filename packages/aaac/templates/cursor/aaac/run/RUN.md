# Run — primary execution object

**Every AAAC command executes within a Run.** There is no standalone lifecycle execution or standalone logging.

Schema: [schema.json](schema.json)

## Create Run (dispatch step 2.5 — after graph resolve, before orchestrator)

1. Generate `run_id`: `run_{YYYYMMDD}_{short-slug}` or resume existing if user says `resume run_…`
2. Compose runtime phases from [lifecycle/lifecycle.json](../lifecycle/lifecycle.json) + [governance/gates.json](../governance/gates.json):
   - `pending` = work phases through `plan` + gate stack + work phases from `execute`
3. Write manifest: `state/runs/{run_id}/run.json`
4. Set `status: running`, `phase: first pending item`, `phase_kind: work`

## Update Run (after every phase)

1. Append to `log[]`
2. Move phase from `pending` to `completed`
3. Write checkpoint: `state/runs/{run_id}/checkpoints/{phase}.json`
4. Store artifacts under `state/runs/{run_id}/artifacts/` — reference paths in `artifacts{}`
5. Append routing/capability choices to `decisions[]`
6. Persist `run.json`

## Gate stack execution

After `plan` completes:

1. Set `phase_kind: gate`, `gates.stack` from lifecycle
2. Run each gate in [governance/gates.json](../governance/gates.json) order
3. On fail → `status: blocked`, `awaiting_approval: true`, `blocked_reason`, **STOP**
4. On pass → record in `gates.results`, continue to `execute`

## Human approval

When `awaiting_approval: true`:

```text
STOP — awaiting approval
Reason: {blocked_reason}
Run: {run_id}
```

User approves → log decision, set `status: running`, `awaiting_approval: false`, retry or continue.

## Observability

All observability lives on the Run:

| Field | Purpose |
|-------|---------|
| `decisions[]` | Why route/capability/gate |
| `log[]` | Phase and skill events |
| `checkpoints[]` | Resume points |

**No** append to standalone `decision-log.md` or `execution-log.md`.

## Capability resolution (record on Run)

When resolving `object_capabilities` → providers:

```yaml
capabilities_resolved:
  layer-boundaries:
    providers: [architecture]
    source: object module
```

MCP providers (type `mcp`) are recorded in decisions but do not map to graph skill keys.

## Report

Final phase writes `artifacts.report` and sets `status: completed`.
