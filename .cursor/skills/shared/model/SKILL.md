---
name: shared-model
description: >-
  Entities, DTOs, shared types, query shapes. Object model (data layer). Not user-facing.
disable-model-invocation: true
---

# Shared model

## Scope

- `shared/` types, Zod schemas, domain entities in code
- Align with DB schema; derive — do not duplicate SSOT columns in stores

## Execution focus

- Centralize invariants in schemas
- Map API ↔ model ↔ persistence at boundaries only

## Fix / check focus

- Nullable vs required, enum coverage, query filters
