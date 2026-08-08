---
name: shared-execution
description: >-
  Applies code changes for AAAC orchestrators. Must load governance/implementation.
  Migrations via Supabase MCP. Not user-facing.
disable-model-invocation: true
---

# Shared execution

## When

Orchestrator phase `execute` after approved plan.

**Hard rule:** Parent orchestrator must **not** edit production files. Launch **1** `Task` subagent in **one message**:

| Agent spec | `subagent_type` | Role |
|------------|-----------------|------|
| [code-author.md](../../../agents/code-author.md) | `generalPurpose` | Implement plan in prod/source |

Every Task prompt **must** include [_task-prompt-policy.md](../_task-prompt-policy.md) plus: Run `artifacts/plan.yaml` path, gate artifacts, domain inventory path.

Parent merges subagent return into Run `artifacts/execute_summary.yaml` (files changed, gaps). Hooks deny parent prod writes in `execute`.

## Mandatory

1. Read [governance/implementation/SKILL.md](../governance/implementation/SKILL.md)
2. Read domain [inventory](../../../domains/) constraints
3. Read [policies/](../../../policies/)

## Actions (code-author subagent only)

- Edit **production/source** files per plan and implementation skill
- **Do not** create or edit test files (`*.test.*`, `*.spec.*`, `__tests__/`) — deferred to `test_execute` / [test-authoring](../test-authoring/SKILL.md)
- `apply_migration` for new/changed `supabase/migrations/` (project `anseivwusnyiwopihnqu` — see [supabase-mcp.mdc](../../../rules/supabase-mcp.mdc))
- `track()` for user-facing mutations
- Structured logging on server async paths

## Must not

- Invent plan during execution
- Write or edit test files (hooks block in `execute`; use `test_execute`)
- Self-review implementation (use [implementation-review](../implementation-review/SKILL.md) in `review_swarm`)
- Race guards or useEffect-driven mutations (implementation ban)
- Skip schema validation at boundaries

Git commit only when orchestrator/release phase explicitly requires it.
