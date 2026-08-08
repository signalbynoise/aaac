---
name: verb-release-orchestrator
description: Orchestrates release-* commands. Internal only.
disable-model-invocation: true
---

# release-* orchestrator

**Object** from graph. `release-app` → [platform-release](../../platform-release/orchestrator/SKILL.md) (full platform ship).

Read [_dispatch-utils.md](../_dispatch-utils.md) first.

## By object

| object | Behavior |
|--------|----------|
| app | platform-release orchestrator (Render, git, observability) |
| feature | Flag/experiment rollout checklist; PostHog when configured |
| integration | Integration smoke + env verification per [integration](../../integration/SKILL.md) |

## Phases (non-app)

1. **policies** — load `.cursor/policies/` including mcp-and-deploy
2. **object_skills** — from graph `object_skills.<object>`
3. [testing](../../testing/SKILL.md) + [verification](../../verification/SKILL.md)
4. [execution](../../execution/SKILL.md) only for deploy/config steps intent requests
5. [reporting](../../reporting/SKILL.md)

Valid release objects: `app`, `feature`, `integration`. Others rejected — see graph `invalid_pairs`.
