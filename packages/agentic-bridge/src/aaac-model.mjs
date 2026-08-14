/**
 * Resolve the Cursor CLI model for an AAAC phase.
 * Grok 4.6 variants only — composer picker / CURSOR_MODEL cannot override.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { createLogger } from "./logger.mjs";
import { computeWorkspacePaths } from "./aaac-status.mjs";
import {
  DEFAULT_AAAC_MODEL_SLUG,
  isAllowedAaacModelSlug,
} from "@ludecker/aaac/run-engine/load-model-routing";

const log = createLogger("agentic-bridge:aaac-model");

export { DEFAULT_AAAC_MODEL_SLUG, isAllowedAaacModelSlug };

export async function resolveAaacPhaseModel(
  workspaceRoot,
  { phase, agentSpecId, subagentType } = {},
) {
  const fallback = DEFAULT_AAAC_MODEL_SLUG;
  if (!workspaceRoot) {
    log.warn("resolve", "No workspace root; using Grok 4.6 fallback", { fallback });
    return fallback;
  }

  process.env.AAAC_WORKSPACE_ROOT = path.resolve(workspaceRoot);
  const { runEngineDir } = computeWorkspacePaths(workspaceRoot);
  const script = path.join(runEngineDir, "resolve-model-for-phase.mjs");

  let slug = null;
  if (fs.existsSync(script)) {
    try {
      const mod = await import(pathToFileURL(script).href);
      const resolved = mod.resolveModelForPhase({
        phase,
        agent_spec_id: agentSpecId,
        subagent_type: subagentType,
      });
      slug = resolved?.model_slug ?? null;
    } catch (error) {
      log.warn("resolve", "Workspace model routing failed; using Grok 4.6 fallback", {
        phase,
        error: String(error),
        fallback,
      });
      return fallback;
    }
  }

  if (isAllowedAaacModelSlug(slug)) {
    log.debug("resolve", "Resolved Grok 4.6 phase model", { phase, model: slug });
    return slug;
  }

  log.warn("resolve", "Rejected non-Grok or missing phase model", {
    phase,
    slug,
    fallback,
  });
  return fallback;
}
