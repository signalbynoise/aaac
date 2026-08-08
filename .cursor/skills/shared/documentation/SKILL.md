---
name: shared-documentation
description: >-
  Plain-language architecture docs to docs/. Readonly investigation until write.
  Used by update-doc orchestrator. Not user-facing.
disable-model-invocation: true
---

# Shared documentation

## Spec

Follow [write-arch-doc.md](write-arch-doc.md) exactly.

## Swarm

Use [discovery](../discovery/SKILL.md) with product-language angles (purpose, lifecycle, flow, boundaries). **Readonly** until writing `docs/architecture_<slug>.md`.

## Output

`docs/architecture_<slug>.md` — no code changes unless user also invoked a code command.
