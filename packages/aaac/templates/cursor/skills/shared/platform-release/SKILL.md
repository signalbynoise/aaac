---
name: shared-platform-release
description: >-
  Phased release for release-app: mandatory preflight, git, optional conditional
  package publish, Render poll, verify, report.
disable-model-invocation: true
---

# Shared platform release

## Swarm DAG

```text
Wave 0: pnpm typecheck (mandatory)
  ↓
Wave 1: release-git  ← BLOCKING
  ↓
Wave 1.5: conditional package publish ← OPTIONAL (project overlay; blocking when triggered)
  ↓
Wave 2: release-render ← BLOCKING (poll until live or fail)
  ↓
Wave 3: verification + reporting
```

## Wave 0 — preflight

```bash
pnpm typecheck
```

Always. Optional extra tests when intent requests them.

## Wave 1 — git

Execute [agents/release-git.md](../../../agents/release-git.md) or spawn shell subagent.

## Wave 1.5 — conditional publish (project overlay)

When the project ships an npm package with the app (e.g. `@ludecker/aaac`), the project overlay supplies a conditional publish agent and detection scripts. Skip when no changes detected.

## Wave 2 — Render (mandatory)

Execute [agents/release-render.md](../../../agents/release-render.md).

**Never** end ship without polled deploy status.

## Reference

Full steps: [ship-procedure.md](ship-procedure.md)
