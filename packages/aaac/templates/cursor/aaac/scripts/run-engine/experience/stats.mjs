/**
 * Per-signature experience stats (verb|object|domain).
 */
import { isoNow } from "../lib.mjs";
import { avg, rollingAvg } from "./math.mjs";

export function signatureKey(manifest) {
  const verb = manifest.verb ?? "unknown";
  const object = manifest.object ?? "_";
  const domain = manifest.domain ?? "_";
  return `${verb}|${object}|${domain}`;
}

export function updateExperienceStats(store, manifest, outcome) {
  const key = signatureKey(manifest);
  const metrics = manifest.metrics ?? {};
  const duration = metrics.duration_ms ?? null;
  const tokens = metrics.total_tokens ?? metrics.conversation_tokens ?? null;
  const agents = [
    ...(Array.isArray(manifest?.swarm?.agents) ? manifest.swarm.agents : []),
    ...Object.values(manifest?.swarm_history ?? {}).flatMap((p) =>
      Array.isArray(p?.agents) ? p.agents : [],
    ),
  ];
  const filesRead = agents.reduce(
    (s, a) => s + (Number(a?.files_read) || 0),
    0,
  );
  const utilization =
    manifest.swarm?.estimated_utilization ??
    avg(
      Object.values(manifest.context?.phases ?? {})
        .map((p) => p?.estimated_utilization)
        .filter((v) => typeof v === "number"),
    );

  const entry = store.signatures[key] ?? {
    verb: manifest.verb ?? null,
    object: manifest.object ?? null,
    domain: manifest.domain ?? null,
    runs: 0,
    successes: 0,
    failures: 0,
    partials: 0,
    avg_duration_ms: null,
    avg_tokens: null,
    avg_files_read: null,
    avg_context_utilization: null,
    total_gate_retries: 0,
    last_run_id: null,
    updated_at: null,
  };

  const prior = { ...entry };
  entry.runs += 1;
  if (outcome.status === "success") entry.successes += 1;
  else if (outcome.status === "failure") entry.failures += 1;
  else entry.partials += 1;

  const n = entry.runs - 1;
  entry.avg_duration_ms = rollingAvg(entry.avg_duration_ms, duration, n);
  entry.avg_tokens = rollingAvg(entry.avg_tokens, tokens, n);
  entry.avg_files_read = rollingAvg(
    entry.avg_files_read,
    filesRead > 0 ? filesRead : null,
    n,
  );
  entry.avg_context_utilization = rollingAvg(
    entry.avg_context_utilization,
    utilization,
    n,
  );
  entry.total_gate_retries += outcome.gate_retries ?? 0;
  entry.last_run_id = manifest.run_id;
  entry.updated_at = isoNow();
  store.signatures[key] = entry;
  return { key, prior, entry };
}
