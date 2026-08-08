---
name: shared-migration
description: >-
  Schema migration files. Object migration (data layer). Not user-facing.
disable-model-invocation: true
---

# Shared migration

## Scope

- `supabase/migrations/` only for DB shape changes
- One concern per migration; apply via Supabase MCP

## Execution focus

- See [schema](schema/SKILL.md) for RLS and type sync
- Backward-compatible defaults; document breaking changes

## Must not

- Edit applied production migrations in place — add new migration
