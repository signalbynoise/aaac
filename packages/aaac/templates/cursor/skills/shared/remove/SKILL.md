---
name: shared-remove
description: >-
  Delete or retire code, routes, flags, migrations (with caution). Not user-facing.
disable-model-invocation: true
---

# Shared remove

## When

`remove-*` commands after discovery confirms scope.

## Mandatory before edits

1. List blast radius (imports, routes, tests, docs, feature flags)
2. Confirm no production dependency (grep + Fallow if available)
3. Prefer feature-flag off before hard delete when rollout risk exists

## Execution focus

- Remove dead code paths; update inventory/docs in same change
- Schema: deprecate column before drop when data may exist
- Never remove secrets or env from blueprint without render.yaml update

## Must not

- Remove `app` shell or auth entry without explicit user confirmation in intent
