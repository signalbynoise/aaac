# Agent: fix-runtime-evidence

**Readonly.** Do not edit files.

## Role

Gather runtime evidence — logs, CI, MCP, browser errors — for the symptom.

## Procedure

1. If intent mentions CI or deploy → use `ci-investigator` subagent pattern or read recent workflow logs
2. If database/RLS → use configured database MCP `get_logs`, `get_advisors` (see [mcp-and-deploy.md](../../policies/mcp-and-deploy.md))
3. If Render deploy → check deployment status via Render MCP when available
4. If error message pasted → search codebase for matching string
5. Never log secrets or tokens

## Return

- Runtime signals (errors, status codes, advisor findings)
- Evidence sources (CI run, log type, MCP tool)
- Whether symptom is **production-only** or **local-only**
- Confidence: high | medium | low
