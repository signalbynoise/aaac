---
name: shared-rollback
description: >-
  Rollback plan before execute — files, migrations, deploy. Required for protected
  maturity and high blast_radius. Not user-facing.
disable-model-invocation: true
---

# Rollback planning

**When:** Verb lifecycle phase `rollback` — before execute.

## Question

```text
If this fails, how do we undo it?
```

## Required when

- Object maturity **protected** (schema, migration, architecture)
- `impact_analysis.blast_radius: high`
- Database, auth, API, or deployment touch in plan

## Output (mandatory)

```yaml
rollback:
  files:
    - path/to/revert or "git checkout -- <paths>"
  migrations:
    - reverse_sql: "description or down migration path"
    - note: "apply via Supabase MCP only with user confirm"
  deployments:
    - previous_release: "revert commit sha or Render rollback procedure"
  data:
    - backup_needed: true | false
    - notes: optional
verified: true | false
```

If rollback cannot be defined for a protected change → **STOP, REQUEST CLARIFICATION**.

## Execute phase

Execution skill references this plan; does not invent rollback during execute.
