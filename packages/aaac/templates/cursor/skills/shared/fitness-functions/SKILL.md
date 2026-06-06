---
name: shared-fitness-functions
description: >-
  Score architecture fitness functions before execute; re-check in verify.
  Not user-facing.
disable-model-invocation: true
---

# Architecture fitness functions

**When:** Verb lifecycle phase `fitness_functions` — before execute.

## SSOT

[fitness-functions.yaml](../../../aaac/fitness-functions.yaml)

## Procedure

1. Filter `functions` where command `object` ∈ `applies_to`
2. Load linked skill per function (e.g. `ludecker-api-first`, `ludecker-design-system`)
3. Score each: `pass` | `warning` | `fail` against planned changes

## Output

```yaml
score:
  api_first: pass | warning | fail
  design_system: pass | warning | fail
  accessibility: pass | warning | fail
  security: pass | warning | fail
  layer_boundaries: pass | warning | fail
  performance: pass | warning | fail
blocking_failures: [function names — empty if none]
```

## Gates

- Any **fail** on `security` or `layer_boundaries` → **STOP** before execute
- **warning** → document in report; may proceed if validation passed
- Re-run abbreviated score in [verification](../verification/SKILL.md) after execute

Turns "read architecture.md" into enforceable checks.
