# @ludecker/aaac

**Agentic Architecture as Code (AAAC)** — a complete agentic architecture framework for Cursor.

> Commands are the public API. Skills, agents, and orchestrators are private implementation.

## Quick start

**1. Install into your repo** (no global `npm` CLI required):

```bash
npx @ludecker/aaac@latest init
```

```bash
pnpm dlx @ludecker/aaac@latest init --yes
```

Non-interactive with a target path:

```bash
npx @ludecker/aaac@latest init --yes --dir /path/to/your/repo
```

**2. Open the project in Cursor** and **enable Hooks once**: Settings → Hooks, then restart Cursor.

After that, slash commands work — no domain overlay, resolvers, or manual `generate` step required. `init` already generates `graph.yaml` and all commands.

**Install report:** `init` writes `.cursor/aaac/state/install-sweep-report.md` — a read-only inventory of docs, Cursor rules, and AAAC framework markdown in your repo, with recommendations (no merges or aliases).

**Install report:** `init` writes `.cursor/aaac/state/install-sweep-report.md` — a read-only inventory of docs, Cursor rules, and AAAC framework markdown in your repo, with recommendations (no merges or aliases).

## Example commands

```text
/create-module api "Add health check endpoint"
/fix-bug auth "Session expires too soon"
/check-module payments "Validate webhook idempotency"
/review-architecture system "Check layer boundaries"
```

## What you get

- `.cursor/hooks.json` — Run lifecycle and edit enforcement
- `.cursor/aaac/` — ontology, graph, lifecycle, run model, enforcement
- `.cursor/skills/shared/` — full pipeline (discovery → execute → verify → report)
- `.cursor/agents/` — generic subagent specs
- `.cursor/commands/` — ~130 generated slash commands
- `docs/` — `master_rules.md`, `ui_design.md`, `project_context.md`, `architecture.md`, `agentic_architecture.md`

**Optional later:** add **domains** under `.cursor/domains/<slug>/` and resolvers in `graph.project.yaml` for slug routing (e.g. `/update-module cms "…"`). See `docs/agentic_architecture.md` Part 2.

## Regenerate

Only needed after you edit `ontology.json` or `graph.project.yaml`:

```bash
npx @ludecker/aaac@latest generate
pnpm dlx @ludecker/aaac@latest generate
```

## Links

- [Install guide](https://ludecker.com/guide/install-aaac)
- [Package on npm](https://www.npmjs.com/package/@ludecker/aaac)
- [Lüdecker](https://ludecker.com) — reference implementation (domain overlays, production deploy)

## Publish (maintainers)

Authenticate with a registry token in `.npmrc` (used by pnpm, not the `npm` CLI):

```bash
pnpm --filter @ludecker/aaac publish --access public --no-git-checks
git tag aaac-v1.1.0
git push origin aaac-v1.1.0
```

CI publishes on `aaac-v*` tags via `.github/workflows/publish-aaac.yml` (`NPM_TOKEN` secret).
