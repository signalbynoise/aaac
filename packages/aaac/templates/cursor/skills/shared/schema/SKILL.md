---
name: shared-schema
description: >-
  Data models, migrations, RLS. Used when object is schema. Not user-facing.
disable-model-invocation: true
---

# Shared schema

## Scope

- `supabase/migrations/`, shared Zod/TS types, RLS policies
- SSOT: schema lives in migrations + shared types — never duplicate columns in app state

## Execution focus

- New migration file per change; apply via Supabase MCP (`hjadkzfemzuvhpwbixbt`)
- Backward-compatible defaults; document breaking changes in report
- RLS and security advisors after apply

## Check / test focus

- Migration order, nullable vs required, FK integrity
- Types consumed by server and app match migration
