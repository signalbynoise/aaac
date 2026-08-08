# Policy: Effective context budget

**SSOT:** [.cursor/aaac/context-budget.yaml](../aaac/context-budget.yaml)

**Applies to:** All AAAC orchestrators that launch Task subagents or carry multi-phase Run state in parent chat.

**Loaded with:** master-rules, implementation, mcp-and-deploy — before swarm phases.

## Problem

Advertised LLM context windows exceed **effective** usable context. Recent research on shallow long-context adaptation shows catastrophic reasoning degradation around **40–50%** of maximum context for some models — information may still be present but not used reliably.

AAAC mitigates load via parallel swarms and remediation compaction scripts, but without explicit budget governance the parent chat can still accumulate raw swarm output through gates.

## Operating ceiling

```text
Safe default  → treat ~40% of advertised context as the ceiling per agent turn
Conservative  → ~35% for fix investigate_swarm and large remediation check_swarm
```

Task complexity varies (MECW is task-dependent). Ratios in `context-budget.yaml` are **guardrails**, not guarantees.

## Mandatory behaviors

### 1. Artifact-first handoffs

After every swarm phase, the orchestrator **writes a compact checkpoint** to Run artifacts before advancing. Later phases read **paths only** — never re-paste full agent returns into the parent prompt.

| Phase | Checkpoint |
|-------|------------|
| discover (check) | `artifacts/discover_brief.yaml` |
| investigate_swarm (fix) | `artifacts/investigation.md` |
| check_swarm (remediation) | `check-swarm-raw.json` → merge output |

### 2. Scoped subagent prompts

Every Task prompt must include [_task-prompt-policy.md](../skills/shared/_task-prompt-policy.md) plus:

- Intent and scope only — not full prior-phase transcripts
- Path to compact context file when preflight exists
- Structured return shape — no prose dumps

Subagents should prefer **scoped reads** over whole-repo search.

### 3. Compaction before swarm

When Fallow scans, inventories, or prior gate outputs feed a swarm, run scripted preflight that caps lists per `context-budget.yaml` `compaction` (see `prepare-check-context.mjs` pattern).

### 4. Parent retention cap

When parent active context approaches `parent_retention_max` (25% default), stop ingesting raw swarm text. Write checkpoint, advance phase, continue from artifacts in a fresh turn if needed (remediation yield pattern).

## Relationship to other budgets

| Budget | SSOT | Domain |
|--------|------|--------|
| Code module size | `docs/master_rules.md` §19 | Lines per file/function |
| Plan complexity | `complexity.yaml` | Net-new artifacts in create/update/fix |
| **Effective context** | `context-budget.yaml` | LLM prompt and handoff size |

These are separate dimensions. A change can satisfy code size budgets while violating context budget.

## Implementation status

| Mechanism | Status |
|-----------|--------|
| `context-budget.yaml` + this policy | **Active** (governance SSOT) |
| `context-budget.mjs` + `prepare-phase-context.mjs` | **Active** (run-engine scripts) |
| `advance-phase.mjs` discover artifact gate | **Active** (check verb) |
| `merge-check-swarm.mjs` findings caps | **Active** |
| Run schema telemetry fields | **Active** (`run.json` context + swarm) |

## Prime directive alignment

Clarity beats cleverness: compact artifacts beat long chat transcripts. One truth beats convenience: Run artifacts are the handoff SSOT, not parent memory.
