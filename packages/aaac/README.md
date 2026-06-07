# @ludecker/aaac

**Agentic Architecture as Code (AAAC)** — a complete agentic architecture framework for Cursor.

> Commands are the public API. Skills, agents, and orchestrators are private implementation.

## Install

No `npm` CLI required. Use `npx` or `pnpm dlx`:

```bash
npx @ludecker/aaac@latest init
```

```bash
pnpm dlx @ludecker/aaac@latest init
```

Non-interactive:

```bash
npx @ludecker/aaac@latest init --yes --dir /path/to/your/repo
```

## What you get

Works **out of the box** after `init` — open in Cursor and run commands. No post-install setup.

- `.cursor/hooks.json` — Run lifecycle and edit enforcement (installed with the project)
- `.cursor/aaac/` — ontology, graph, lifecycle, run model, enforcement
- `.cursor/skills/shared/` — full pipeline (discovery → execute → verify → report)
- `.cursor/agents/` — 13 generic subagent specs
- `.cursor/commands/` — ~130 generated slash commands
- `docs/` — ready-to-use `master_rules.md`, `architecture.md`, and `agentic_architecture.md`

Optional later: add **domains** under `.cursor/domains/<slug>/` (see maintainer appendix in `agentic_architecture.md`).

## Regenerate

After editing `ontology.json` or `graph.project.yaml`:

```bash
npx @ludecker/aaac@latest generate
pnpm dlx @ludecker/aaac@latest generate
```

## Links

- [Install guide](https://ludecker.com/guide/install-aaac)
- [Package on npm](https://www.npmjs.com/package/@ludecker/aaac)
- [Lüdecker](https://ludecker.com) — reference implementation

## Publish (maintainers)

Authenticate with a registry token in `.npmrc` (used by pnpm, not the `npm` CLI):

```bash
pnpm --filter @ludecker/aaac publish --access public --no-git-checks
git tag aaac-v1.1.0
git push origin aaac-v1.1.0
```

CI publishes on `aaac-v*` tags via `.github/workflows/publish-aaac.yml` (`NPM_TOKEN` secret).
