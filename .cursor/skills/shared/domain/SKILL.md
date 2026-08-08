---
name: shared-domain
description: >-
  Bounded context — cms, auth, requirement-engine. Object domain (system layer).
  Not user-facing.
disable-model-invocation: true
---

# Shared domain

## Scope

- `domains/<slug>/` inventory, orchestrators, architecture docs
- Cross-module boundaries inside one product area
- AAAC domain argument = this slug

## Execution focus

- Load inventory before changes; sync after
- New domain → inventory + graph resolver map entry

## Check focus

- In/out of scope vs neighboring domains
