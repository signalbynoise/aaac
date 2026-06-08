---
name: shared-discovery
description: >-
  Readonly discovery swarm for AAAC orchestrators. Spawns parallel subagents
  per .cursor/agents/discovery-*.md. Use only via graph — not user-facing.
disable-model-invocation: true
---

# Shared discovery

## When

Orchestrator phase `discovery_swarm`. **Readonly** — no file edits.

## Swarm (mandatory)

Launch **4–6** parallel `Task` subagents (`explore`, `readonly: true`) in **one message**:

| Agent spec | Angle |
|------------|-------|
| [discovery-inventory.md](../../../agents/discovery-inventory.md) | Files, routes, tests |
| [discovery-boundaries.md](../../../agents/discovery-boundaries.md) | In/out of scope |
| [discovery-ssot.md](../../../agents/discovery-ssot.md) | State ownership |

Add domain-specific angles from inventory skill. Max **8** agents total; second wave ≤2 for critical gaps.

## Task prompt (mandatory)

Every Task prompt **must** include the policy excerpt from [_task-prompt-policy.md](../_task-prompt-policy.md) plus: intent, domain, inventory constraints, and the linked agent spec path.

## Output

Merged brief for `planning`: findings, evidence, gaps, confidence. Parent spot-checks `path:line` claims.
