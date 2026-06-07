---
name: shared-integration
description: >-
  API routes, MCP, webhooks, OAuth — product-layer external surface. Not user-facing.
disable-model-invocation: true
---

# Shared integration

## Scope

- Your app's API routes, webhooks, and OAuth adapters
- Optional: [mcp-and-deploy.md](../../../policies/mcp-and-deploy.md) and `.cursor/rules/` when MCP or deploy is configured

## Execution focus

- Adapter at infrastructure boundary; validate at boundary
- One route family or integration per change

## Release focus

- Smoke: auth, callbacks, CORS, rate limits
