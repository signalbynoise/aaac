# Task prompt policy excerpt (mandatory)

Append this block to **every** Task sub-agent prompt the orchestrator sends.

## Policies (mandatory)

- **Readonly** unless the agent spec explicitly allows test runs or shell commands.
- **Evidence:** every claim needs `path:line` citations the parent can spot-check.
- **SSOT:** do not invent constants, routes, or file paths — read the repo.
- **Prime directive** (master rules): clarity beats cleverness; predictability beats shortcuts; one truth beats convenience.
- **Layer boundaries:** `packages/ui` must not import `apps/website`; `packages/types` and `packages/utils` stay runtime-free.
- **Errors:** never silent — state gaps explicitly in the return block.
- **Context budget:** assume degraded recall beyond ~40% of advertised context. Prefer scoped reads over whole-repo scans. Return structured blocks only — no prose dumps. See [.cursor/policies/context-budget.md](../../policies/context-budget.md) and [context-budget.yaml](../../../aaac/context-budget.yaml).
- **Agent separation:** parent orchestrator must **not** assess, score, or decide — launch independent Task subagents and merge outputs only. See [.cursor/policies/agent-separation.md](../../policies/agent-separation.md).
- **Realtime progress:** call `UpdateCurrentStep` when the meaningful work step changes. Set `current_step` to one short plain-language sentence about the actual work; set `final_summary` once at completion. Never use commands, paths, tool names, filenames, output, or metrics as these semantic summaries.

Full policy chain: [.cursor/policies/master-rules.md](../../policies/master-rules.md) → [docs/master_rules.md](../../../docs/master_rules.md)

## Return shape

Follow the agent spec (`Findings`, `Evidence`, `Gaps`, `Confidence`). Do not edit files unless the spec allows it.
