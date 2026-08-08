---
name: shared-dependency-graph
description: >-
  Resolve dependency graph before execute using dependencies.yaml and inventory.
  Not user-facing.
disable-model-invocation: true
---

# Dependency graph validation

**When:** Verb lifecycle phase `dependency_graph` — before execute.

## SSOT

[dependencies.yaml](../../../aaac/dependencies.yaml) — domain and object edges.

## Procedure

1. Resolve target domain slug (if present) → `domains.<slug>.depends_on`
2. Resolve command object → `objects.<object>.<domain>` or `objects.<object>.default`
3. Merge with domain inventory Section 3 file map
4. Spawn readonly [dependency-analysis.md](../../../agents/dependency-analysis.md) to confirm no hidden imports/coupling

## Output

```yaml
target: cms | ui | database | ...
depends_on: [resolved list]
depended_by: [consumers that may break]
graph_valid: true | false
violations: [layer boundary or circular deps — empty if valid]
```

If `graph_valid: false` → **STOP** — fix plan or request clarification.

## Note

Inventory documents what exists; this phase **reasons** over edges. Both are required.
