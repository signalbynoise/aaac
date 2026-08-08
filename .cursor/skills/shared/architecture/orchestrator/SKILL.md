---
name: review-module-orchestrator
description: Orchestrates review-module — architecture and quality analysis. Internal only.
disable-model-invocation: true
---

# review-module orchestrator

## Parse

- **Domain:** slug or path hint
- **Intent:** quoted analysis goal

## Phases

1. Load domain inventory if slug maps in graph
2. [discovery](../discovery/SKILL.md) — readonly, focused scope
3. [architecture review](../SKILL.md)
4. [reporting](../reporting/SKILL.md)

No code changes in this command alone.
