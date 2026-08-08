# AAAC experience corpus

Packaged priors for the Execution Experience layer, plus retrieval configuration for the semantic experience graph (retrieval-first).

- `global-lessons.json` — evidence-backed lessons shipped with `@ludecker/aaac`
- `packaged-index/` — **precomputed collective vectors** (portable JSON) so fresh npm installs retrieve out of the box
- `retrieval.yaml` — HNSW / hybrid retrieval constants and ranking weights
- Project-local stores live under `state/lessons.json`, `state/experience-stats.json`, `state/workspace-memory.json` (not published)
- Local overlay index: `state/experience-index/` (seeded from `packaged-index/` on first use; not published)

## Retrieval

There is **no keyword fallback**. Every install ships the public corpus + vectors; retrieval is always hybrid vector search.

At `prepare-phase-context`, AAAC seeds the local index from `packaged-index/` if empty, builds a canonical task document, embeds it once, and retrieves via:

1. Dense HNSW / cosine search (multi-vector slots: meaning / trigger / failure / remedy)
2. Sparse BM25-lite lexical search
3. Reciprocal rank fusion
4. One-hop graph expansion (`SIMILAR_TO`, `CONTRADICTS`, …)
5. Outcome-aware weighted rerank + MMR + contradiction filtering

Top lessons are injected into `phase_context.experience` (default ≤5). Agents never see embeddings or index internals.

### Embedding providers

| Provider | Env | Notes |
|----------|-----|--------|
| `hash` (default) | `AAAC_EMBEDDING_PROVIDER=hash` | Deterministic offline vectors — **matches shipped `packaged-index/`** |
| `local` | `AAAC_EMBEDDING_PROVIDER=local` | MiniLM via `@huggingface/transformers`; rebuild local index after switching |
| `openai` | `AAAC_EMBEDDING_PROVIDER=openai` + `AAAC_EMBEDDING_API_KEY` | OpenAI-compatible `/embeddings`; rebuild after switching |
| `stub` | `AAAC_EMBEDDING_PROVIDER=stub` | Alias of hash for CI |

Publish / refresh the collective index after editing `global-lessons.json`:

```bash
node .cursor/aaac/scripts/run-engine/rebuild-experience-index.mjs --packaged
```

Rebuild the local overlay after changing provider/model:

```bash
node .cursor/aaac/scripts/run-engine/rebuild-experience-index.mjs --provider local
```

Promote lesson candidates with:

```bash
node .cursor/aaac/scripts/run-engine/export-global-lesson-candidates.mjs
```

## Engine modules (keep imports narrow)

Implementation: `.cursor/aaac/scripts/run-engine/experience/`

| Module | Use when |
|--------|----------|
| `select.mjs` | Preparing phase context (read priors) |
| `retrieve.mjs` | Hybrid vector retrieval (used by select) |
| `process.mjs` | Completing / rejecting a Run (write experience + index upsert) |
| `export.mjs` | Promoting lessons to npm corpus |
| `experience-evidence.mjs` | CLI facade only |
| `rebuild-experience-index.mjs` | Full index rebuild |

Do not load the barrel from swarm prompts — agents should read compact `phase_context.experience` only.
