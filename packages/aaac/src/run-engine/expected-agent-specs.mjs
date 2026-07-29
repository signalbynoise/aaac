import { AAAC_ROOT, CURSOR_ROOT } from "./lib.mjs";
import { extractRoleInitialSummary } from "./agent-progress-contract.mjs";
import {
  readAgentSpecContent,
  resolveAgentSpecsForPhase,
} from "./swarm-agent-specs.mjs";

function targetCountForPhase(manifest, phase) {
  const target = Number(manifest.swarm?.target_agents?.[phase]);
  return Number.isFinite(target) && target > 0 ? target : null;
}

function expectedEntry(spec, cursorRoot) {
  const initialSummary = extractRoleInitialSummary(
    readAgentSpecContent(cursorRoot, spec.relPath),
  );
  if (!initialSummary) {
    throw new Error(`Agent spec ${spec.id} has no valid Role summary`);
  }
  return { id: spec.id, path: spec.cursorPath, initial_summary: initialSummary };
}

export function resolveExpectedAgentSpecs(
  manifest,
  {
    phase = manifest.phase,
    aaacRoot = AAAC_ROOT,
    cursorRoot = CURSOR_ROOT,
  } = {},
) {
  if (!phase) return [];
  return resolveAgentSpecsForPhase({
    aaacRoot,
    phase,
    manifest,
    count: targetCountForPhase(manifest, phase),
  }).map((spec) => expectedEntry(spec, cursorRoot));
}

export function applyExpectedAgentSpecs(manifest, options = {}) {
  manifest.swarm = manifest.swarm ?? {};
  const phase = options.phase ?? manifest.phase ?? null;
  const expected = resolveExpectedAgentSpecs(manifest, { ...options, phase });
  manifest.swarm.expected_agent_specs = expected;
  manifest.swarm.expected_specs_phase = phase;
  return expected;
}
