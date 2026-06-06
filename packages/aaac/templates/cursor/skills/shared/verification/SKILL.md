---
name: shared-verification
description: >-
  Verifies AAAC intent met — contract success_criteria, inventory sync, behavior
  spot-check, fitness re-score. Distinct from testing (green CI). Not user-facing.
disable-model-invocation: true
---

# Shared verification

## When

After `testing`. Before `report`.

## Checks

- **Website build gate** (create / update / fix): `artifacts/verify.yaml` from [verify-website-build.mjs](../../../aaac/scripts/run-engine/verify-website-build.mjs) — static assets in `index.html` must exist; `pnpm --filter @ludecker/website build` must pass
- **Playwright verb checks** (create / update / fix): launch [playwright-check-run](../../../agents/playwright-check-run.md) — `pnpm --filter @ludecker/aaac test:e2e` must pass; set `PLAYWRIGHT_BASE_URL` for public-route smoke
- Run artifact `artifacts.testing.repro_status` is **fixed** or **partial** with documented follow-up (fix paths)
- Orchestrator `contract.yaml` `success_criteria`
- Graph `object_skills` / `object_skill_verbs` skills were loaded for command object + verb
- User instruction satisfied (spot-check 2–3 behaviors in code or tests)
- Domain constraints from inventory still hold
- `sync_inventory` completed when `execute` ran (inventory date + file table current)
- Out-of-scope areas untouched
- **Fitness re-check:** abbreviated [fitness-functions](../fitness-functions/SKILL.md) score on touched scope — no new `fail` on security or layer_boundaries
- Rollback plan from [rollback](../rollback/SKILL.md) still accurate if execute changed scope

## Fail

Stop and report gaps — do not claim success if tests pass but intent unmet.
