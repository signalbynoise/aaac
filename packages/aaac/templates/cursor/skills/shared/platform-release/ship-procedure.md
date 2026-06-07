# Release ship procedure (reference)

Generic git-first release. Deploy steps are **optional** — enable via project overlay (`docs/project_context.md`, `.cursor/rules/deploy.mdc`). Subagents in `agents/release-*.md` own each slice.

## Git (Wave 1 — blocking)

1. Confirm repo root (`git rev-parse --show-toplevel`)
2. `git status` + `git diff` + `git diff --staged` + `git log -5 --oneline`
3. Never stage `.env`, credentials, or API keys
4. Draft 1–2 sentence commit message from diff and user intent
5. `git add` intentional paths → `git commit` (HEREDOC message)
6. Ensure on default branch: checkout if needed; `git pull --rebase origin <branch>`
7. `git push origin <branch>` — on reject, rebase once more; never force-push protected branches
8. Output: `commit_sha`, `commit_message_first_line`, `commit_message_body`

**Rules:** No force-push to protected branches. On pre-commit hook failure: fix and new commit — never amend unless user asked.

## Deploy (Wave 2 — optional, project overlay)

Skip when no deploy agent or `project.config.json` deploy section is configured.

1. Read service name and smoke URL from `docs/project_context.md` or `.cursor/rules/deploy.mdc`
2. Use your team's configured deploy MCP (see [mcp-and-deploy.md](../../../policies/mcp-and-deploy.md))
3. After push: list deploys — match `commit.id` to `commit_sha`
4. Poll until `live` or terminal failure
5. Smoke check production URL — expect success status

## Preflight (optional, Wave 0)

If intent includes "with tests": run project typecheck/test command from repo root before git work.
