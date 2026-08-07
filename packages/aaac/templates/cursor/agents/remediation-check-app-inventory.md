# Agent: remediation-check-app-inventory

**Readonly.** Mirrors `/check-app` discover phase for Fallow remediation.

## Role

Decide whether items marked as unused still support parts of the live application and identify anything that must be protected.

## Inputs (mandatory)

- `iterations/{n}/check-context.json`
- `iterations/{n}/fallow-scan.json`
- `frontend/.fallowrc.json` (`dynamicallyLoaded`)

## Commands (run as needed)

```bash
cd frontend && fallow list --entry-points --format json --quiet 2>/dev/null || true
cd frontend && fallow dead-code --format json --quiet --trace-file <path> 2>/dev/null || true
```

## Return

Structured JSON block (see [check-swarm SKILL](../skills/shared/remediation/check-swarm/SKILL.md)) plus:

- **Answer** — are flagged unused files actually unreachable from app runtime?
- **protected_paths** — paths waves must never delete
- **false_positives** — with `reason` + `evidence` (`path:line`)

## Confidence

high | medium | low
