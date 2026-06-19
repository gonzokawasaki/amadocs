---
name: k-base-companion-apps
description: "Potential companion-app ideas reusing the AMAdocs local-AI core (image indexer, semantic drive search)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 49bfa49d-389c-4987-8071-1796042065e4
---

Companion-app ideas captured 2026-06-13 for the [[k-base-project]] foundation (local models + ingestion/OCR + embeddings + vector store). Not started — recorded as direction, noted in `K-base.md` under "Potential companion apps."

- **Image/photo AI analysis indexer** — local vision/embedding models over a photo library; extract content + metadata into a vector index so photos are searchable by what's in them (+ metadata), not just filename.
- **AI Finder — semantic hard-drive search** *(the bigger bet)*: point it at a folder/drive, index everything (docs, images) into a semantic index, give natural-language search across the whole disk, 100% local. A private on-device alternative to cloud drive/photo search.

AI Finder is the most ambitious — whole-disk index needs incremental indexing, scale, file-system watching, beyond AMAdocs' per-collection model. Aligns with the [[k-base-modes-direction]] "finder-first" framing.

**SETTLED scope (2026-06-13), after working through swiss-knife-vs-separate-app and per-folder framings:** AMAdocs stays a **discrete, focused tool**. Not a swiss-army-knife, not a separate Finder app. The only Finder-ish extension worth doing is **"drop a folder"** → produces a semantic-searchable collection. It's a minor extension of existing drag-drop (folder → collection), not new architecture. MVP = one-shot "index this folder"; a live file-watcher for sync is optional/later, not required — which sidesteps whole-disk move-tracking entirely.

**Whole-drive semantic search = explicitly OUT of scope.** Doing it properly needs OS integration (filesystem change feeds, idle indexing, permissions/sandbox, system-search-bar surfacing) — a platform feature owned by OS vendors (Apple Spotlight, Windows search), who are already moving to on-device semantic indexing. Not a third-party app's fight.

(Earlier reasoning, now superseded by the above: the retrieval core ports as-is so a per-folder watched-directory Finder *could* be a feature of AMAdocs; that's the same conclusion at smaller ambition. CPU-perf risk [[k-base-dev-environment]] compounds with index size, reinforcing bounded scope.)

**AI image analysis (vision captioning) — scoped 2026-06-13, BUILD NEXT SESSION.** Decided to bolt the photo-indexer idea *into* AMAdocs rather than as a separate app. Assessed as small/additive: local model runtime (Ollama, supports vision) + text→embed→retrieve→cite pipeline already exist; a caption is just text → flows through unchanged, zero engine changes. Gap: `collector/processSingleFile/convert/asImage.js` does OCR only and *rejects text-less images* (`asImage.js:21`). Plan: add a vision-caption step (POST image base64 to Ollama `/api/generate` with `images:[…]`), use OCR+caption combined, stop failing text-less images. Model must be Apache/MIT (catalog allowlist) → **Moondream2 ~1.8B Apache-2.0** fits 3.5GB VRAM; LLaVA/Llama-3.2-Vision are Llama-licensed (avoid). ~1–2 collector files + catalog entry. Real cost = vision inference speed/VRAM, not eng; needs background/queued ingest. Full detail in `AMAdocs-DEV-NOTES.md` → "Planned: AI image analysis".
