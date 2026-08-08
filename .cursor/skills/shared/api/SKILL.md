---
name: shared-api
description: >-
  HTTP routes, BFF handlers, request/response contracts. Used by verb orchestrators
  when object is api. Not user-facing.
disable-model-invocation: true
---

# Shared API layer

## Scope

- `server/routes/`, route handlers, middleware
- Request validation (Zod/schemas at boundaries)
- Auth and project scoping on endpoints
- OpenAPI or shared route constants if present

## Execution focus

- One route family per change; no cross-cutting drive-by edits
- Validate at boundary; errors explicit and actionable
- CORS and origins per deploy policy

## Discovery / check angles

Map: method + path → handler → service → DB/external.
