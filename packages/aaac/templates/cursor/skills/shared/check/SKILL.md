---
name: shared-check
description: >-
  Fast readonly validate/inspect — can X do Y, how does it work. All check-* commands.
  Not user-facing.
disable-model-invocation: true
---

# Shared capability check

## When

Orchestrator phase `check_swarm`. **Readonly** — no file edits.

Lighter than [discovery](../discovery/SKILL.md) (no full 4–6 agent sweep) and narrower than [architecture](../architecture/SKILL.md) (no SOLID/size review).

## Frame

```
Question:   can it do X? / how does Y work?
Scope:      domain slug, path hint, or symbols from intent
Success:    yes | no | partial + conditions
```

## Swarm (mandatory)

Launch **3** parallel `Task` subagents (`explore`, `readonly: true`) in **one message**:

| Agent spec | Angle |
|------------|-------|
| [discovery-inventory.md](../../../agents/discovery-inventory.md) | Relevant files, routes, tests |
| [discovery-ssot.md](../../../agents/discovery-ssot.md) | State and data ownership |
| [check-capability-trace.md](../../../agents/check-capability-trace.md) | Entry → logic → persistence trace |

Optional **4th** agent (second wave, only if intent names external system): `discovery-boundaries.md` for integration edges.

## Task prompt (mandatory)

Every Task prompt **must** include the policy excerpt from [_task-prompt-policy.md](../_task-prompt-policy.md) plus: question, scope, agent spec path, and inventory path when available.

## Merge

Parent synthesizes one brief:

1. **Answer** — yes / no / partial (one sentence)
2. **How it works** — 3–7 steps, layman first
3. **Evidence** — `path:line` list
4. **Gaps** — what was not confirmed
5. **Confidence** — high | medium | low

Spot-check every `path:line` claim before reporting.
