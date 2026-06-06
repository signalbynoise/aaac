---
name: shared-platform-release
description: >-
  Phased release swarm coordination for release-app. Wave 1 git (blocking),
  Wave 2 Render deploy. Internal only.
disable-model-invocation: true
---

# Shared platform release

## Swarm DAG

```text
Preflight (optional tests)
  ↓
Wave 1: release-git  ← BLOCKING
  ↓
Wave 2: release-render
  ↓
Parent: verification + reporting
```

## Wave 1 — launch one agent

```
Task (shell or generalPurpose): release-git
Read: agents/release-git.md, ship-procedure.md
Return: commit_sha, commit_message_*
On failure: abort pipeline
```

## Wave 2 — Render deploy

Only after Wave 1 `status: success`. Pass `commit_sha` and messages.

| Agent spec | Tool |
|------------|------|
| [release-render.md](../../../agents/release-render.md) | generalPurpose or render-assistant MCP |

## Preflight

If intent contains "test" / "with tests": run `pnpm typecheck` before Wave 1.

## Reference

Full step detail: [ship-procedure.md](ship-procedure.md)
