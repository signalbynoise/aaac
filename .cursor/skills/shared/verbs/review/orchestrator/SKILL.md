---
name: verb-review-orchestrator
description: Orchestrates review-* except review-module and review-incident. Internal only.
disable-model-invocation: true
---

# review-* orchestrator

**Readonly.** **Object** from graph.

Read [_dispatch-utils.md](../_dispatch-utils.md) first.

`review-module` → architecture orchestrator. `review-incident` → investigation orchestrator.

## Phases

1. **policies** — load `.cursor/policies/`
2. **load_inventory** — when domain slug maps to inventory
3. [discovery](../../discovery/SKILL.md) — focused scope
4. **object_skills** — from graph `object_skills.<object>` + `object_skill_verbs.<object>.review`
5. [architecture](../../architecture/SKILL.md) when object is `module`, `component`, `app`, or `architecture`
6. [reporting](../../reporting/SKILL.md) — findings prioritized critical vs suggestion

No code changes.
