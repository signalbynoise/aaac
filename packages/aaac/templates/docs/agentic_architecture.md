# Agentic Architecture as Code (AAAC)

## In one sentence

> **Commands are the public API. Skills, agents, tools, rules, and documentation are private implementation details.**

You express intent; the architecture determines execution.

---

## Part 1 — For everyone

### Get started

1. **Install** — `npx @ludecker/aaac@latest init` (or `pnpm dlx @ludecker/aaac@latest init --yes`)
2. **Open in Cursor** — Settings → **Hooks** → enable → restart Cursor
3. **Run a command** — graph and slash commands are already generated; no manual `generate` step

`init` also writes **`.cursor/aaac/state/install-sweep-report.md`** — a read-only inventory of project docs, Cursor rules, and AAAC framework markdown, with recommendations only (no merges).

Optional later: add **domain slugs** and `.cursor/domains/<slug>/` for project-specific routing (Part 2).

### What you do

> **Call a command. The system figures out the rest.**

```text
/<verb>-<object> [domain] "<intent>"
```

| Part | Meaning | Example |
|------|---------|---------|
| Command | Kind of work | `update-module` |
| Domain | Optional bounded area | `payments` (only when your overlay defines slug resolvers) |
| Intent | Goal in plain language | `"Add webhook retry with idempotency key"` |

Without a domain overlay, commands route to **generic verb orchestrators** (`verb-create`, `verb-update`, `verb-fix`, …) — enough to create, fix, check, and review work in any repo.

### Common commands

| Command | When to use |
|---------|-------------|
| `create-module` | Add a new bounded module or package |
| `update-module` | Change existing module behavior |
| `fix-module` / `fix-bug` | Repair something broken (fix-bug: domain optional) |
| `check-module` | Validate or inspect (readonly) |
| `review-module` | Architecture / quality review (readonly) |
| `review-incident` | Investigate production or deploy issue |
| `test-module` / `test-function` | Verify behavior |
| `update-doc` | Update architecture documentation (no code) |
| `release-app` | Phased release swarm (git push + deploy steps) |

See [`.cursor/aaac/ontology.md`](../.cursor/aaac/ontology.md) for the full verb × object matrix (~130 commands).

### Examples (generic)

```text
/create-module api "Add health check endpoint"
/update-module auth "Refresh session TTL configuration"
/fix-bug payments "Webhook handler drops events on retry"
/check-module billing "Confirm idempotency on duplicate events"
/review-module core "Check layer boundaries and module size budgets"
/test-function checkout "Verify cart → pay → confirmation journey"
/update-doc architecture "Document service boundaries"
/release-app production "Ship with typecheck and smoke test"
```

### Deprecated (still work one release)

| Old | New |
|-----|-----|
| `/ship-ludecker` | `/release-app` |
| `/module-update` | `/update-module` |
| `/architecture` | `/update-doc` |
| `/swarm-check` | `/review-incident` or `/fix-bug` |
| `/refactor` | `/review-module` |

### Reference: [Lüdecker](https://ludecker.com) (optional domain overlay)

The [Lüdecker monorepo](https://github.com/eriklydecker/ludecker) adds slug resolvers (`cms`, `ui`, `database`, `aaac`) and domain orchestrators under `.cursor/domains/`. That pattern is **not** required for a fresh install — copy it when you want bounded-context routing like `/update-module cms "…"`.

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
  skills/<project>/  # optional project-specific object skills
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
→ Work: Execute → Test execute → Verify → Review swarm → Report
```

**Agent separation (create / update / fix):** production code in `execute`; tests in `test_execute` (separate test-author agent); readonly review swarm before report. Hooks enforce path scopes via `enforcement.json` `phase_edit_scopes`.

**Work lifecycles** (SSOT: [`.cursor/aaac/lifecycle/lifecycle.json`](../.cursor/aaac/lifecycle/lifecycle.json)):

| Verb | Work | Gate stack |
|------|------|------------|
| create | discover → investigate_lite → plan → execute → test_execute → verify → review_swarm → report | pre_execute |
| update | same | pre_execute |
| fix | discover → investigate_swarm → root_cause → plan → execute → test_execute → verify → review_swarm → report | pre_execute |
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
| verify | fix-repro-verify, unit-test-run, fallow-check-changed | **3** (all mutating verbs) |
| test_execute | test-author | **1** |
| review_swarm | boundary-review, doc-conformance, implementation-review | **3** |

Skills: [investigation/SKILL.md](../.cursor/skills/shared/investigation/SKILL.md), [testing/SKILL.md](../.cursor/skills/shared/testing/SKILL.md), [test-authoring/SKILL.md](../.cursor/skills/shared/test-authoring/SKILL.md), [implementation-review/SKILL.md](../.cursor/skills/shared/implementation-review/SKILL.md).  
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

**Runtime behavior:** At dispatch and before `execute`, `promotion-rules.json` `runtime` section is evaluated — `deprecated` blocks execute; `experimental` on `critical`/`protected` objects requires user approval; low `success_rate` or `avg_fitness` triggers approval. Set `capability_runtime_approved: true` on the Run after user approves.

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
