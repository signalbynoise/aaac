/**
 * Canonical retrieval document from Run manifest (+ workspace hints).
 */

/**
 * @param {object} manifest
 * @param {{
 *   avoidPaths?: string[],
 *   recentFailures?: string[],
 *   tools?: string[],
 *   language?: string,
 *   frameworks?: string[],
 * }} [hints]
 * @returns {{ doc: object, text: string }}
 */
export function buildTaskDocument(manifest, hints = {}) {
  const tools = hints.tools ?? ["shell", "filesystem", "git"];
  const doc = {
    action: manifest.verb ?? "",
    object: manifest.object ?? "",
    phase: manifest.phase ?? "",
    intent: typeof manifest.intent === "string" ? manifest.intent : "",
    repository: manifest.domain ?? "",
    language: hints.language ?? "",
    frameworks: hints.frameworks ?? [],
    paths: hints.paths ?? [],
    recentFailures: hints.recentFailures ?? [],
    availableTools: tools,
    avoidPaths: hints.avoidPaths ?? [],
  };

  const lines = [
    `action: ${doc.action}`,
    `object: ${doc.object}`,
    `phase: ${doc.phase}`,
    `repository: ${doc.repository}`,
  ];
  if (doc.language) lines.push(`language: ${doc.language}`);
  if (doc.frameworks.length) lines.push(`frameworks: ${doc.frameworks.join(" ")}`);
  if (doc.paths.length) lines.push(`paths: ${doc.paths.join(" ")}`);
  lines.push(`intent: ${doc.intent}`);
  for (const f of doc.recentFailures) {
    lines.push(`recent failure: ${f}`);
  }
  for (const p of doc.avoidPaths) {
    lines.push(`avoid path: ${p}`);
  }
  lines.push(`tools: ${doc.availableTools.join(" ")}`);

  return { doc, text: lines.join("\n") };
}
