/**
 * Maximal Marginal Relevance selection.
 */
import { cosine } from "./index/hnsw.mjs";

/**
 * @param {Array<{ lessonId: string, score: number, meaningVector?: Float32Array|null }>} ranked
 * @param {number} k
 * @param {number} lambda
 */
export function selectMmr(ranked, k, lambda = 0.7) {
  const selected = [];
  const remaining = [...ranked];

  while (selected.length < k && remaining.length) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const s of selected) {
        if (cand.meaningVector && s.meaningVector) {
          maxSim = Math.max(maxSim, cosine(cand.meaningVector, s.meaningVector));
        } else if (cand.lessonId === s.lessonId) {
          maxSim = 1;
        }
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
