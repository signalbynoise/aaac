---
name: verb-check-orchestrator
description: Orchestrates all check-* commands. Internal only.
disable-model-invocation: true
---

# check-* orchestrator

**Readonly.** **Object** from graph. Domain optional for `check-function`.

Read [_dispatch-utils.md](../_dispatch-utils.md) first.

## Phases

1. **policies** — load `.cursor/policies/`
2. **scope** — restate question; narrow via domain slug, inventory, intent
3. **load_inventory** — when domain slug maps to inventory
4. **object_skills** — from graph `object_skills.<object>`
5. [check](../../check/SKILL.md) — swarm per check skill
6. **contract_checks** — `pnpm --filter @ludecker/aaac test` and `pnpm --filter @ludecker/aaac test:e2e` (includes `check-verb.check.spec.ts`); launch [playwright-check-run](../../../agents/playwright-check-run.md) at report phase
7. [reporting](../../reporting/SKILL.md) — **Answer** (yes/no/partial) then **How**

No code changes. For test runs use `test-*`; for fixes use `fix-*`.

Debug blocked runs: [aaac-log-debug](../../../agents/aaac-log-debug.md) — `debug-run`, `log-dump`, `log-trace`.
