# AMAdocs

**Ask your documents anything** — a private, local AI assistant for your files.

AMAdocs is a single downloadable desktop app (Windows / macOS / Linux) for **non-technical
people**. You drop in your documents — PDF, Word, Excel, PowerPoint, scanned pages, and more —
and ask questions about them in plain language. A local AI reads your files and answers, with
sources. **Everything stays on your computer.** Nothing is uploaded.

Think *"Obsidian, but it reads your files and you can talk to them"* — with none of the setup.

---

## ⭐ Phase 2 Reframe (2026-06-18) — Semantic file manager ("Finder++"); supersedes the drop-zone model

> **Full Phase 2 spec in `AMAdocs-PHASE2.md`.** This section is the summary entry point.

The pivot: AMAdocs becomes a **semantic file manager** — a desktop app that looks and behaves
like a file browser, with an AI layer built in. The drop-zone / collections model is retired as
the primary UX. The core insight that drives this: **GNOME LocalSearch already extracts full
text from your files continuously and for free.** AMAdocs' job is to add embeddings, summaries,
and an LLM on top — making the OS's existing index semantically queryable.

**Three-panel layout:**
- **Left** — file tree (real filesystem, navigable like Finder/Nautilus). Left-click a file →
  preview. Left-click a folder/drive → scopes the AI to that selection. Right-click → contextual
  options (Analyse with AI, Summarise, Prioritise, Save copy with AI notes, Show in file manager).
- **Middle** — two-mode content area. Folder selected → grid/list of files (like a real file
  manager). File selected → tabbed preview (PDF.js, image viewer, text — graceful "no preview"
  for unsupported types, showing file metadata + any available summary instead).
- **Right** — AI panel. File selected: summary card at top (auto-shown, acts as the AI
  "initialiser") + chat below scoped to that file. Folder/drive selected: chat does semantic
  search over that scope and returns files as results. Nothing selected: neutral search prompt.

**Top bar** — simple filename / keyword search (TinySPARQL FTS, instant, no LLM).

**The AI database is local and separate from the files.** LanceDB holds embeddings, summaries,
OCR text, vision captions. Files are never modified. "Save copy with AI notes" is an explicit
right-click export, not the default.

**Initial setup:** a one-shot pass over LocalSearch-indexed files in two phases:
1. Fast ONNX embedding (no LLM — minutes to ~an hour). Semantic search works after this.
2. Background LLM summary generation (slower, runs quietly over hours). Summaries fill in
   progressively. Images and scanned docs are excluded from auto-indexing — on-demand via
   right-click "Analyse with AI" only. After setup: incremental maintenance via GNOME
   LocalSearch's inotify monitoring. Honest upfront messaging: "Building your index — semantic
   search ready shortly, summaries fill in over the next few hours."

**What survives from Phase 1:** TinySPARQL bridge + gnome-sync, safe ingest queue (serial /
durable / STOP), all file viewers, grounded citation loop, aiSummary, vision captioning, OCR,
LanceDB embeddings + retrieval, API auth, session scoping.

**What is new:** file tree UI, folder browser (middle panel), file preview tabs, right panel
summary card + scoped chat, top search bar, setup/onboarding screen, background indexing
cadence scheduler, chat results as file links (folder mode) vs. answers (file mode).

**LanceDB schema bug (#1 open from Phase 1)** is resolved by elimination: in the new model
everything goes through the gnome-sync path. There is one doc producer. Mixed-schema problem
disappears.

---

## ⭐ Reframe (2026-06-15) — read this first; supersedes parts of the framing below

A non-coding reframing session settled a new, more honest direction. The sections below are the
*older* "polished product for non-technical users" pitch and will be folded into a forthcoming
**VISION.md**; until then, this is the current intent.

**1. What this actually is — "an experiment that may have legs."** AMAdocs was born from a
conviction that an AI-enabled OS is round the corner and *semantic search over your own machine and
files* becomes a defining feature — plus a personal itch to build something real with local AI on my
own laptop. It started as an experiment and became this. We frame it as exactly that: not a finished
product, not a toy — an experiment I think has legs. Rough edges are the spec, not bugs.

**2. Who the ALPHA is for — technical early adopters.** Linux / privacy / self-hoster / Ollama folks
who find it on AUR + GitHub, expect a GPU, tolerate rough edges, and file issues. Non-technical
zero-config users remain the long-term *destination* (VISION), **not** the alpha bar. So GPU-required,
needs-Ollama, and AUR are honest specs here, not failures.

**3. The product's center of gravity MOVED — it's an AI *librarian* now. ✅ THE SWAP IS BUILT (2026-06-15).**
- **Default = catalog every file (bounded, safe):** drop files → each one gets a ~120-word AI
  summary (or image caption) + useful metadata embedded back into the file. You get value the instant
  you drop, even on weak hardware. No unbounded work. *(Built: summary-on-by-default at ingest, and
  only that summary card is embedded for search — see `AMAdocs-DEV-NOTES.md` → "The swap".)*
- **Opt-in = deep semantic search (the novel bet):** full-document embedding + the grounded
  click-to-source citation loop happens **per file, on request** — **right-click → "🔍 Deep search"**
  (or the hover pill on a cataloged file). This is the interesting part and where the differentiator
  lives — it's the *payoff*, not the default. *(Built: `POST /doc-deep-search` re-embeds the full
  file in place; UI wired. Not yet live-eyeballed end-to-end.)*
- **Ship and let the use cases evolve.** Expose the capabilities, don't over-prescribe (forensic
  accountants indexing scanned docs; people wanting AI metadata baked into their files; etc.).

**4. THE #1 RULE — don't kill their machine.** Locking up a user's machine (especially small
hardware) is unethical. Since summary-as-default means an AI burst per file, the ingest path must be
gentle: **bounded work per file (8000 chars / 120 words) · strict serial queue (one file at a time) ·
deliberate cool-downs between items · a durable queue that resumes at relaunch · an honest upfront
banner ("N files queued — large batches can keep your machine busy for hours; stop anytime") · a hard
global STOP button that instantly suspends ALL AI activity.** "Responsible by design + a kill switch"
is a trust feature, said out loud. *(Designed this session; not built yet.)*

---

## 🧭 Direction sharpening (2026-06-16) — ride on what the OS already does

> **✅ STATUS (end of 2026-06-16): BUILT & PROVEN END-TO-END, and productionized into the engine.**
> The bridge reads GNOME's OS-extracted text → AMAdocs embeds it → real semantic queries return
> grounded answers with source attribution. Incremental delta-sync (re-embed only new/changed/deleted
> files) works, and bridged docs are first-class for the citation/viewer loop. It's now an engine
> endpoint (`POST /workspace/:slug/gnome-sync`), not just CLI tooling. The bridged-doc citation render
> was **eyeballed live and fixed (2026-06-17)** — it exposed a real bug (the passage highlight latched
> onto page boilerplate for any citation deeper than page 5, because flat bridged text has no page
> anchor) which is now fixed (scan-all-pages + cluster-hardened matcher). The **UI/Electron folder-sync
> flow is now BUILT & EYEBALLED LIVE (2026-06-17)** — a sidebar "📂 Sync a folder" button → native picker
> → pick an existing/new collection → an honest dryRun banner ("200 now, 429 more, stop anytime") → live
> progress counter + a Continue button + a STOP button; all driven live in the running app against the real
> 648-doc OS index, including a mid-sync STOP that halts the batch and keeps only the confirmed docs
> (THE #1 RULE, proven through the UI). Remaining: the cadence scheduler (resume pending on relaunch) and
> (cosmetic) the `p.N` citation label for bridged docs (needs poppler page-ranges). Full detail in
> `AMAdocs-DEV-NOTES.md` → "CURRENT PHASE (2026-06-16)" + "⚠️ FINDING (2026-06-17)" + "✅ BUILT + EYEBALLED LIVE (2026-06-17)".

A follow-on investigation tightened the bet further. The OS desktop indexer on Linux/GNOME —
**LocalSearch** (the filesystem miner, formerly Tracker-miners) storing into **TinySPARQL** (the
RDF/SPARQL store, formerly Tracker3) — **already crawls your files and extracts their full text +
metadata**, idle-aware and system-wide. That's exactly the heavy "index the whole disk without
melting the laptop" problem AMAdocs deliberately *didn't* want to own (see the parked AI Finder).

So the refined thesis: **AMAdocs is the semantic + AI-answer layer that exploits what the OS is
already silently doing** — read the OS-extracted text, add embeddings + the grounded
citation/answer loop, and only do AMAdocs' own heavier work (OCR, image vision, and formats the OS
mis-handles) for the gaps. Proven on a real 1.1G / 805-doc folder: the OS extracted **648 docs /
~19.8M chars in seconds**, for free. Two honest caveats this surfaced: (a) on a **non-GNOME**
desktop (e.g. this Arch + Hyprland box) the indexer is installed but **dormant** — AMAdocs must
turn it on and own it, not just read it; (b) the OS index has **silent blind spots** (a third-party
office suite's mime override made it skip every Office file with no error; no OCR; keyword-only
search) — which is precisely the seam where AMAdocs adds value. Architecture chosen:
**ride-on-TinySPARQL hybrid.** Technical detail + the working bridge in
`AMAdocs-DEV-NOTES.md` → "CURRENT PHASE (2026-06-16)".

---

## Who it's for

- **Students** — drop in a textbook, ask it questions ("explain photosynthesis from chapter 4").
- **Admin / records** — dump a pile of documents (invoices, contracts, reports, scanned
  letters, spreadsheets) and ask "what did we agree in the X contract?" or "find the March invoice."

The differentiator vs. existing tools (AnythingLLM, GPT4All, Jan, Khoj): **zero configuration.**
The user never sees the words "model," "embedder," or "vector database."

---

## How it works (in plain terms)

1. You **drag documents** onto the window.
2. AMAdocs **reads and indexes** them on your machine (incl. OCR for scanned pages).
3. You **ask questions**; a local AI answers using *your* documents and shows which file it used.
4. **Collections** (like Obsidian vaults) keep different sets of documents separate — e.g.
   *Homework* vs *Admin* — so each stays small, fast, and relevant.

---

## What's built so far ✅

- **The engine works end-to-end, fully offline.** Drop a file → it's read, indexed, and
  answerable. Verified with documents whose answers exist *only* in the file.
- **Librarian-by-default + opt-in Deep search (the reframe swap, 2026-06-15).** Dropping files now
  **catalogs** them — each gets a ~120-word AI summary and only that gist is embedded for search, so
  the AI can find any file cheaply the instant you drop it. **Right-click → "🔍 Deep search"** (or the
  hover pill) upgrades one file to full-text semantic search + the grounded passage-citation loop.
  *(Built; not yet live-eyeballed E2E — see `AMAdocs-DEV-NOTES.md` → "The swap".)*
- **One self-contained desktop app.** A single launch starts the AI, the document processor,
  and the database, then shows the interface — in its own window (its own bundled Chromium,
  like Obsidian). No browser, no dev servers, nothing external.
- **The interface** ("drop your documents" + chat) — confirmed the right direction.
- **Document viewer** — click a document to read it in a pane beside the chat (Obsidian-style).
- **Reads:** PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint, text, Markdown, EPUB, images,
  email archives, audio (transcribed) — **with OCR** for scanned documents.
- **Local AI:** runs on your computer's GPU; ~1 second per answer once warm. (A GPU is
  recommended — all performance numbers are GPU-based.)
- **Straight-to-the-point answers.** AMAdocs is a *search tool, not a chatbot* — answers are
  hard-capped at about a paragraph (~120 words). You get the answer and the source, not an essay
  about your own documents.
- **Choose your AI model** — a built-in picker swaps between installed local models, and a
  "Get another model" screen downloads more (curated permissive models, with a progress bar).
  Lets a stronger machine opt into a bigger/newer model; all still 100% on-device.
- **Export a photo with its info (v2)** — take any image back out of AMAdocs as a small bundle:
  the original photo (untouched) plus a readable sidecar file holding the AI's description, any
  text found in it, the photo's original camera details (date, device), and where it came from.
  The AI's understanding of your picture travels *with* the file.
- **Sees your images (v2)** — a local vision model describes photos, whiteboards, receipts and
  screenshots, so picture files are searchable by *what's in them*, not just any text they
  contain. Text-less images are no longer dropped. (Optional download: "Image understanding,"
  Moondream/Apache-2.0; runs on-device like everything else.)

## What's left ⬜

- **Linux AppImage — BUILT & verified end-to-end ✅ (2026-06-14).** One self-contained
  `.AppImage` boots fully offline and does ingest + vision + chat. *(Windows `.exe` / macOS
  `.dmg` still need those OSes or CI runners.)* See `PACKAGING.md`.
- **First-run model download** with a friendly progress screen — ✅ **BUILT (2026-06-14).**
  A clean install now opens a "Welcome to AMAdocs" setup screen that downloads the AI (and,
  opt-in, image understanding) with a progress bar before first use; the reactive in-chat
  "Download your AI…" prompt remains as a fallback. See `PACKAGING.md`.
- **Collections switcher** in the UI (the engine already isolates them).
- **About → Licenses** screen + `THIRD_PARTY_LICENSES` file.
- Polish: pixel-perfect PDF rendering (keep originals). *(Concise answers: done — hard ~120-word cap.)*
- **GitHub repo + download page.** *(parked)*

---

## After build 1 — main focus: OCR + text analysis

Once build 1 ships, the priority is **making AMAdocs read messy, real-world documents better** —
the core of the product's value. Clean printed text is already near-perfect (Tesseract); the
headroom is in **photographed/scanned docs (deskew, dewarp, auto-crop, denoise), layout & tables,
handwriting, and stronger search** — kept light + permissive by default, anything heavy opt-in.
See `AMAdocs-DEV-NOTES.md` → "Post-build-1 priority" for the ranked, licensing-aware plan.

---

## Potential companion apps (ideas, not started)

The same local-AI + semantic-index foundation could spin out into companion products:

- **Image/photo AI analysis indexer** — run local vision/embedding models over a
  photo or image library, extract content + metadata, and build a **vector index** so the
  user can search photos by what's *in* them (and by metadata) instead of by filename.
- **AI Finder — semantic hard-drive search** *(the bigger bet)*. Point it at a
  folder/drive; it indexes everything (docs, images, etc.) into a semantic index and gives
  the user **natural-language search across their whole disk** — "find that contract from
  spring," "the photo with the whiteboard" — all 100% local. Effectively a private,
  on-device alternative to cloud drive/photo search.

Both reuse AMAdocs' core (local models, ingestion/OCR, embeddings, vector store) and the
same zero-config, privacy-first stance. AI Finder is the most ambitious — a whole-disk
semantic index is a larger build (incremental indexing, scale, file-system watching) than
the per-collection model AMAdocs uses today.

**Settled scope (2026-06-13): AMAdocs stays a discrete, focused tool.** A once-considered
Finder-ish extension — accepting a *folder* as a drop target (folder → semantic-searchable
collection, one-shot) — has been **parked and taken off the AMAdocs roadmap (2026-06-14:
"too many pitfalls")**: the lock-up/OOM risk and the safety machinery it needs make it a
different problem shape, likely a separate product. AMAdocs remains drop-files-and-ask.

**Whole-drive semantic search is explicitly out of scope.** Doing it *properly* is
OS-integration territory (filesystem change feeds, idle-time indexing, permissions/sandbox,
surfacing in the system search bar) — a platform feature, and the OS vendors (Apple
Spotlight, Windows search) are the natural owners and already moving toward on-device
semantic indexing. Not a third-party app's fight. (So: not a swiss-army-knife app and not a
separate Finder app — just folder-as-input on the one focused tool.)

---

## Licensing (for open-source release)

- **AMAdocs ships under the MIT license.** Code is clean to open-source, commercial use included.
- Built on permissive components: **AnythingLLM** (MIT engine), **Ollama** (MIT, local AI runner),
  **Electron** (MIT), local embedder & OCR (Apache 2.0).
- **Default AI model: Phi-3.5-mini (MIT)** — deliberately chosen so the whole product is
  freely usable. (The earlier prototype model, Qwen2.5-3B, was research/non-commercial only.)
- Requirements: keep upstream copyright notices and ship a `THIRD_PARTY_LICENSES` file. With
  permissive models, **no "I accept" checkbox is needed** — just attribution + an About screen.

See **`AMAdocs-DEV-NOTES.md`** for architecture and how to run it.
