---
name: shared-workflow
description: >-
  Multi-step business processes and state machines. Object workflow. Not user-facing.
disable-model-invocation: true
---

# Shared workflow

## Scope

- Explicit state machines (finite states, named transitions)
- Orchestration across UI → API → jobs → external systems
- Requirement engine, Q&A graphs, publish pipelines, release waves

## Execution focus

- Model invalid transitions; no timing assumptions
- Idempotent async steps; cancellable where applicable
- Log state transitions at debug level

## Review / check focus

- Can the process reach the intended end state?
- Race conditions and overlapping requests
