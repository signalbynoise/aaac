# Model routing policy (v1)

Parent orchestrators must resolve Task model selection from the SSOT at `.cursor/aaac/model-routing.yaml` before launching each Task subagent.

- Resolve with `.cursor/aaac/scripts/run-engine/resolve-model-for-phase.mjs` using phase + agent spec + subagent type.
- Pass the resolved `model` slug on the Task tool call.
- Treat v1 as guidance + telemetry: mismatches are recorded but do not hard-block launches.
