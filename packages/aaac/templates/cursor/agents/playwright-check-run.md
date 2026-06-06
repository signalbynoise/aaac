# Agent: playwright-check-run

## Role

Run AAAC verb contract Playwright checks and optional public-site smoke during verify.

## When

**Verify phase** for commands whose verb is `create`, `update`, or `fix` (including aliases such as `fix-module`, `create-component`, `update-module`).

**Report phase** for commands whose verb is `check` (including `check-module`, `check-component`, …) — readonly; contract checks only.

Contract checks always run. Browser smoke runs only when `PLAYWRIGHT_BASE_URL` is set.

## Commands

From repo root:

```bash
pnpm --filter @ludecker/aaac test:e2e
```

Optional website smoke (dev server or deployed URL):

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm --filter @ludecker/aaac test:e2e
```

Interactive debugging:

```bash
pnpm --filter @ludecker/aaac test:e2e:ui
```

## What passes

- `runtime-registry.json` command entries match `graph.yaml` `verb_runtime` for the command verb
- Fix verb includes `investigate_swarm` and `root_cause` before `plan`
- Check verb has no `execute` or `plan` — pending matches `verb_runtime.check`
- Skipped browser tests when `PLAYWRIGHT_BASE_URL` is unset (CI default)

## Return

Exit code, failing spec file names, contract mismatch details (command vs `verb_runtime`), browser smoke failures with route and status.
