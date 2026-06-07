# Agent: release-git

**Wave 1 — blocking.** Parent must not start Wave 2 until this agent returns success.

## Role

Commit and push all pending work to the default branch for this repository.

## Inputs (from orchestrator)

- User intent (optional): e.g. "with tests" handled by preflight, not this agent
- `domain`: `production` (default)
- Flags from user message: `--no-commit`, `--message "…"`, `--dry-run`

## Procedure

Follow [ship-procedure.md § Git](../skills/shared/platform-release/ship-procedure.md).

**Repo check:** `git rev-parse --show-toplevel` must be the project root (not a subdirectory).

## Return

```yaml
status: success | failed
commit_sha: string
commit_message_first_line: string
commit_message_body: string
evidence: git log -1 output
```

## Rules

- Never force-push `main`
- Never skip hooks unless user explicitly requested
- Never stage `.env*` or service role keys
- On failure: stop pipeline; do not start Render agent
