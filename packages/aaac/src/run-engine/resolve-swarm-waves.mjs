#!/usr/bin/env node
/**
 * Split swarm target into waves when parallel count exceeds context budget per_agent_max.
 */
const DEFAULT_PER_AGENT_MAX = 0.08;
const ADVERTISED_CONTEXT = 128_000;

/**
 * @param {number} target
 * @param {{ estimatedPromptBytes?: number, perAgentMax?: number, phase?: string }} options
 * @returns {{ waves: number[], reason?: string }}
 */
export function resolveSwarmWaves(target, options = {}) {
  const count = Math.max(1, Number(target) || 1);
  if (count <= 1) return { waves: [1] };

  const perAgentMax = options.perAgentMax ?? DEFAULT_PER_AGENT_MAX;
  const maxParallel = Math.max(1, Math.floor(1 / perAgentMax));

  const estimatedBytes = options.estimatedPromptBytes ?? 0;
  const byteThreshold = Math.floor(ADVERTISED_CONTEXT * perAgentMax * 4);

  let maxWaveSize = Math.min(count, maxParallel);
  if (estimatedBytes > byteThreshold && maxWaveSize > 2) {
    maxWaveSize = Math.max(2, Math.floor(maxParallel / 2));
  }

  if (count <= maxWaveSize) {
    return { waves: [count] };
  }

  const waveList = [];
  let remaining = count;
  while (remaining > 0) {
    const wave = Math.min(remaining, maxWaveSize);
    waveList.push(wave);
    remaining -= wave;
  }

  return {
    waves: waveList,
    reason: count > maxWaveSize ? "context_budget" : undefined,
  };
}
