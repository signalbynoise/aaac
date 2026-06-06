# Release ship procedure (reference)

Canonical steps migrated from legacy `/ship-ludecker`. Subagents in `agents/release-*.md` own each slice.

## Git (Wave 1 — blocking)

1. Confirm repo: `signalbynoise/ludecker` (or local ludecker monorepo)
2. `git status` + `git diff` + `git diff --staged` + `git log -5 --oneline`
3. Never stage `.env`, `.env.local`, credentials, or API keys
4. Draft 1–2 sentence commit message from diff and user intent
5. `git add` intentional paths → `git commit` (HEREDOC message)
6. Ensure on `main`: `git checkout main` if needed; `git pull --rebase origin main`
7. `git push origin main` — on reject, rebase once more; never force-push main
8. Output: `commit_sha`, `commit_message_first_line`, `commit_message_body`

**Rules:** No force-push main. On pre-commit hook failure: fix and new commit — never amend unless user asked.

## Render (Wave 2 — after push)

MCP: `user-render` only (not `plugin-render-render`).

**Service SSOT:** `ludecker-website` (see `render.yaml`, `docs/deployment.md`).

1. `list_services` — find `name === "ludecker-website"`, note `id`
2. After push: `list_deploys` (`limit: 5`) — match deploy `commit.id` to `commit_sha`
3. Poll up to **15 minutes**, every **30s**, until `status === "live"` or terminal failure
4. Smoke check: `curl -fsS -o /dev/null -w "%{http_code}" https://ludecker-website.onrender.com/` — expect **200**

## Preflight (optional, Wave 0)

If intent includes "with tests": run `pnpm typecheck` from repo root before git work.
