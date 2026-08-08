---
name: review-incident-orchestrator
description: >-
  Orchestrates review-incident. Investigate; fix only when intent requests it.
disable-model-invocation: true
---

# review-incident orchestrator

## Parse

- **Intent:** primary (quoted or full `$ARGUMENTS`)
- **Domain:** optional
- Internal only: `--fix`, `--pr`, `--ci` if present in args

## Phases

1. **discover** (optional, 2 agents max) when domain unknown
2. [investigation](../SKILL.md) **Mode B** — **4 parallel** agents in one message (repro, code-path, runtime, recent-changes)
3. [reporting](../../reporting/SKILL.md) — layman first; set Run `status: completed` unless fix path active

## Fix escalation

If intent includes `--fix`, explicit "fix this", or user approves after report:

1. Switch command workflow to `fix-module` / `fix-bug` lifecycle on same Run
2. Run investigation **Mode A** (full 7-agent swarm) if not already done
3. Continue: root_cause → plan → gates → execute → verify (fix verify swarm) → report

Do not execute code changes on incident path without explicit fix request or approval.
