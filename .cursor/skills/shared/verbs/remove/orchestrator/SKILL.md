---
name: verb-remove-orchestrator
description: Orchestrates all remove-* commands. Internal only.
disable-model-invocation: true
---

# remove-* orchestrator

**Object** from graph.

Read [_dispatch-utils.md](../_dispatch-utils.md) first.

## Phases

1. **policies** — load `.cursor/policies/`
2. **load_inventory** — when domain slug maps to inventory
3. [discovery](../../discovery/SKILL.md) — blast radius, dependents
4. **object_skills** — from graph `object_skills.<object>`
5. [remove](../../remove/SKILL.md) — confirm scope in report before edits
6. [execution](../../execution/SKILL.md) — deletions and doc/inventory updates
7. [testing](../../testing/SKILL.md) + [verification](../../verification/SKILL.md)
8. **sync_inventory** — when domain inventory exists
9. [reporting](../../reporting/SKILL.md)

`remove-app`: require intent to name explicit retirement scope; never delete auth/deploy SSOT without user confirmation.
