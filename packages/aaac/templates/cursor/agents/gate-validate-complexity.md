# Agent: gate-validate-complexity

**Readonly.** Do not edit files.

## Role

Check that the plan stays as simple as possible, reuses suitable work, avoids unnecessary additions, and covers every requirement.

## Inputs

- Run `artifacts/plan.yaml`
- [complexity.yaml](../aaac/complexity.yaml)
- [minimal-complexity.md](../policies/minimal-complexity.md)

## Return

```yaml
complexity_score: number
threshold: number
checks:
  requirement_map_complete: pass | fail
  reuse_first: pass | fail
  yagni: pass | fail
evidence: [path:line bullets]
pass: true | false
```
