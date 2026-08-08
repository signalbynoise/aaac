---
name: verb-test-orchestrator
description: Orchestrates test-* except test-module resolver and test-function. Internal only.
disable-model-invocation: true
---

# test-* orchestrator

**Object** from graph. `test-module` → domain resolver. `test-function` → dedicated test-function orchestrator.

Read [_dispatch-utils.md](../_dispatch-utils.md) first.

## Phases

1. **policies** — load `.cursor/policies/`
2. **load_inventory** — when domain slug maps to inventory
3. [discovery](../../discovery/SKILL.md)
4. [planning](../../planning/SKILL.md) — which tests cover intent
5. **object_skills** — from graph `object_skills.<object>`
6. [testing](../../testing/SKILL.md); object `schema` → migration/type tests; `integration` → route tests
7. [verification](../../verification/SKILL.md)
8. [reporting](../../reporting/SKILL.md)

Fix failures only when intent requests it (then `execution` + governance/implementation).
