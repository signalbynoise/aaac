# Architecture

This describes how your repo works with Agentic OS. It ships ready to use — edit only when you want project-specific detail.

## Your project + Agentic OS

```text
your-repo/
  (your app code — any stack)
  .cursor/          ← Agentic OS (commands, skills, agents, runs)
  docs/             ← rules and architecture (this folder)
```

Agentic OS does not replace your app. It sits beside your code and gives Cursor a structured way to create, update, fix, review, test, and release work.

## How you work

You type a **command** and a short **intent**. The system runs a pipeline (discover → plan → execute → verify → report) and keeps agents on track.

```text
/create-module billing "Add invoice export"
/fix-module api "Webhook fails on retries"
/review-architecture system "Check layer boundaries"
```

You do not need to learn skills, agents, or orchestrators — those are internal.

## Layers (generic)

| Layer | Does | Does not |
|-------|------|----------|
| UI | Render, user interaction | Business rules, direct database access |
| Domain | Rules, validation, invariants | UI markup, framework-specific rendering |
| Infrastructure | APIs, persistence, adapters | Business decisions |

## What ships on install

- ~130 slash commands (create, update, fix, review, check, test, release, remove × modules, APIs, UI, etc.)
- Shared pipeline skills and subagent specs
- Run lifecycle and hook scripts under `.cursor/`
- Generic rules in this folder (ready without edits)

## Optional later

Add domains under `.cursor/domains/<name>/` when you want deeper knowledge of a bounded area (payments, auth, CMS, etc.). Extend `.cursor/aaac/graph.project.yaml` to route commands to those domains. Enable build verification in `.cursor/aaac/project.config.json` when you have a web app to gate before release.

None of that is required to start.
