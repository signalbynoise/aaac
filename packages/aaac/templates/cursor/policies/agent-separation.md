# Agent separation (mandatory)

**SSOT:** [.cursor/aaac/enforcement.json](../aaac/enforcement.json) `agent_separation`

## Rule

The **parent orchestrator must never perform assessment, scoring, validation, investigation conclusions, planning decisions, verification, or review** in its own context.

Parent may only:

- Dispatch parallel `Task` subagents
- Merge subagent structured outputs into Run artifacts
- Advance phases via `advance-phase.mjs`
- Communicate with the user
- **Never** write production/source code — delegate to `code-author` Task in `execute`

## Hard enforcement

1. **`advance-phase.mjs`** — blocks phase completion until `swarm_min_agents` Task launches are recorded for that phase.
2. **`gate-write.mjs`** — denies writes to phase decision artifacts until the swarm minimum is met.
3. **Hooks** — `subagentStart` counts Task launches per phase.

## Swarm phases (all commands)

Every phase that produces a decision artifact requires independent Task subagents — see `swarm_min_agents` in enforcement.json.

| Phase | Min agents | Parent role |
|-------|------------|-------------|
| discover | 4 | Merge brief |
| investigate_lite | 3 | Merge investigation |
| plan | 2 | Merge plan.yaml |
| validate … rollback | 2–3 each | Merge gate artifacts |
| root_cause | 2 | Merge root_cause.yaml |
| execute | 1 | Delegate code-author |
| test_execute | 1 | Delegate test author |
| verify | 3 | Merge verify.yaml |
| review_swarm | 3 | Merge review.yaml |
| report | 2 | Merge report.md |

## Violations

If the parent scores confidence, passes a gate, or writes a decision artifact without launching the required swarm → **contract violation**. Hooks deny the write; `advance-phase` exits non-zero.

## Orchestrator vs editor

The parent is **orchestrator only** for production code. `gate-write.mjs` blocks parent prod edits in `execute`/`debt_sweep`. Subagent writes are allowed when Cursor attributes `subagent_id` (registered on `subagentStart`).
