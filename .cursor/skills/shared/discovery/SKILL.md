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

Read **`manifest.swarm.target_agents.discover`** (or current phase key) from the Run — do not hardcode agent counts. Floors and tiers live in `.cursor/aaac/swarm-sizing.yaml`; bootstrap scope score sets the initial target at Run start.

Launch **that many** parallel `Task` subagents (`explore`, `readonly: true`) in **one message** (split into waves when `manifest.swarm.wave_plan.discover` exists):

| Agent spec | Angle |
|------------|-------|
| [discovery-inventory.md](../../../agents/discovery-inventory.md) | Files, routes, tests |
| [discovery-boundaries.md](../../../agents/discovery-boundaries.md) | In/out of scope |
| [discovery-ssot.md](../../../agents/discovery-ssot.md) | State ownership |

Add domain-specific angles from inventory skill. Respect ceiling in swarm-sizing.yaml; second wave only when wave_plan requires it.

## discover_brief scope_signals (mandatory)

Each discovery agent must contribute to merged **`artifacts/discover_brief.yaml`** including a `scope_signals` block consumed by `compute-scope-complexity.mjs`:

```yaml
scope_signals:
  files_in_scope: <number>
  cross_domain: <true|false>
  migration_mentioned: <true|false>
  protected_object: <true|false>
  intent_ambiguity: low|medium|high
  open_questions: <count>
```

## Task prompt (mandatory)

Every Task prompt **must** include the policy excerpt from [_task-prompt-policy.md](../_task-prompt-policy.md) plus: intent, domain, inventory constraints, and the linked agent spec path.

## Output

Merged brief for `planning`: findings, evidence, gaps, confidence. Parent spot-checks `path:line` claims.
