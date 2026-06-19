---
name: k-base-retrieval-tuning
description: "K-base retrieval pipeline audit + tuning — reranker on, chunk overlap, vector-cache gotcha, hybrid absent"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf03c327-5af9-45d4-a52e-195934d3e4a0
---

Retrieval audit + tuning for the real product objective: "re-find a specific fact in a messy pile" (extractive recall, not chat). Work done 2026-06-13. The concept→wording semantic bridge is the **embedder**'s job, not the LLM — so retrieval is the lever and the LLM can stay small (see [[k-base-product-direction]], [[k-base-model-picker]]).

Fork's retrieval = pure cosine vector search (`lance/index.js`), topN=4, threshold 0.25. Findings + what was changed:
- **Cross-encoder reranker already existed but was OFF** (`Xenova/ms-marco-MiniLM-L-6-v2`, gated on `workspace.vectorSearchMode`, schema default `"default"`). Turned **on** for all 3 dev workspaces (`vectorSearchMode='rerank'`); applies to existing embeddings immediately; model pre-fetched to `storage/models/` (works offline).
- **Chunk overlap was effectively 20** (RecursiveCharacterTextSplitter, chunkSize 1000). Set `text_splitter_chunk_overlap=200` system setting — **only affects newly-ingested docs**.
- **Embedder swap is config-only** (not an integration): `nomic-embed-text-v1` already supported as a stronger bridge; just select + re-ingest.
- **Hybrid keyword/BM25 search is ABSENT** — pure vector, so exact anchors (part numbers, codes) are smeared. The one lever that's a real build, not a toggle. But the reranker is strongly anchor-aware, so it may already cover much of this — measure before building.

**Gotcha — vector cache:** `addDocumentToNamespace` reuses `storage/vector-cache/<digest>.json` keyed by file content, so re-importing the same file ignores new chunk settings. Cleared it (moved to `vector-cache.bak-*`) for clean re-chunk testing. Changes are dev-DB config (uncommitted), DB backed up to `anythingllm.db.bak-*`.

Lever ranking (effort vs payoff): reranker (free, done) > chunk overlap (setting, done) > stronger embedder (config + re-ingest) > hybrid keyword (real build, not started).
