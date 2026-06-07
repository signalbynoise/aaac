# Project context — {{PROJECT_NAME}}

Project-specific layout, paths, and SSOT anchors. **Master rules stay generic** — see [master_rules.md](./master_rules.md).

Fill this in when your repo has a stable structure. Until then, agents use generic master rules only.

## Areas

| Area | Location | Responsibility |
|------|----------|----------------|
| Application | e.g. `src/` or `apps/web/` | User-facing app, routes, UI |
| Shared libraries | e.g. `packages/` or `lib/` | Reusable modules |
| Data / persistence | e.g. `db/migrations/` | Schema, seeds, adapters |
| Config | e.g. `config/` or env | Site name, URLs, feature flags |

## SSOT anchors (do not duplicate)

Document where each kind of truth lives in **your** repo:

- App/site name and URL → your constants or config module
- Brand label in UI → design system constants
- Design tokens → tokens file or theme config (see [ui_design.md](./ui_design.md) — tokens only when values repeat)
- Navigation items → shared types or config
- Published content → database table or CMS adapter
- API contracts (OpenAPI, Zod, GraphQL schema) → shared types or `contracts/` folder
- Auth/session configuration → auth module or env
- Cache keys, TTLs, and invalidation tags → cache config or adapter module
- Secret names (not values) → env var list documented here

## Tooling (optional)

When configured, record:

- Structured logger package or utility
- Test commands (unit, integration, E2E)
- Lint/size-budget tools
- Database MCP project ref (if used)
- Deploy service name and smoke URL (if used)

Add `.cursor/rules/` files for MCP and deploy when you connect external providers.
