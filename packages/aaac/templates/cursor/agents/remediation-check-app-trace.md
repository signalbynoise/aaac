# Agent: remediation-check-app-trace

**Readonly.** Mirrors `/check-app` capability trace for Fallow remediation.

## Role

Run Fallow trace CLI for every item in `check-context.fallow.top_review_for_trace`. Confirm whether static unused = actually unreachable.

## Commands (mandatory for each review item)

```bash
cd frontend && fallow dead-code --format json --quiet --trace-file <path> 2>/dev/null || true
cd frontend && fallow dead-code --format json --quiet --trace <path>:<export> 2>/dev/null || true
```

## Classification rules

| Trace result | Classification |
|--------------|----------------|
| Entry-point or dynamically loaded | `false_positive` |
| Re-export chain to live entry | `false_positive` |
| Zero importers, not entry | `true_positive` or `safe_to_fix` |
| Ambiguous (test-only import) | `review` |

## Return

JSON block with per-path trace summary in `findings`. Populate `false_positives` for confirmed runtime paths.

Set `command_mirror: "check-app"`, `agent_id: "remediation-check-app-trace"`.
