---
name: shared-module-authoring
description: >-
  Scaffolds domains/<slug>/update/ inventory + orchestrator when slug missing
  from graph. Discovery swarm required. Not user-facing.
disable-model-invocation: true
---

# Shared module-authoring

## When

- `create-feature` for unknown slug
- Intent `create domain` / greenfield module
- Graph resolver finds no `domains/<slug>/update/`

## Steps

1. Discovery swarm (4–6 readonly) — inventory + constraints + out-of-scope
2. Create `domains/<slug>/update/inventory/SKILL.md` from template in [authoring-template.md](authoring-template.md)
3. Create `domains/<slug>/update/orchestrator/SKILL.md` + `contract.yaml` (copy cms pattern)
4. Add slug to `graph.yaml` resolvers (`update-module-by-slug`, etc.)
5. [reporting](../reporting/SKILL.md) — path to new domain

Do not change application code unless a separate code command is active.

## Governance

[implementation](../governance/implementation/SKILL.md) applies only if authoring includes code in same run.
