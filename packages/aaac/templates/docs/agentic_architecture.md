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
| Domain | Which area (optional until you add domains) | `payments` |
| Intent | Goal in plain language | `"Add idempotency key to webhook handler"` |

### Command matrix (ships with every install)

AAAC generates ~130 commands from **8 verbs × 12 objects**:

| Verb | Meaning | Example |
|------|---------|---------|
| `create` | Add something new | `/create-module api "Add rate limiter"` |
| `update` | Change existing | `/update-component ui "Extract Button variants"` |
| `fix` | Repair broken behavior | `/fix-module auth "Session expires on refresh"` |
| `review` | Readonly quality check | `/review-architecture system "Check layer boundaries"` |
| `check` | Readonly capability trace | `/check-module api "Can we add OAuth?"` |
| `test` | Run verification | `/test-module api "Contract tests for webhooks"` |
| `release` | Ship to production | `/release-app production "Ship v2.1.0"` |
| `remove` | Delete safely | `/remove-module legacy "Drop v1 export path"` |

**Exception commands** (dedicated orchestrators):

| Command | When to use |
|---------|-------------|
| `update-doc` | Update architecture documentation (no code) |
| `review-module` | Quality/architecture review (no code) |
| `review-incident` | Investigate production or deploy issue |
| `test-function` | Test a user journey end-to-end |
| `release-app` | Phased release swarm (git → deploy) |
| `fix-module` / `fix-bug` | Full fix swarm — domain optional until you add resolvers |

### Out of the box — no setup after install

Install copies everything you need. Open the project in Cursor and run commands.

- ~130 slash commands and the full shared pipeline (discover → plan → execute → verify → report)
- Generic `master_rules.md` and `architecture.md` in your docs folder — **already filled in**, not empty stubs
- Hook scripts and Run lifecycle under `.cursor/`
- Generic capability registry (shared skills only)
- **No** project domains required; **no** app build gate until you opt in (`verify.enabled: false` in `project.config.json`)

You do **not** need to enable hooks manually, write rules, add domains, or configure a stack before your first command.

### Optional — when you want more (any stack)

1. Replace or extend `docs/master_rules.md` and `docs/architecture.md` with team-specific detail
2. Add `domains/<slug>/update/` (orchestrator + inventory) — see Part 2
3. Extend `graph.project.yaml` with resolvers and project skills
4. Enable verify in `project.config.json` when you have a web app to gate:

```json
{
  "verify": {
    "enabled": true,
    "app_root": "apps/web",
    "index_html": "apps/web/index.html",
    "build": { "command": "pnpm", "args": ["--filter", "web", "build"] }
  }
}
```

### Examples (generic)

```text
/create-module billing "Add invoice PDF export"
/update-component ui "Tokenize spacing scale"
/fix-module api "Webhook signature validation fails on chunked bodies"
/review-module billing "Check SSOT for tax rates"
/test-function checkout "Guest can complete purchase"
/release-app staging "Deploy with migration"
/update-doc architecture "Document event bus boundaries"
```

### What you should not need to know

skill, agent, subagent, tool, workflow, graph, orchestrator — infrastructure only.

### Reference implementation

[Lüdecker](https://ludecker.com) dogfoods AAAC with `cms`, `ui`, `database`, and `aaac` domains. That overlay lives in the Lüdecker repo — not in the generic npm template.

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
| Domain orchestrators | Domain coordination (you add these) |
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

**SSOT:** [`.cursor/aaac/graph.yaml`](../.cursor/aaac/graph.yaml) (generated — edit `graph.project.yaml` instead)

**Dispatch procedure:** [`.cursor/aaac/dispatch.md`](../.cursor/aaac/dispatch.md)

### Directory layout

```text
.cursor/
  commands/          # thin routers (public)
  aaac/
    graph.project.yaml # your overlay (resolvers, orchestrators)
    graph.yaml         # generated wiring
  domains/<slug>/update/
    orchestrator/    # what happens
    inventory/       # what exists
  skills/shared/     # framework pipeline
  skills/<project>/  # your object-capability skills (optional)
  agents/            # subagent prompt specs
  policies/          # rules all skills inherit
```

### Generic kernel vs project overlay

| Layer | Location | Owner |
|-------|----------|-------|
| Generic kernel | `@ludecker/aaac` npm templates | Package maintainers |
| Project overlay | `.cursor/aaac/graph.project.yaml`, `ontology.json`, `project.config.json` | Your repo |
| Domains | `.cursor/domains/<slug>/` | Your repo |

Regenerate after ontology or overlay edits:

```bash
npx @ludecker/aaac@latest generate
```

### Orchestrator vs inventory

| | Orchestrator | Inventory |
|--|--------------|-----------|
| Question | What should happen? | What exists? |
| Updates when | Workflow changes | After every code-changing `update-module` |

### Execution determinism (create / update / fix)

**Work lifecycles** (SSOT: [`.cursor/aaac/lifecycle/lifecycle.json`](../.cursor/aaac/lifecycle/lifecycle.json)):

| Verb | Work | Gate stack |
|------|------|------------|
| create | discover → investigate_lite → plan → execute → verify → report | pre_execute |
| update | same | pre_execute |
| fix | discover → investigate_swarm → root_cause → plan → execute → verify → report | pre_execute |
| release | execute → verify → report | release |

**Gate stacks** (SSOT: [`.cursor/aaac/governance/gates.json`](../.cursor/aaac/governance/gates.json))

### Capability registry

Objects declare capabilities in ontology; providers resolve from [`.cursor/aaac/capabilities/registry.json`](../.cursor/aaac/capabilities/registry.json):

```text
object → capability → provider (skill | mcp)
```

Replace generic shared-skill providers with project skills as you mature.

### Run (primary execution object)

**SSOT:** [`.cursor/aaac/run/schema.json`](../.cursor/aaac/run/schema.json), [`.cursor/aaac/run/RUN.md`](../.cursor/aaac/run/RUN.md)

### Adding a product domain

1. Add `domains/<slug>/update/` (inventory + orchestrator)
2. Add resolver entries to `graph.project.yaml` — **no new command shape**
3. Regenerate: `npx @ludecker/aaac@latest generate`

See [module-authoring/SKILL.md](../.cursor/skills/shared/module-authoring/SKILL.md).

### Release swarm (`release-app`)

Wave 1: `release-git` (blocking). Add deploy agents in your overlay (e.g. `release-render`, `release-k8s`) — generic template ships git only.

### Regenerating commands

```bash
npx @ludecker/aaac@latest generate
```

Ontology reference: [`.cursor/aaac/ontology.md`](../.cursor/aaac/ontology.md)
