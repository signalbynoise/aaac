/**
 * OpenAI-compatible remote embeddings.
 * Env: AAAC_EMBEDDING_API_KEY, AAAC_EMBEDDING_BASE_URL (optional), AAAC_EMBEDDING_MODEL
 */
import { createHashProvider } from "./hash.mjs";

/**
 * @param {{ model: string, dims: number, apiKey?: string, baseUrl?: string }} opts
 */
export function createRemoteProvider(opts) {
  const {
    model,
    dims = 384,
    apiKey = process.env.AAAC_EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl = process.env.AAAC_EMBEDDING_BASE_URL ?? "https://api.openai.com/v1",
  } = opts;
  const fallback = createHashProvider(dims);

  return {
    id: "openai",
    model,
    dims,
    async embed(texts) {
      if (!apiKey) {
        throw new Error("remote embeddings require AAAC_EMBEDDING_API_KEY or OPENAI_API_KEY");
      }
      const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`remote embed failed: ${res.status} ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const rows = (json.data ?? []).sort((a, b) => a.index - b.index);
      return rows.map((row) => {
        const v = Float32Array.from(row.embedding);
        // OpenAI dims may be 1536 — truncate/pad to configured dims for index compatibility
        if (v.length === dims) return v;
        const out = new Float32Array(dims);
        out.set(v.subarray(0, Math.min(dims, v.length)));
        let norm = 0;
        for (let i = 0; i < dims; i += 1) norm += out[i] * out[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dims; i += 1) out[i] /= norm;
        return out;
      });
    },
    embedSync(texts) {
      return fallback.embedSync(texts);
    },
  };
}
