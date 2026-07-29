import { formatAgentMetricsDetail } from "@ludecker/aaac/run-engine/swarm-telemetry";

export {
  diffLogPhaseEvents,
  logEntryToPhaseEvent,
} from "./phase-event-contract.mjs";
export { formatAgentMetricsDetail };

/** @deprecated Agent usage must come from measured telemetry. */
export function estimateUsageMetrics() {
  return { tokens: null, context: null };
}
