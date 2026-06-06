---
name: shared-integration
description: >-
  API routes, MCP, webhooks, OAuth — product-layer external surface. Not user-facing.
disable-model-invocation: true
---

# Shared integration

## Scope

- `apps/website/app/api/`, Supabase MCP, Render deploy policies
- Project rules: [deploy.mdc](../../../../rules/deploy.mdc), [supabase-mcp.mdc](../../../../rules/supabase-mcp.mdc)

## Execution focus

- Adapter at infrastructure boundary; validate at boundary
- One route family or integration per change

## Release focus

- Smoke: auth, callbacks, CORS, rate limits
