/**
 * Derive run outcome from manifest signals (not LLM judgment).
 */

export function deriveOutcome(manifest) {
  const status = manifest.status;
  const gateResults = manifest.gates?.results ?? {};
  const gateFails = Object.values(gateResults).filter(
    (r) => r === "fail" || r?.result === "fail" || r?.status === "fail",
  ).length;
  const gatePasses = Object.values(gateResults).filter(
    (r) => r === "pass" || r?.result === "pass" || r?.status === "pass",
  ).length;

  let outcomeStatus = "partial";
  if (status === "completed" && gateFails === 0) outcomeStatus = "success";
  else if (status === "failed" || status === "cancelled") outcomeStatus = "failure";
  else if (status === "completed" && gateFails > 0) outcomeStatus = "partial";

  const log = Array.isArray(manifest.log) ? manifest.log : [];
  const humanInterventions = log.filter(
    (e) =>
      e?.event === "human_approval_received" ||
      e?.event === "human_approval_required" ||
      e?.decision === "user_approved",
  ).length;

  const rollbackUsed = Boolean(
    manifest.artifacts?.rollback ||
      log.some((e) => String(e?.detail ?? "").toLowerCase().includes("rollback")),
  );

  const gateRetries = log.filter((e) => e?.event === "gate_fail").length;

  return {
    status: outcomeStatus,
    quality: outcomeStatus === "success" ? 1 : outcomeStatus === "partial" ? 0.5 : 0,
    gate_retries: gateRetries,
    rollback_used: rollbackUsed,
    human_interventions: humanInterventions,
    gate_passes: gatePasses,
    gate_failures: gateFails,
  };
}
