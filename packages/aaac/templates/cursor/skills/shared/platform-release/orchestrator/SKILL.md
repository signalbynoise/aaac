---
name: release-app-orchestrator
description: >-
  Orchestrates release-app with phased expert subagents: git (blocking),
  then Render deploy verification.
disable-model-invocation: true
---

# release-app orchestrator

## Parse

- **Domain:** `production` (default) or environment token
- **Intent:** quoted ship notes (optional) — e.g. `"Ship with tests"`

## Load

1. [../SKILL.md](../SKILL.md) — swarm DAG
2. [ship-procedure.md](../ship-procedure.md) — step reference
3. [graph.yaml](../../../../aaac/graph.yaml) — `release-app`
4. Project overlay infrastructure skill when present (`skills/<project>/infrastructure/`)

## Phases

### 0. Preflight

If intent requests tests: run `pnpm typecheck` before any git work ([shared/testing](../../testing/SKILL.md) patterns).

### 1. Wave 1 — Git (blocking)

Spawn subagent per [agents/release-git.md](../../../../agents/release-git.md).

**Do not** start Wave 2 until `commit_sha` is returned.

### 2. Wave 2 — Deploy (optional)

When project overlay supplies a deploy agent, spawn it with `commit_sha`, `commit_message_first_line`, `commit_message_body`. Skip when not configured.

If deploy `build_failed`, overall status is failed.

### 3. Verify + report

- [verification](../../verification/SKILL.md): deploy live, intent met
- [reporting](../../reporting/SKILL.md): layman summary + technical details table per agent

## Anti-patterns

- Starting Render before push completes
- Single agent doing git + deploy without expert prompts
- Using `plugin-render-render` MCP
- Force-pushing `main`
