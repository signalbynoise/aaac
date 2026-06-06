---
name: shared-planning
description: >-
  Plans AAAC changes: SSOT, layers, size budgets, state machines. Readonly until
  orchestrator approves. Invoked by graph — not user-facing.
disable-model-invocation: true
---

# Shared planning

## When

After `discovery_swarm`. **Does not edit files.**

## Agents

Optional parallel readonly:

- [plan-layer-map.md](../../../agents/plan-layer-map.md)
- [plan-state-machines.md](../../../agents/plan-state-machines.md)

## Plan document (internal)

- User intent → concrete paths (from domain inventory)
- SSOT owner for new state
- Extract before add if any file ≥80% budget
- Named machine states/events if async coordination added
- Migration + schema steps if DB changes

Orchestrator gates `execute` — no implementation until plan respects domain constraints.
