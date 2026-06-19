---
name: k-base-project
description: K-base — single-installer local-AI document app being built by forking AnythingLLM
metadata: 
  node_type: memory
  type: project
  originSessionId: 71d9d256-6219-4be6-968a-1c599f54fb4e
---

Working product name: **AMAdocs** (AMA = "Ask Me Anything" + docs; user proposed 2026-06-12). Working dir still `/mnt/space/k-base`. North-star UX: ONE installer + a window whose primary action is literally dragging documents onto it — first screen "Drop your documents here", second screen a chat box. All technical bits (Ollama, embeddings, vector DB) stay invisible. Treat any feature a non-technical person can't grasp in 10 seconds as a bug.

Building AMAdocs: a downloadable desktop app (Win/macOS/Linux) for *non-technical* users — like Obsidian but with a local AI + file indexer. User drops in files (PDF, Word, Excel, scanned docs) → searchable local DB → query in natural language via a local LLM. Two target use-cases: (1) study companion (drop a grade-10 textbook, ask it questions), (2) admin archives (search/query piles of documents incl. scanned PDFs needing OCR). Fully offline/local, privacy-first. The differentiator vs existing tools (AnythingLLM, GPT4All, Jan, Khoj) is **zero-config simplicity** — the user never sees "model", "embedder", or RAG knobs.

**Strategy = Path A (fork) + slice of Path B (wrapper):** Fork **AnythingLLM** (MIT, fully open source, very active — v1.14.0 Jun 2026). Upstream cloned at `/mnt/space/k-base/anythingllm-upstream`.
- Free from fork: ingestion (PDF/DOCX/XLSX/EPUB/img/audio via `collector/`), OCR (`tesseract.js`), local ONNX embeddings, LanceDB vector store, RAG chat, frontend.
- **Must build ourselves (NOT in the open-source repo):** (1) the single-installer **Electron desktop shell** — the public repo is the web/Docker app running 3 Node services (`server`,`collector`,`frontend`); Mintplex's desktop wrapper is closed. (2) **Embedded LLM** — repo only *connects* to Ollama/LM Studio; we must bundle a local LLM (Ollama sidecar or node-llama-cpp) + first-run model download.
- Also strip telemetry and bundle the CDN-hosted embedder/reranker ONNX models for true offline.

Distribution: **open source on GitHub**, installers shipped as **GitHub Releases** assets (.exe/.dmg/.AppImage/.deb). No domain/website for now (user confirmed 2026-06-12). License AMAdocs as **MIT** (must retain AnythingLLM's MIT notice regardless). Later concern (Phase 4): unsigned installers trigger "unknown developer" warnings on Win/macOS — smooth before wide release; Linux unaffected.

Stack chosen: Electron + TypeScript (same family as Obsidian). Standalone app, NOT an Obsidian plugin. Dev machine: Arch Linux, Node 26, Rust 1.96, NVIDIA GTX 1650 Ti (4GB) + 15GB RAM.

Open decision: LLM delivery — bundle Ollama as silent sidecar vs embed node-llama-cpp. See [[k-base-llm-delivery]] once decided.
