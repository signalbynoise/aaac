# Setup App Web

**Manual scaffold command** — not routed through AAAC `graph.yaml` (same pattern as project-specific `/launch-*` commands).

Bootstrap a **production-grade React web app** with AAAC best-practice defaults inside a pnpm monorepo. Optionally provisions Supabase (MCP) and Render infra (MCP) for a **new workspace**.

**Hard rule:** Do not commit, push, or deploy unless the user asks separately.

---

## Stack SSOT (this command)

| Layer | Choice | Notes |
|-------|--------|-------|
| UI | React 19 | SPA, no Next.js |
| Bundler | Vite 6 | `@vitejs/plugin-react`, port **3001** default |
| Language | TypeScript 5 | strict, `"type": "module"` |
| CSS | Tailwind CSS v4 | `@tailwindcss/postcss`, token CSS in `packages/ui` |
| Routing | TanStack Router | file routes under `src/routes/` |
| Data fetching | TanStack Query | shared `queryClient` in `src/lib/query/` |
| Validation | Zod | schemas in `packages/types` |
| Client state | Zustand | stores in `src/store/` (UI/session only — server data via Query) |
| Unit tests | Vitest + Testing Library | `@testing-library/react`, jsdom |
| E2E | Playwright | `playwright.config.mjs` at repo root or `e2e/` |
| Lint/format | ESLint 9 flat + Prettier | shared root configs |
| Components | ShadCN/Radix | SSOT in `packages/ui/src/components/ui/` |
| Database | Supabase | migrations in `supabase/migrations/`, MCP apply |
| Infra | Render Blueprint | `render.yaml` — **user-render** MCP only |
| Local dev | `/launch-<app-slug>` | generated manual command |

---

## Parse input

From `$ARGUMENTS` and the user message:

| Slot | Rule |
|------|------|
| App slug | kebab-case, e.g. `my-app` — becomes `apps/<slug>`, package `@<scope>/<slug>` |
| Scope name | npm scope / monorepo prefix, default from repo `package.json` name or user-provided, e.g. `acme` → `@acme/my-app` |
| Intent | optional quoted string — product one-liner for README |

| Flag | Effect |
|------|--------|
| `--scope new` | Create/use a **new git root** (empty dir or `--dir`) — full monorepo + AAAC if missing |
| `--scope monorepo` | Add app into **current** pnpm workspace (default when already in monorepo) |
| `--dir <path>` | Target root for `--scope new` (default: cwd) |
| `--skip-supabase` | Skip Phase 11 (DB, migrations, `.env.example` keys only) |
| `--skip-infra` | Skip Phase 12 (no `render.yaml` / Render MCP) |
| `--skip-playwright` | Skip Phase 9 |
| `--skip-shadcn` | Skip ShadCN init; still add Tailwind shell |
| `--port <n>` | Vite dev port (default **3001**) |
| `--dry-run` | Print planned tree + commands; no writes |

**Examples:**

```text
/setup-app-web my-dashboard "Internal ops dashboard"
/setup-app-web my-dashboard --scope new --dir ~/projects/my-dashboard
/setup-app-web my-dashboard --skip-infra --skip-supabase
```

---

## Preconditions

1. **Node** ≥ 20, **pnpm** ≥ 9 (`packageManager` in root `package.json`).
2. **AAAC:** `.cursor/aaac/graph.yaml` exists — if missing and `--scope new`, run `pnpm dlx @ludecker/aaac@latest init --yes` in target root first.
3. **Supabase MCP** (`plugin-supabase-supabase`): required unless `--skip-supabase`. Read tool schemas before calling.
4. **Render MCP** (`user-render`): required unless `--skip-infra`. Use **`user-render` only** — not `plugin-render-render`. Bootstrap workspace if unset (see project deploy rules or ask user for workspace owner id).
5. **Do not** print secrets. `.env.local` is gitignored; document keys in `.env.example` only.

Stop with a clear message if a required MCP is unavailable and the matching `--skip-*` flag was not passed.

---

## Naming conventions

| Fact | Location |
|------|----------|
| App directory | `apps/<app-slug>/` |
| Package name | `@<scope>/<app-slug>` |
| UI package | `@<scope>/ui` |
| Types package | `@<scope>/types` |
| Utils package | `@<scope>/utils` |
| Launch command | `.cursor/commands/launch-<app-slug>.md` |
| Manual command entry | `.cursor/aaac/project.config.json` → `manual_commands` |

Register `launch-<app-slug>.md` in `manual_commands` and append a row to `.cursor/aaac/ontology.md` **Manual commands** table.

---

## Phase 0 — Plan (always)

Emit a short plan:

- scope: `new` | `monorepo`
- paths to create
- MCP phases included/skipped
- dev URL `http://localhost:<port>/`

If `--dry-run`, stop after the plan.

---

## Phase 1 — Workspace shell

### `--scope new`

Create (or verify):

```text
<root>/
  pnpm-workspace.yaml      # packages: ["apps/*", "packages/*"]
  package.json             # scripts: dev, build, lint, typecheck, test
  tsconfig.base.json
  .gitignore               # node_modules, dist, .env.local, playwright-report
  .cursor/                 # from aaac init if missing
  docs/master_rules.md     # from aaac init if missing
```

Root `package.json` scripts (minimum):

```json
{
  "scripts": {
    "dev": "pnpm --filter @<scope>/<app-slug> dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:e2e": "pnpm exec playwright test"
  }
}
```

### `--scope monorepo`

Verify `pnpm-workspace.yaml` includes `apps/*` and `packages/*`. Do not duplicate root tooling if it already exists — extend scripts only when missing.

---

## Phase 2 — Shared packages

Create if absent (minimal, Master Rules–aligned):

### `packages/types`

- `src/index.ts` — shared enums, nav ids, Zod re-exports
- `src/schemas/` — Zod schemas for API/content boundaries
- `package.json` — no React/Next imports

### `packages/utils`

- `src/logger.ts` — structured debug logger (level, module, operation)
- `package.json` — runtime-free utilities

### `packages/ui`

- `src/tokens.css`, `src/shadcn-theme.css`
- `src/lib/utils.ts` — `cn()` helper
- `src/index.ts` — barrel exports
- `components.json` for ShadCN CLI (Tailwind v4 paths)

**Layer rule:** `packages/ui` must not import from `apps/*`.

---

## Phase 3 — Vite + React + TypeScript app

Scaffold `apps/<app-slug>/`:

```text
apps/<app-slug>/
  index.html
  vite.config.ts
  tsconfig.json
  postcss.config.mjs
  src/
    main.tsx
    router.tsx
    vite-env.d.ts
    pages/HomePage.tsx
    lib/query/client.ts
    store/app-store.ts
    styles/shadcn.css
  .env.example
  package.json
```

**`vite.config.ts` essentials:**

- `@vitejs/plugin-react`
- alias `@` → app root
- `server.port` = chosen port, `strictPort: true`
- `define` for `import.meta.env` / public Supabase URL keys (empty string defaults in dev)

**`package.json` scripts:**

```json
{
  "scripts": {
    "dev": "vite --port <port>",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

**Dependencies (install with pnpm):**

- runtime: `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `zod`, `zustand`, `@supabase/supabase-js`, workspace packages
- dev: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`

Wire `src/main.tsx` → `AppRouter` → TanStack Router + Query (see Phase 5).

---

## Phase 4 — Tailwind CSS v4

1. `postcss.config.mjs` with `@tailwindcss/postcss`
2. `apps/<app-slug>/src/styles/shadcn.css`:

```css
@import "tailwindcss";
@import "@<scope>/ui/shadcn-theme.css";
```

3. Import `./styles/shadcn.css` from `main.tsx` (or dedicated `vite-styles.ts` if splitting tokens)

No inline styles in components — token classes only.

---

## Phase 5 — TanStack Router + Query

**Router (`src/routes/index.ts`):**

- `createRootRoute`, `createRoute`, `createRouter`
- Default route `/` → `HomePage`
- Export `router` + route tree for tests

**Query (`src/lib/query/client.ts`):**

- Single `QueryClient` with sensible defaults (`staleTime`, retry)
- Used in `router.tsx` inside `QueryClientProvider`

**`router.tsx`:**

```tsx
<QueryClientProvider client={queryClient}>
  <RouterProvider router={router} />
</QueryClientProvider>
```

Add a smoke test: router renders home heading (Vitest + Testing Library).

---

## Phase 6 — Zod + Zustand

- **Zod:** put boundary schemas in `packages/types/src/schemas/`; validate API responses and form input at boundaries only
- **Zustand:** `src/store/app-store.ts` for UI chrome (sidebar, theme) — not for server-fetched lists (Query owns that)

Document in app README: one owner per state (Master Rules §12).

---

## Phase 7 — ShadCN (unless `--skip-shadcn`)

From `packages/ui`:

```bash
cd packages/ui && pnpm exec shadcn@latest init -y
pnpm exec shadcn@latest add button -y
```

- Components live in `packages/ui/src/components/ui/`
- App imports `Button` from `@<scope>/ui`
- Never duplicate ShadCN under `apps/<app-slug>/components/ui`

---

## Phase 8 — Vitest + Testing Library

Per app `vitest.config.ts` (or root with projects):

- environment: `jsdom`
- setup file: `@testing-library/jest-dom/vitest`
- include: `src/**/*.{test,spec}.{ts,tsx}`

Add at least:

- `src/pages/HomePage.test.tsx` — renders title
- `src/lib/query/client.test.ts` — client factory (optional)

Root script `pnpm test` runs workspace tests.

---

## Phase 9 — Playwright (unless `--skip-playwright`)

At repo root (or `e2e/`):

- `playwright.config.mjs` — `webServer` runs `pnpm --filter @<scope>/<app-slug> dev`, baseURL `http://localhost:<port>`
- `e2e/smoke.spec.ts` — homepage returns 200, visible h1

Add `"test:e2e": "playwright test"` to root `package.json`.

---

## Phase 10 — ESLint + Prettier

**ESLint 9 flat** — root `eslint.config.mjs`:

- `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`
- ignore `dist`, `node_modules`

**Prettier** — root `.prettierrc`:

```json
{ "semi": true, "singleQuote": true, "trailingComma": "all" }
```

Add `"format": "prettier --write ."` at root. Apps extend root config — no duplicated rule sets.

---

## Phase 11 — Supabase DB (unless `--skip-supabase`)

**Requires Supabase MCP.** Read `list_tables`, `apply_migration` (or equivalent) schemas first.

1. Create `supabase/migrations/<timestamp>_init.sql`:
   - extensions if needed
   - minimal tables + RLS (anonymous read where appropriate)
   - `updated_at` triggers if used
2. Apply migration via MCP immediately after writing SQL.
3. `apps/<app-slug>/.env.example`:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. `apps/<app-slug>/src/lib/supabase/client.ts` — browser client using `VITE_*` keys only; service role never in client bundle.
5. Mirror row types in `packages/types`.

If MCP cannot apply (no project linked), write migrations + `.env.example` and **stop with handoff**: user must link project and re-run apply.

---

## Phase 12 — Infra / Render (unless `--skip-infra`)

**Requires `user-render` MCP.** For `--scope new`, treat Render as a **new workspace** — confirm service name with user.

1. Add root `render.yaml` Blueprint:

```yaml
services:
  - type: web
    name: <app-slug>
    runtime: node
    rootDir: apps/<app-slug>
    buildCommand: cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @<scope>/<app-slug> build
    startCommand: pnpm preview --host 0.0.0.0 --port $PORT
    healthCheckPath: /
    envVars:
      - key: NODE_VERSION
        value: "20"
      - key: VITE_SUPABASE_URL
        sync: false
      - key: VITE_SUPABASE_PUBLISHABLE_KEY
        sync: false
```

2. Add `docs/deployment.md` — env vars, deploy flow, MCP workspace id (placeholder if unknown).
3. Use Render MCP to validate blueprint or list services — do not deploy unless user asks.

For static Vite hosting, prefer Render static site or web service with `vite preview` as above; document CDN/cache headers in deployment doc.

---

## Phase 13 — Generate `/launch-<app-slug>`

Create `.cursor/commands/launch-<app-slug>.md` modeled on existing project launch commands:

| Step | Action |
|------|--------|
| Kill | `lsof -ti :<port> \| xargs kill -9` (unless `--no-kill`) |
| Clean | `rm -rf apps/<app-slug>/node_modules/.vite apps/<app-slug>/dist` |
| Start | `pnpm --filter @<scope>/<app-slug> dev` (background) |
| Verify | curl `/` → 200; optional `pnpm typecheck` |

Register in `.cursor/aaac/project.config.json`:

```json
"manual_commands": [..., "launch-<app-slug>.md"]
```

Append to `.cursor/aaac/ontology.md` manual commands table.

---

## Phase 14 — Install + verify

From repo root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @<scope>/<app-slug> build
```

Unless `--skip-playwright`:

```bash
pnpm test:e2e
```

Fix failures before reporting success.

---

## Phase 15 — Setup report

Output:

```markdown
## Setup App Web — Report

**App:** @<scope>/<app-slug>
**Scope:** new | monorepo
**Dev URL:** http://localhost:<port>/
**Launch command:** /launch-<app-slug>

**Created/updated:**
- apps/<app-slug>/ …
- packages/{types,ui,utils}/ …
- supabase/migrations/ … (or skipped)
- render.yaml … (or skipped)
- launch-<app-slug>.md

**Verify:**
- typecheck: pass | fail
- unit tests: pass | fail
- build: pass | fail
- e2e: pass | fail | skipped

**Next steps for you:**
1. Copy `apps/<app-slug>/.env.example` → `.env.local` and fill Supabase keys
2. Run `/launch-<app-slug>`
3. Use `/create-feature`, `/update-module`, … for AAAC-governed changes
```

---

## Anti-patterns

- Using `/create-app` alone for this stack — it has no default web recipe; use **`/setup-app-web`** first, then AAAC verbs for features
- Next.js for greenfield when user asked for Vite SPA stack
- Duplicating ShadCN or tokens under `apps/`
- Skipping MCP migration apply after adding SQL
- Using `plugin-render-render` instead of **`user-render`**
- Committing `.env.local` or printing service role keys
- Parent orchestrator editing prod code during AAAC runs — after setup, use Task agents in `execute`

---

## Relationship to AAAC

| Command | Role |
|---------|------|
| `/setup-app-web` | One-time scaffold + launch command (manual) |
| `/create-app` | AAAC-governed app/domain creation inside existing architecture |
| `/launch-<app-slug>` | Repeatable local dev (manual) |
| `/release-app` | Ship via Render + verify swarm |

After setup, all feature work must use AAAC slash commands inside Runs (hooks enforced).
