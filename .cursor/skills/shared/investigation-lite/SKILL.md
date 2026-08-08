---
name: shared-investigation-lite
description: >-
  Lightweight pre-change investigation for create and update. Answers what exists,
  what depends on it, and what constraints apply. Not user-facing.
disable-model-invocation: true
---

# Investigation (lite)

**When:** create and update verb lifecycle — **before** planning.

**Readonly.** Do not edit files.

## Three questions (mandatory)

1. **What exists?** — current files, routes, types, tests for target scope
2. **What depends on it?** — use [dependency-graph](../dependency-graph/SKILL.md) + domain inventory
3. **What constraints apply?** — inventory Section 2, policies, object maturity

## Output

```yaml
exists: [bullets with path evidence]
depends_on: [domains, modules, objects]
constraints: [from inventory and policies]
open_questions: [0–3; empty preferred]
confidence:
  architecture: 0.0–1.0
  requirements: 0.0–1.0
  scope: 0.0–1.0
```

Pass output to [validation](../validation/SKILL.md). If any confidence below threshold → **STOP, REQUEST CLARIFICATION**.

## Agents

Reuse readonly specs: [discovery-inventory.md](../../../agents/discovery-inventory.md), [discovery-ssot.md](../../../agents/discovery-ssot.md), [dependency-analysis.md](../../../agents/dependency-analysis.md) — 2–3 parallel max for lite path.

Every Task prompt **must** include the policy excerpt from [_task-prompt-policy.md](../_task-prompt-policy.md).
