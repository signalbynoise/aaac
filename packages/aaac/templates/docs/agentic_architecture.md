# Agentic Architecture as Code (AAAC)

## In one sentence

> **Commands are the public API. Skills, agents, tools, rules, and documentation are private implementation details.**

You express intent; the architecture determines execution.

Installed by [{{PROJECT_NAME}}](https://ludecker.com) — generic AAAC kernel for Cursor.

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
| Domain | Which bounded context | `api` |
| Intent | Goal in plain language | `"Add pagination to list endpoint"` |

### Commands (AAAC v1)

| Command | When to use |
|---------|-------------|
| `update-module` | Change an existing bounded module |
| `update-doc` | Update architecture documentation (no code) |
| `create-feature` | Add a new capability |
| `fix-bug` | Fix broken behavior |
| `review-module` | Quality/architecture review (no code) |
| `review-incident` | Investigate deploy or production issue |
| `test-module` | Test and verify a module |
| `test-function` | Test a user journey |
| `release-app` | Phased release (git → deploy) |

Verb×object matrix commands (`create-component`, `check-schema`, …) route through shared verb orchestrators. See [`.cursor/aaac/ontology.md`](../.cursor/aaac/ontology.md).

### Examples

```text
/update-module api "Add rate limiting middleware"
/fix-bug "Checkout fails on empty cart"
/update-doc architecture "Document domain boundaries"
/review-module api "Check layer boundaries and size budgets"
/test-function "Sign-up to welcome email journey"
/release-app production "Ship with typecheck"
```

### What you should not need to know

skill, agent, subagent, tool, workflow, graph, orchestrator — infrastructure only.

---

## Part 2 — Appendix (maintainers)

### Install and regenerate

```bash
npx @ludecker/aaac@latest init
# or
pnpm dlx @ludecker/aaac@latest init
```

After changing ontology or project wiring:

```bash
npx @ludecker/aaac@latest generate
# or
pnpm dlx @ludecker/aaac@latest generate
```

### Adding a product domain

1. Create `.cursor/domains/<slug>/update/orchestrator/` (SKILL.md + contract.yaml)
2. Create `.cursor/domains/<slug>/update/inventory/` (file map + constraints)
3. Add resolver entries to `.cursor/aaac/graph.project.yaml`
4. Add `command_overrides` to `.cursor/aaac/ontology.json` if slug-based routing is needed
5. Regenerate graph and commands (see above)

### Responsibility layers

Full map: [`.cursor/aaac/layers.md`](../.cursor/aaac/layers.md)

```text
User Layer          → Commands
Control Layer       → Ontology, Dispatch, Graph
Lifecycle Layer     → work phases (lifecycle.json)
Governance Layer    → gate stacks (gates.json), policies, fitness
Run Layer           → Run manifest (state + observability)
Execution Layer     → Orchestrators, pipeline skills, capabilities, agents
Contracts Layer     → command + skill contracts
Knowledge Layer     → {{DOCS_ROOT}}/
```

**SSOT:** [`.cursor/aaac/graph.yaml`](../.cursor/aaac/graph.yaml)

**Dispatch:** [`.cursor/aaac/dispatch.md`](../.cursor/aaac/dispatch.md)

### Directory layout

```text
.cursor/
  commands/          # thin routers (public)
  aaac/              # ontology, graph, generators config
  domains/<slug>/update/
    orchestrator/
    inventory/
  skills/shared/     # pipeline + verb orchestrators
  agents/            # subagent prompt specs
  policies/          # inherited governance
{{DOCS_ROOT}}/
  agentic_architecture.md
  master_rules.md    # your project rules (create if missing)
  architecture.md    # your system map (create if missing)
```

### Release swarm (`release-app`)

Wave 1: `release-git` (blocking). Configure deploy agents in `graph.project.yaml` for your host.

Orchestrator: [`.cursor/skills/shared/platform-release/orchestrator`](../.cursor/skills/shared/platform-release/orchestrator/SKILL.md)
