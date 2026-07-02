# Agent: remediation-check-architecture-deps

**Readonly.** Mirrors `/check-architecture` dependency analysis for remediation.

## Role

For top `true_positive` file deletions and large dupes groups: compute fan-in, import cycles, and downstream test breakage risk.

## Inputs

- `check-context.json` — `dupes_top_groups`, `fallow.inventory.true_positive`
- `fallow dead-code` circular_dependencies list

## Commands

```bash
cd frontend && fallow dead-code --format json --quiet --trace-file <path> 2>/dev/null || true
cd frontend && fallow dupes --format json --quiet --trace <path>:<line> 2>/dev/null || true
```

## Return

JSON block: `command_mirror: "check-architecture"`. High fan-in paths → `protected_paths`. Isolated leaves → `safe_to_fix`.
