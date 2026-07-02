---
name: remediate-check-swarm
description: >-
  Remediation check_swarm — mirrors /check-app and /check-architecture before
  Fallow-driven fix waves. Readonly. Prevents false-positive deletions.
disable-model-invocation: true
---

# Remediation check_swarm

**Readonly.** Runs after `fallow-scan.mjs` + `classify-fallow-issues.mjs`. **No code edits** in this phase.

Mirrors two AAAC check commands with Fallow-scoped intent:

| Mirror | Question | Object skills (graph) |
|--------|----------|------------------------|
| `/check-app` | Which Fallow dead-code/dupes hits are **live app surface** (workers, barrels, lazy routes, payment providers)? | `architecture`, `integration` |
| `/check-architecture` | Which proposed deletions/dedup extractions would **break boundaries, SSOT, or runtime graphs**? | `architecture`, `documentation` |

## Preflight (parent — mandatory)

```bash
node .cursor/aaac/scripts/remediation/prepare-check-context.mjs \
  --campaign-id <id> --iteration <n> [--run-id <run_id>]
```

Read `iterations/{n}/check-context.json` — SSOT input for every agent.

## Swarm (mandatory — **7 parallel Task agents**, one message)

Each agent: `subagent_type: explore`, `readonly: true`. Prompt **must** include policy from [_task-prompt-policy.md](../../_task-prompt-policy.md), `check-context.json` path, and agent spec path.

### Wave A — check-app mirror (3 agents)

| # | Agent spec | Base agent | Focus |
|---|------------|------------|-------|
| 1 | [remediation-check-app-inventory.md](../../../../agents/remediation-check-app-inventory.md) | discovery-inventory | Entry points, workers, dynamic imports, overlay barrels vs Fallow `unused_files` |
| 2 | [remediation-check-app-ssot.md](../../../../agents/remediation-check-app-ssot.md) | discovery-ssot | Ownership: who consumes each `review`/`true_positive` symbol; runtime vs static |
| 3 | [remediation-check-app-trace.md](../../../../agents/remediation-check-app-trace.md) | check-capability-trace | `fallow dead-code --trace-file` / `--trace` for top `review` items in context |

### Wave B — check-architecture mirror (3 agents)

| # | Agent spec | Base agent | Focus |
|---|------------|------------|-------|
| 4 | [remediation-check-architecture-boundaries.md](../../../../agents/remediation-check-architecture-boundaries.md) | boundary-review | Layer violations, cross-module coupling on delete candidates |
| 5 | [remediation-check-architecture-deps.md](../../../../agents/remediation-check-architecture-deps.md) | dependency-analysis | Import cycles, fan-in, blast radius of file/export removal |
| 6 | [remediation-check-architecture-decomposition.md](../../../../agents/remediation-check-architecture-decomposition.md) | system-decomposition | Dupes families (operations/, workers/ mirrors); safe extract vs delete |

### Wave C — remediation guard (1 agent)

| # | Agent spec | Focus |
|---|------------|-------|
| 7 | [remediation-check-risk.md](../../../../agents/remediation-check-risk.md) | Confirm FP traps; **must** output `false_positives[]` for `merge-check-swarm.mjs` |

**Dispatch planner** is parent synthesis (not a Task agent) after merge.

## Agent return shape (mandatory JSON block in final message)

```json
{
  "agent_id": "remediation-check-app-inventory",
  "command_mirror": "check-app",
  "answer": "yes | no | partial",
  "confidence": "high | medium | low",
  "false_positives": [
    { "path": "src/hooks/useCryptoPriceWorker.ts", "export_name": null, "reason": "worker_hook_runtime", "evidence": "path:line" }
  ],
  "protected_paths": ["src/overlays/renderers/line/index.ts"],
  "do_not_delete": [{ "path": "...", "reason": "..." }],
  "safe_to_fix": [{ "path": "...", "category": "unused_export", "evidence": "path:line" }],
  "findings": ["bullet"],
  "gaps": ["what was not confirmed"]
}
```

## Post-swarm merge (parent — mandatory)

1. Collect all 7 JSON blocks into `iterations/{n}/check-swarm-raw.json`
2. Run merge:

```bash
node .cursor/aaac/scripts/remediation/merge-check-swarm.mjs \
  --campaign-id <id> --iteration <n> [--run-id <run_id>]
```

3. Re-read `iterations/{n}/fallow-classification.json` (merge re-runs classifier)

## Parent artifacts (run + campaign)

| Artifact | Mirrors |
|----------|---------|
| `artifacts/check_app_validate.yaml` | `/check-app` validate phase |
| `artifacts/check_architecture_fitness.yaml` | `/check-architecture` fitness phase |
| `artifacts/check_synthesis.md` | Combined Answer + How + guardrails |
| `artifacts/dispatch-queue.yaml` | Ranked waves — **must** include `protected_paths` |
| `artifacts/protected_paths.yaml` | Paths/regions waves must not delete |
| `iterations/{n}/check-swarm-merge.json` | Merged FP registry + actionable list |

## Dispatch guardrails (mandatory in every wave intent)

Every wave in `dispatch-queue.yaml` **must**:

1. Copy `protected_paths` from merge output verbatim into `exclude:` block
2. Never target paths classified `false_positive` in `fallow-false-positives.json`
3. Prefer `fix-module` export trim over file delete when classification is `review`
4. Run `fallow dead-code --trace-file` before any `remove-module` / file delete wave

## Anti-patterns (forbidden)

- Skipping check-app or check-architecture mirrors (all 7 agents required)
- Deleting files from Fallow `unused_files` without trace-file evidence
- Bulk `fallow fix --yes` without swarm FP review
- Planning waves from raw Fallow totals (use `actionable_total` + merge output)
- Ignoring dupes **main/worker mirror** families — extract shared, do not delete one side
