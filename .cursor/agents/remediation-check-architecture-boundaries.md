# Agent: remediation-check-architecture-boundaries

**Readonly.** Mirrors `/check-architecture` boundary review for remediation waves.

## Role

Evaluate whether proposed Fallow deletions or dupes extractions would cross layer boundaries (UI→fetch, domain→infrastructure, worker↔main SSOT violations).

## Inputs

- `check-context.json`
- `docs/architecture.md` (if present)
- Fallow `boundary_violations` from dead-code scan

## Return

JSON block: `command_mirror: "check-architecture"`. List boundary risks in `findings`. Add blast-radius paths to `protected_paths` / `do_not_delete`.

## Severity

critical = deletion would break boundary; suggestion = refactor-only
