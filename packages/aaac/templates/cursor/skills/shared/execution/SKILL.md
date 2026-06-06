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

- Edit files per plan and implementation skill
- `apply_migration` for new/changed `supabase/migrations/` (project `hjadkzfemzuvhpwbixbt`)
- `track()` for user-facing mutations
- Structured logging on server async paths

## Must not

- Invent plan during execution
- Race guards or useEffect-driven mutations (implementation ban)
- Skip schema validation at boundaries

Git commit only when orchestrator/release phase explicitly requires it.
