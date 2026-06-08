---
name: shared-testing
description: >-
  Runs vitest, Fallow check_changed, and fix repro verification swarm.
  Software pass/fail — not goal verification. Not user-facing.
disable-model-invocation: true
---

# Shared testing

## When

Phase `verify` (and `test_only` orchestrators). On **fix** paths, run fix verify swarm **before** declaring tests complete.

## Standard steps

1. Run tests from domain inventory relevant to change
2. Invoke [unit-test-run.md](../../../agents/unit-test-run.md) pattern for targeted vitest
3. Fallow MCP → `check_changed` on touched files when configured
4. `ReadLints` on edited paths
5. **Website build gate (mandatory on create / update / fix):** before advancing `verify`, run:
   ```bash
   node .cursor/aaac/scripts/run-engine/verify-website-build.mjs --run-id <run_id>
   ```
   This checks `index.html` static asset paths resolve under `apps/website/public/` (or project root for Vite dev) and runs `pnpm --filter @ludecker/website build`. `advance-phase.mjs verify` **blocks** until this passes and writes `artifacts/verify.yaml`.

## Fix verify swarm (mandatory on fix verb / fix_mode)

After unit tests, launch **3 parallel** `Task` subagents in **one message**. Each prompt **must** include [_task-prompt-policy.md](../_task-prompt-policy.md) and investigation artifact paths.

| # | Agent spec | `subagent_type` | Role |
|---|------------|-----------------|------|
| 1 | [fix-repro-verify.md](../../../agents/fix-repro-verify.md) | `shell` | Re-run repro steps from investigation artifact |
| 2 | [unit-test-run.md](../../../agents/unit-test-run.md) | `shell` | Targeted vitest for suspect area |
| 3 | [fallow-check-changed.md](../../../agents/fallow-check-changed.md) | `generalPurpose` | Static health on touched files |

Parent merges into Run `artifacts.testing`:

```yaml
repro_status: fixed | partial | not_fixed
tests: { pass, fail, names: [] }
fallow: pass | warn | fail
lints: clean | issues
```

If `repro_status: not_fixed` → verification must **fail** even when unit tests pass.

## Output

Pass/fail summary with test names, repro_status, and Fallow verdict for [verification](../verification/SKILL.md).
