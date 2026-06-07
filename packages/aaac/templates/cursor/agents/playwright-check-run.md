# Agent: playwright-check-run

## Role

Run Playwright E2E checks from domain inventory during verify.

## When

**Verify phase** for `create`, `update`, or `fix` verbs when inventory lists Playwright targets.

**Report phase** for `check` verbs when project defines contract E2E specs.

Browser smoke runs only when `PLAYWRIGHT_BASE_URL` is set.

## Commands

Use the command from domain inventory. Example:

```bash
pnpm exec playwright test
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test
```

## Return

Exit code, failing spec file names, browser smoke failures with route and status.
