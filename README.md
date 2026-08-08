# AAAC

Agentic Architecture as Code (`@ludecker/aaac`) and the reusable local integration boundary (`@ludecker/agentic-bridge`).

## Packages

| Package | npm | Role |
|---------|-----|------|
| `@ludecker/aaac` | public | Installable Cursor agent framework |
| `@ludecker/agentic-bridge` | public | Workspace install, run dispatch, Cursor adapter |

## Develop

```bash
pnpm install
pnpm test
```

## Publish

- Tag `aaac-v*` → publishes bridge (if needed) then `@ludecker/aaac`
- Tag `agentic-bridge-v*` → publishes `@ludecker/agentic-bridge`

## Supabase

Optional AAAC run persistence migrations live under `supabase/migrations/`. Consumers apply them to their own project when enabling AAAC telemetry.

## CI secrets

Add repository secret `NPM_TOKEN` (same as previously on `ludecker`) so `aaac-v*` / `agentic-bridge-v*` publish workflows can push to npm.
