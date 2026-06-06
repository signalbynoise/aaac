---
name: shared-fitness-functions
description: >-
  Score architecture fitness functions before execute; re-check in verify.
  Includes minimal_complexity for create/update/fix. Not user-facing.
disable-model-invocation: true
---

# Architecture fitness functions

**When:** Verb lifecycle phase `fitness_functions` — before execute.

## SSOT

[fitness-functions.yaml](../../../aaac/fitness-functions.yaml)  
Complexity config: [complexity.yaml](../../../aaac/complexity.yaml)

## Procedure

1. Filter `functions` where command `object` ∈ `applies_to`
2. For **create / update / fix**, always score `minimal_complexity` (see `applies_to_verbs`)
3. Load linked skill or policy per function
4. Score each: `pass` | `warning` | `fail` against planned changes in Run `artifacts.plan`

## minimal_complexity (mutating verbs)

Policy: [minimal-complexity.md](../../../policies/minimal-complexity.md)

| Check | fail |
|-------|------|
| `complexity_score` ≤ verb threshold | score above threshold |
| Reuse-first documented | create without `why_not_reuse` |
| YAGNI | speculative architecture in plan |
| fix minimalism | fix plan score > 5 or large create list |

**Blocking** — same as `security` and `layer_boundaries`.

## Output

```yaml
score:
  api_first: pass | warning | fail
  design_system: pass | warning | fail
  accessibility: pass | warning | fail
  security: pass | warning | fail
  layer_boundaries: pass | warning | fail
  performance: pass | warning | fail
  minimal_complexity: pass | warning | fail
blocking_failures: [function names — empty if none]
```

Store on Run `artifacts.fitness` and `gates.results.fitness_functions`.

## Gates

- Any **fail** on `security`, `layer_boundaries`, or **`minimal_complexity`** → **STOP** before execute
- **warning** → document in report; may proceed if validation passed
- Re-run abbreviated score in [verification](../verification/SKILL.md) after execute
