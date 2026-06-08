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

## Mandatory

1. Read [governance/implementation/SKILL.md](../governance/implementation/SKILL.md)
2. Read domain [inventory](../../../domains/) constraints
3. Read [policies/](../../../policies/)

## Actions

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
