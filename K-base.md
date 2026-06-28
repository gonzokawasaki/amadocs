# Coracle — Product Overview

> The entry-point doc: what Coracle is, who it's for, and the core bet.
> Detailed product spec in `Coracle-SPEC.md`. Engineering log in `Coracle-DEV-NOTES.md`.

---

## What it is

**Coracle is a private, local AI file browser** — a desktop file manager that already
understands what's inside your files. You browse your real filesystem (like Finder/Nautilus),
and a local AI can summarise any file, answer questions about it, and show you the exact page
its answer came from. Everything stays on-device. Nothing is uploaded.

The product's center of gravity is the **file browser**, not chat. The AI is infrastructure
built into the browser, not the foreground.

## The core bet — ride on what the OS already does

The hard part of "semantic search over your whole disk" is crawling and extracting text from
every file without melting the machine. On Linux/GNOME the OS **already does this**:
**LocalSearch** (the filesystem miner) continuously extracts full text + metadata into
**TinySPARQL** (the RDF/SPARQL store), idle-aware and system-wide, for free.

So Coracle doesn't own the crawl. It **rides on the OS index**: reads the OS-extracted text,
adds embeddings + AI summaries + the grounded answer/citation loop on top, and only does its
own heavier work (OCR, image vision, formats the OS mishandles) for the gaps.

Proven on a real 1.1 GB / 805-doc folder: the OS extracted 648 docs / ~19.8M chars in seconds.
Two honest caveats this surfaced: the OS index has **blind spots** (no OCR, keyword-only
search, occasional mime-override skips) — which is exactly the seam where Coracle adds value —
and the integration is **GNOME-first** (see below).

## What's different

- **Grounded visual citations** — click a citation → jump to the actual page of the actual
  document → passage highlighted. The differentiator; no other local tool does this well.
- **The OS does the crawling** — no unbounded whole-disk indexing of our own.
- **Responsible by design (THE #1 RULE)** — never lock up the user's machine. Bounded work per
  file, a strictly serial queue, cool-downs, a durable queue that resumes at relaunch, an honest
  upfront banner, and a hard global STOP that suspends all AI activity. Said out loud as a trust
  feature.
- **Zero cloud** — everything on-device.

## Who it's for

Coracle is for **technical Linux users who like to play with their tools** — privacy /
self-hoster / Ollama folks who find it on AUR + GitHub, expect a GPU, tolerate rough edges,
and file issues. This is an "experiment that may have legs," not a finished product — rough
edges are the spec, not bugs.

**Zero-config is no longer the destination (decided 2026-06-21).** The earlier framing — a
non-technical user who never sees the words "model," "embedder," or "vector database" — is
dropped. We are catering to a tinkerer audience who *want* the knobs: every tunable, the
prompts, and even the CSS are exposed for customisation (each with a recommended default and
a note on what worked on our machine — see the Homepage "Tuning" direction in `Coracle-SPEC.md`).
GPU-required, needs-Ollama, and GNOME-first are honest specs for this audience, not failures.

## The shape (see `Coracle-SPEC.md` for the full spec)

A three-panel desktop app:
- **Left** — file tree (real filesystem). Click a file → preview; click a folder → scope the AI.
- **Middle** — folder view (grid/list) or tabbed file preview (PDF.js, image viewer, text).
- **Right** — AI panel: the selected file's summary card + a chat scoped to the selection.
  Folder scope returns files as results; file scope answers about that file with citations.
- **Top bar** — instant filename/keyword search (TinySPARQL FTS, no LLM), separate from AI chat.

One global workspace (`amadocs-library`); folder-level scope is a `sourcePath` path filter in
LanceDB, not separate tables. Files are never modified — all AI data (embeddings, summaries,
OCR text, vision captions) lives in a separate local database.

**Onboarding** is one upfront indexing pass, clearly explained: a fast ONNX embedding pass
(semantic search ready in minutes) with LLM summaries filling in afterward in the background.
After that, incremental maintenance tracks file changes.

## What's built

- Engine end-to-end, fully offline: index → chat with grounded answers + clickable citations.
- The "ride on GNOME" loop: TinySPARQL bridge → embed → semantic query, with incremental
  delta-sync (new/changed/deleted). Engine endpoint `POST /workspace/:slug/gnome-sync`.
- The Phase 2 semantic-file-manager UI, wired to the real engine (live file tree, AI state
  chips, folder indexing, scoped chat, context-menu actions). See `Coracle-DEV-NOTES.md`.
- Safe ingest queue (serial, cool-downs, durable, hard STOP) — proven live through the UI.
- AI summaries, vision captioning (moondream), OCR; model picker (MIT/Apache models only);
  metadata-embed export; API auth token gate; session-scoped chat.

## Stack & licensing

- **AnythingLLM** (MIT, RAG engine) + **Ollama** (MIT, local LLM) + **Electron** (MIT, shell) +
  native embedder/OCR (Apache-2.0). Coracle itself ships **MIT**.
- **Default model: granite4.1:3b** (Apache-2.0) — cleaner output than phi3.5. The model catalog
  is MIT/Apache-only by policy.
- GPU recommended; ~1s warm query on a GTX 1650 Ti dev machine.

See `Coracle-DEV-NOTES.md` for architecture and how to run it.
