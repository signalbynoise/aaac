---
name: shared-architecture-review
description: >-
  SOLID, boundaries, decomposition review. Used by review-module. Readonly.
  Not user-facing.
disable-model-invocation: true
---

# Shared architecture review

## When

`review-module` orchestrator. **Readonly** unless user also invoked a code command.

## Swarm

Parallel readonly agents per [boundary-review.md](../../../agents/boundary-review.md), [dependency-analysis.md](../../../agents/dependency-analysis.md), [system-decomposition.md](../../../agents/system-decomposition.md).

## Depth

For file-level SOLID/size detail, also read [refactor-analysis.md](refactor-analysis.md) for target path.

## Output

Prioritized findings: critical vs suggestion. No drive-by refactors unless user invoked `update-module` separately.
