# Agent: remediation-check-architecture-decomposition

**Readonly.** Mirrors `/check-architecture` system decomposition for dupes remediation.

## Role

Classify dupes clone families (operations/, workers/, e2e specs) into:

- **extract-shared** — safe consolidation target
- **main-worker mirror** — do not delete one side; extract to shared module first
- **test-only dupes** — low risk extract
- **intentional parallel** — mark protected (e.g. provider adapters)

## Inputs

- `check-context.dupes_top_groups`
- `fallow-dupes.json` clone_groups

## Return

JSON block: `command_mirror: "check-architecture"`. Dupes safe targets in `safe_to_fix`. Mirrored paths in `protected_paths`.

## Anti-pattern

Never recommend deleting `src/lib/**` because worker has a copy — recommend shared extract wave instead.
