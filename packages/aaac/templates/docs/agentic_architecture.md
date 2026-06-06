# Agentic Architecture as Code (AAAC)

## In one sentence

> **Commands are the public API. Skills, agents, tools, rules, and documentation are private implementation details.**

You express intent; the architecture determines execution.

---

## Part 1 — For everyone

### What you do

> **Call a command. The system figures out the rest.**

Ask: *What do I want?* Then type:

```text
/<verb>-<object> <domain> "<intent>"
```

| Part | Meaning | Example |
|------|---------|---------|
| Command | Kind of work | `update-module` |
| Domain | Which area | `cms` |
| Intent | Goal in plain language | `"Add featured hero toggle to home page"` |

### Ludecker domains

| Slug | Scope |
|------|-------|
| `cms` | `apps/website` — public site, CMS admin, content queries |
| `ui` | `packages/ui` — design system, tokens, components |
| `database` | `supabase/migrations` — schema, RLS, type mirrors |
| `aaac` | `packages/aaac` — `@ludecker/aaac` npm package, CLI, templates, generators |

### Commands (Ludecker v1)

| Command | When to use |
|---------|-------------|
| `update-module` | Change an existing bounded module (`cms`, `ui`, `database`, `aaac`) |
| `update-doc` | Update architecture documentation (no code) |
| `update-design` | UI / design-system changes (`cms` or `ui`) |
| `create-feature` | Add a new capability in a domain |
| `fix-module` | Fix broken module — **requires domain**; full fix swarm |
| `fix-bug` | Same pipeline as `fix-module`; domain optional (`module-fix`, `bug-fix` aliases) |
| `review-module` | Quality/architecture review (no code) |
| `review-incident` | Investigate deploy or production issue |
| `test-module` | Test and verify a module |
| `test-function` | Test a user journey |
| `release-app` | Phased release swarm (git → Render) |
| `publish-aaac` | Bump, smoke-test, and publish `@ludecker/aaac` to npm |
| `write-article` | Research swarm → CMS article persist |

### Manual commands (local dev)

| Command | When to use |
|---------|-------------|
| `launch-ludecker` | Clean local dev server start |
| `kill-ludecker` | Kill stale local port listeners |

### Examples

```text
/update-module cms "Improve docs shell navigation"
/update-module ui "Add dark mode token for muted text"
/update-module aaac "Add --version flag to CLI"
/fix-bug cms "CMS publish does not revalidate home page"
/fix-bug aaac "init fails when target dir already exists"
/test-module aaac "Run init smoke and aaac:generate diff check"
/publish-aaac "Ship 1.0.1 with template sync"
/update-doc architecture "Document AAAC agent topology"
/review-module cms "Check size budgets and layer boundaries"
/test-module cms "Run full module verification"
/release-app production "Ship with typecheck"
/write-article guide, How to use Commands in Cursor
/launch-ludecker
```

### Deprecated (still work one release)

| Old | New |
|-----|-----|
| `/ship-ludecker` | `/release-app` |
| `/module-update` | `/update-module` |
| `/architecture` | `/update-doc` |
| `/swarm-check` | `/review-incident` or `/fix-bug` |
| `/refactor` | `/review-module` |

### What you should not need to know

skill, agent, subagent, tool, workflow, graph, orchestrator — infrastructure only.

---

## Part 2 — Appendix (maintainers)

### Responsibility layers

AAAC is organized by **responsibility**, not file type. Full map: [`.cursor/aaac/layers.md`](../.cursor/aaac/layers.md)

```text
User Layer          → Commands
Control Layer       → Ontology, Dispatch, Graph
Lifecycle Layer     → work phases (lifecycle.json)
Governance Layer    → gate stacks (gates.json), policies, fitness
Run Layer           → Run manifest (state + observability)
Execution Layer     → Orchestrators, pipeline skills, capabilities, agents
Contracts Layer     → command + skill contracts
Knowledge Layer     → docs/
```

| Component | Responsibility |
|-----------|----------------|
| Commands | User-facing API |
| Ontology | Vocabulary and classification |
| Dispatch | Command resolution, Run creation |
| Graph | Execution routing |
| Lifecycle | **Work** phase configuration |
| Gate stacks | **Approval** checkpoints |
| Run | Primary execution object; decisions, log, checkpoints |
| Domain orchestrators | Domain coordination |
| Shared pipeline skills | Phase execution |
| Capability registry | object → capability → provider |
| Object skills | Skill-type providers |
| Agent specs | Agent behavior |
| Policies | Mandatory governance |
| Dependencies | Impact analysis |
| Fitness functions | Architecture validation |
| Contracts | Input/output invariants |
| Documentation | System knowledge |

### Execution graph

```text
Intent → Command → Execution Graph → Result
```

**Execution graph** = orchestrator + skills + agents + tools + rules + documentation.

**SSOT:** [`.cursor/aaac/graph.yaml`](../.cursor/aaac/graph.yaml)

**Dispatch procedure:** [`.cursor/aaac/dispatch.md`](../.cursor/aaac/dispatch.md)

### Directory layout

```text
.cursor/
  commands/          # thin routers (public)
  aaac/graph.yaml    # wiring (private OS)
  domains/<slug>/update/
    orchestrator/    # what happens
    inventory/       # what exists
  skills/shared/     # framework (discovery, planning, execution, …)
  skills/ludecker/   # project-specific object skills
  skills/write-article/  # content swarm
  agents/            # subagent prompt specs
  policies/          # rules all skills inherit
```

### Orchestrator vs inventory

| | Orchestrator | Inventory |
|--|--------------|-----------|
| Question | What should happen? | What exists? |
| Updates when | Workflow changes | After every code-changing `update-module` |

Inventory documents constraints and file maps. **Dependency reasoning** uses [`.cursor/aaac/dependencies.yaml`](../.cursor/aaac/dependencies.yaml) via the `dependency_graph` phase — not inventory alone.

### Execution determinism (create / update / fix)

Commands define *what* to load; **work lifecycle** defines phases of work; **gate stacks** define approval checkpoints; the **Run** holds state and observability.

**Mature stack (composed on Run):**

```text
Policies → Ontology → Graph → Create Run
→ Work: Discovery → Investigation → Planning
→ Gates: Validation → Impact → Deps → Fitness → Rollback
→ Work: Execute → Verify → Report
```

**Work lifecycles** (SSOT: [`.cursor/aaac/lifecycle/lifecycle.json`](../.cursor/aaac/lifecycle/lifecycle.json)):

| Verb | Work | Gate stack |
|------|------|------------|
| create | discover → investigate_lite → plan → execute → verify → report | pre_execute |
| update | same | pre_execute |
| fix | discover → investigate_swarm → root_cause → plan → execute → verify → report | pre_execute |
| release | execute → verify → report | release |

**Gate stacks** (SSOT: [`.cursor/aaac/governance/gates.json`](../.cursor/aaac/governance/gates.json)) — approval, not work.

Composed runtime in graph `verb_runtime`. Human approval at gate boundaries: Run `status: blocked`, `awaiting_approval: true`.

**Confidence gates** — before execute, if any score is below threshold → `STOP, REQUEST CLARIFICATION`:

| Dimension | Minimum |
|-----------|---------|
| architecture | 0.9 |
| requirements | 0.8 |
| scope | 0.8 |

**Object maturity** — harder objects require more phases:

| Level | Objects (examples) | Extra requirements |
|-------|-------------------|-------------------|
| protected | schema, migration, architecture | impact + deps + rollback |
| critical | module, integration, app | impact + deps |
| stable | feature, workflow | impact on fix |
| evolving | component, function | lifecycle only |

**Fitness functions** — [`.cursor/aaac/fitness-functions.yaml`](../.cursor/aaac/fitness-functions.yaml): api_first, design_system, accessibility, security, layer_boundaries, performance. Scored `pass` / `warning` / `fail` before execute.

Lifecycle reference: [`.cursor/skills/shared/verbs/_lifecycle.md`](../.cursor/skills/shared/verbs/_lifecycle.md)

### Fix swarm (`/fix-module`, `/fix-bug`, `fix_mode`)

Same rigor as `write-article` research — parallel Task subagents, one message per wave.

| Phase | Agent specs | Count |
|-------|-------------|-------|
| discover | discovery-inventory, discovery-boundaries, discovery-ssot | 4–6 |
| investigate_swarm | fix-repro, fix-code-path, fix-recent-changes, fix-test-failures, fix-regression-scope, fix-runtime-evidence, fix-inventory-confirm | **7** |
| root_cause | parent + optional fix-hypothesis-validate | 0–1 |
| verify (fix) | fix-repro-verify, unit-test-run, fallow-check-changed | **3** |

Skills: [investigation/SKILL.md](../.cursor/skills/shared/investigation/SKILL.md), [testing/SKILL.md](../.cursor/skills/shared/testing/SKILL.md).  
Contracts: [fix-module.yaml](../.cursor/aaac/contracts/commands/fix-module.yaml), [fix-bug.yaml](../.cursor/aaac/contracts/commands/fix-bug.yaml).

Resolver: `fix-domain-by-slug` (`fix-module`) and `fix-bug-by-slug` → `cms-fix-bug` | `ui-fix-bug` | `database-fix-bug` | `aaac-fix-bug`.

### Capability registry

Objects declare capabilities in ontology; providers resolve from [`.cursor/aaac/capabilities/registry.json`](../.cursor/aaac/capabilities/registry.json):

```text
object → capability → provider (skill | mcp | expert)
```

Graph `object_skills` includes skill-type providers only. MCP providers (e.g. `supabase-mcp` on `database-design`) are recorded on the Run.

**Capability lifecycle (evidence-driven):** State belongs to the **capability**, not the provider. After each completed Run, `capability-evidence.mjs` aggregates per-run evidence into [`.cursor/aaac/state/capability-stats.json`](../.cursor/aaac/state/capability-stats.json) and evaluates deterministic promotion using [`.cursor/aaac/capabilities/promotion-rules.json`](../.cursor/aaac/capabilities/promotion-rules.json):

```text
experimental → validated → trusted → canonical → deprecated
```

Promotion uses accumulated metrics: `invocations`, `success_rate`, `rollback_rate`, `gate_failure_rate`, `avg_fitness`. `canonical` requires `manual_approval` (human override on the capability entry). Providers contribute evidence; governance changes state.

### Run (primary execution object)

**SSOT:** [`.cursor/aaac/run/schema.json`](../.cursor/aaac/run/schema.json), [`.cursor/aaac/run/RUN.md`](../.cursor/aaac/run/RUN.md)

Every command executes within a Run at `state/runs/{run_id}/run.json`:

| Field | Purpose |
|-------|---------|
| `phase`, `pending`, `completed` | Where we are |
| `decisions[]` | Why routes and gates |
| `log[]` | Phase events |
| `checkpoints[]` | Resume points |
| `artifacts{}` | Plan, impact, report, … |
| `awaiting_approval` | Human gate approval |

Observability: [`.cursor/aaac/observability/telemetry.yaml`](../.cursor/aaac/observability/telemetry.yaml) — all telemetry on Run, no standalone logs.

### Contracts

Command contracts: [`.cursor/aaac/contracts/commands/`](../.cursor/aaac/contracts/commands/). Skill contracts: [`.cursor/aaac/contracts/skills/`](../.cursor/aaac/contracts/skills/). Schema: [`.cursor/aaac/contract-schema.md`](../.cursor/aaac/contract-schema.md)

### Implementation governance

Not a slash command. Loaded by `shared/execution` on code changes:

[`.cursor/skills/shared/governance/implementation/SKILL.md`](../.cursor/skills/shared/governance/implementation/SKILL.md)

### Adding a product domain

1. Add `domains/<slug>/update/` (inventory + orchestrator)
2. Add slug to `graph.yaml` resolvers — **no new command shape**
3. Regenerate: `node .cursor/aaac/generate-graph.mjs && node .cursor/aaac/generate-commands.mjs`

### Contracts

Plugins may include `contract.yaml` beside `SKILL.md`. Central contracts: [`.cursor/aaac/contracts/`](../.cursor/aaac/contracts/). Schema: [`.cursor/aaac/contract-schema.md`](../.cursor/aaac/contract-schema.md)

### Release swarm (`release-app`)

Expert subagents run in **waves**, not one monolithic agent:

| Wave | Agents | Notes |
|------|--------|-------|
| 0 | Preflight typecheck (optional) | From intent, e.g. "with tests" |
| 1 | `release-git` | **Blocking** — must return `commit_sha` before wave 2 |
| 2 | `release-render` | Poll `ludecker-website` until `live`; smoke-check `/` |

Wiring: `graph.yaml` agents `release-*`. Orchestrator: [platform-release/orchestrator](../.cursor/skills/shared/platform-release/orchestrator/SKILL.md). DAG: [platform-release/SKILL.md](../.cursor/skills/shared/platform-release/SKILL.md).

### Regenerating commands

```bash
pnpm aaac:generate
```

Or:

```bash
node .cursor/aaac/generate-graph.mjs
node .cursor/aaac/generate-commands.mjs
```

Ontology reference: [`.cursor/aaac/ontology.md`](../.cursor/aaac/ontology.md)
