---
name: k-base-image-analyser
description: v2 feature
metadata: 
  node_type: memory
  type: project
  originSessionId: a911f228-dfb2-4705-850e-2b1a6d78d21d
---

v2 feature wave #1 of 3 (ordered: image analyser → OCR quality → AI Finder folder index) — **image analyser BUILT & live-verified 2026-06-13**.

Local vision model captions images so text-less photos/whiteboards/receipts/screenshots become searchable by content. Caption is plain text → flows through existing embed/retrieve/cite pipeline, zero engine changes.

What was built:
- `collector/utils/VisionCaption/index.js` (new) — POSTs image base64 to Ollama `/api/generate`; best-effort (returns null on any failure, never breaks ingest); resolves Ollama URL via `OLLAMA_BASE_PATH`→`OLLAMA_HOST`→default so it works in dev stack AND packaged app (collector only sees OLLAMA_HOST, not BASE_PATH).
- `asImage.js` rewritten — OCR + caption in parallel, combined into pageContent; **only fails if BOTH empty** (was: rejected text-less images at line 21).
- `collectorApi/#attachOptions()` — new `vision:{model,ollamaBasePath}` block (mirrors `ocr` block). `VISION_MODEL_PREF=moondream` + `OLLAMA_BASE_PATH` added to `collector/.env` + `start-stack.sh`.
- Catalog (`workspaces.js` AMADOCS_MODEL_CATALOG): `moondream` (Apache-2.0, ~1.7GB, `type:"vision"`). Downloadable but hidden from chat picker (`HIDDEN_MODELS` += moondream/llava/bakllava) and `pullModel` doesn't switch chat to it (branches on `m.type==="vision"`). LLaVA/Llama-3.2-Vision excluded — Llama-licensed.

Verified: moondream pulled; VisionCaption gave accurate description of `test-docs/test-graphic.png` (~10s cold / <1s warm GPU); asImage returned success+combined content. **Full data-path E2E now verified 2026-06-13** (`vision-test` workspace, query/phi3.5): upload-and-embed text-less shapes graphic → caption (12.84s) + OCR indexed; OCR alone gave only `® I` so it's answerable ONLY via caption; stream-chat "what shapes/colours?" answered yellow circle/green rectangle/red triangle and cited the file — caption→embed→retrieve→cite proven. Answer echoed moondream's caption quirks (verbatim "blue sky/clouds", "top right"), confirming grounding in caption text not raw image. STILL not run: literal in-browser citation-highlight render (= the existing "needs human eyeball" item for the citation loop, not vision-specific).

Open: "dump 100 photos" still needs background/queued ingest w/ progress (uploads serial today). CPU caption latency part of open CPU-perf unknown. Build catalog doubles as chat-picker source — that's why vision models need the HIDDEN_MODELS guard. See [[k-base-model-picker]], [[k-base-companion-apps]].