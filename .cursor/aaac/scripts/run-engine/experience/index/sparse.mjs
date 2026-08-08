/**
 * BM25-lite sparse retrieval over lesson texts + tags + paths.
 */
function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 1);
}

/**
 * Build an in-memory inverted index from lessons.
 * @param {Record<string, object>} lessons
 */
export function buildSparseIndex(lessons) {
  /** @type {Map<string, Map<string, number>>} */
  const inverted = new Map();
  /** @type {Map<string, number>} */
  const docLen = new Map();
  let totalLen = 0;
  let docCount = 0;

  for (const lesson of Object.values(lessons)) {
    if (!lesson?.id) continue;
    const text = [
      lesson.id,
      lesson.lesson,
      lesson.problem,
      lesson.solution,
      ...(lesson.tags ?? []),
      ...(lesson.avoid_paths ?? []),
      ...(lesson.appliesWhen ?? []),
      ...(lesson.doesNotApplyWhen ?? []),
    ].join(" ");
    const tokens = tokenize(text);
    docLen.set(lesson.id, tokens.length);
    totalLen += tokens.length;
    docCount += 1;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      if (!inverted.has(term)) inverted.set(term, new Map());
      inverted.get(term).set(lesson.id, count);
    }
  }

  const avgDl = docCount ? totalLen / docCount : 1;

  return {
    search(queryText, k = 16) {
      const qTokens = tokenize(queryText);
      if (!qTokens.length || !docCount) return [];
      const scores = new Map();
      const k1 = 1.2;
      const b = 0.75;
      for (const term of qTokens) {
        const postings = inverted.get(term);
        if (!postings) continue;
        const df = postings.size;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        for (const [docId, tf] of postings) {
          const dl = docLen.get(docId) ?? 1;
          const denom = tf + k1 * (1 - b + b * (dl / avgDl));
          const score = idf * ((tf * (k1 + 1)) / denom);
          scores.set(docId, (scores.get(docId) ?? 0) + score);
        }
      }
      return [...scores.entries()]
        .map(([lessonId, score]) => ({ lessonId, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}
