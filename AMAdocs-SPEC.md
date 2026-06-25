# Coracle — Product Spec: Semantic File Manager

> The canonical product spec. Overview in `K-base.md`; engineering log in `AMAdocs-DEV-NOTES.md`.
>
> **Coracle** (formerly *AMAdocs*) — a coracle is a small, light, single-person boat you carry to the
> water and that carries you across it: the theme for a lightweight, private, personal vessel for
> navigating your own documents. Product language leans on the metaphor (*navigate / chart / waters*).
> Rename is branding-only so far — runtime identifiers stay `amadocs-*`; see the DEV-NOTES rename entry.

---

## The idea in one sentence

Don't ask users to bring files to the app — go to the files instead. A file manager that
already understands what's in everything.

The browser is the primary interface; the AI is infrastructure. You browse the real
filesystem, and the AI catalogs, summarises, and answers questions about what you select.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  [🔍 Search files by name _____________________________________]      │
├──────────────────┬───────────────────────────────┬───────────────────┤
│  FILE TREE       │  CONTENT AREA                 │  AI PANEL         │
│                  │                               │                   │
│  💾 Home         │  [Folder view]                │  📄 lease-2024    │
│  ├ 📁 Documents  │  or                           │  PDF · 12p · 2MB  │
│  │  ├ 📄 lease   │  [File preview tabs]          │  ─────────────    │
│  │  └ 📁 Work    │                               │  🧠 Summary       │
│  ├ 📁 Photos     │  ┌────────┬────────┐          │  "12-month lease  │
│  ├ 📁 Downloads  │  │ file1  │ file2  │          │  for 23 Pemberton │
│  └ 💾 /dev/sdb   │  └────────┴────────┘          │  St. Rent         │
│                  │                               │  £1,200/month..." │
│                  │  <renders PDF / image /       │  ─────────────    │
│                  │   text / folder grid /        │  Ask about this   │
│                  │   "no preview">               │  file             │
│                  │                               │  ┌─────────────┐ │
│                  │                               │  └─────────────┘ │
└──────────────────┴───────────────────────────────┴───────────────────┘
```

### Left panel — File tree

- Real filesystem, rooted at Home by default. Drives shown as top-level nodes.
- Folders expand/collapse in the tree.
- **Left-click file** → preview opens in middle; AI panel shows that file's summary + chat.
- **Left-click folder/drive** → middle shows folder contents (grid/list); AI chat scopes to
  that folder.
- **Right-click** → contextual menu (see below).
- Visual status indicators per file: small icon overlay for indexed / unindexed / image-not-yet-analysed.

### Middle panel — Content area (two modes)

**Folder mode** (when a folder is selected in the tree):
- Grid or list of files, like a real file manager.
- Shows file icon, name, modified date, size.
- Indexed files show their `aiSummary` as a subtitle/tooltip.
- Clicking a file in this view opens it in preview mode (adds a tab).
- **Cover thumbnails (grid, built 2026-06-24).** Each grid card carries a **cover** above its summary card —
  a **legible top-left crop** of the document, not a shrunk-to-fit full page (*crop, don't scale*: the title /
  letterhead / opening line is what the eye recognises). Visual types (PDF, image) get a real raster cover;
  text-heavy types (Word, Markdown, spreadsheets, text/code) reuse the **existing live-HTML preview renderer**
  clipped to the tile — so there's no raster pipeline and no LibreOffice dependency for Office docs. Covers
  read straight off disk (the `readFile` bridge), so they render for **unindexed files too** (decoupled from
  indexing, like preview). HTML files render as an actual **sandboxed webpage** (scripts + network disabled),
  not raw source. Lazy (IntersectionObserver) + serial (one cover rendered at a time) + bounded (skip files
  >12 MB; clamp spreadsheet covers to a top-left block) so no single pathological file can freeze the UI.
  See `AMAdocs-DEV-NOTES.md` → "document COVER thumbnails". A **carousel** view (cover-flow over the same
  files) is the planned next mode.

**Preview mode** (when a file is selected):
- Tabbed — multiple files can be open simultaneously.
- Supported previews: PDF (PDF.js), images (image viewer + AI caption/OCR panel beneath),
  text/Markdown (text view), extracted text for Office/audio.
- **Preview is decoupled from indexing** (as of 2026-06-21): any local file previews straight
  from disk via the `window.amadocs.readFile` bridge, indexed or not — preview = "let me see it";
  indexing (caption/OCR/search) stays opt-in. The engine-backed extras (citation jump-to-page, the
  image caption/OCR panel, the "extracted text the AI reads" view) still require the file to be indexed.
- Unsupported types: show file icon + metadata panel (size, type, modified date, any
  LocalSearch-extracted text, aiSummary if available). Never a blank error — always something useful.

### Right panel — AI panel

Three states depending on selection:

**File selected:**
1. File metadata header (name, type, size, modified)
2. `aiSummary` card — auto-shown, generated on first selection if not cached. Shows spinner
   while generating. For unanalysed images: "Right-click → Analyse with AI to make this
   image searchable."
3. Chat input + conversation, scoped to that file. Uses LocalSearch-extracted text (or
   embedding retrieval for large files) as context. Returns answers with passage citations.
   **Summary-grounded (Option A, 2026-06-21):** file-scoped chat also prepends that file's
   `aiSummary` to the context as a "document overview" block. The summary is built from the
   title page + first ~5 pages (`DocSummary.leadingSlice`), so it gives the model whole-document
   orientation that pure similarity search misses — the title/opening pages rarely match a
   specific question and so are seldom retrieved. Added to context only, never as a citation.
   See `AMAdocs-DEV-NOTES.md`. (Option B — pinning the first N real chunks for a citable title
   page — is deferred pending how A performs on its own.)

**Folder/drive selected:**
1. Folder metadata (file count, indexed count, pending count)
2. Chat input + conversation, scoped to that folder. Returns **files as results** (not a
   synthesised answer) with snippets. Clicking a result opens the file in preview mode.
   **Retrieves over per-document SUMMARIES, not full-text chunks (decided 2026-06-21, evidence-backed).**
   Folder/drive/global ("breadth") scope searches one summary vector per document → one card per file,
   no duplicate-chunk domination, matching *what a doc is*. Chunk-level retrieval is reserved for **file
   scope** ("deep search" — click into a single document). An offline eval on a 40-doc folder showed
   summary-search beats current chunk-search on recall (0.93 vs 0.86 R@5) and kills the "random hits"
   scatter. The one weakness — exact rare terms the 120-word prose drops (e.g. "microbit") — is handled
   **inside the summary itself (2026-06-24):** the summariser now appends a `Keywords:` line of exact
   names/dates/codes/technical terms to each card, and that line is embedded with the rest, so those tokens
   are matchable without a separate lexical index. (A fused TinySPARQL-FTS + summary RRF leg was the earlier
   plan but the eval showed summary-only already wins, so it wasn't shipped.) See
   `AMAdocs-DEV-NOTES.md` → "Summariser" + "LLM search redesign". **Hard prerequisite — now being satisfied (2026-06-22):**
   summaries must exist for every indexed file. gnome-sync now summarises by default; the /STEM eval folder
   (40 docs) is backfilled and a full-778 backfill is in progress (~4h bounded cadence drain). Once complete,
   the breadth summary-search routing can be built on top.

**Nothing selected:**
1. Brief explainer: "Select a file to see its summary. Ask a question to search your files."
2. Chat input — searches the whole indexed filesystem. Like folder scope, this is a **breadth**
   query: it retrieves over per-document summaries (whose `Keywords:` line carries exact-term recall) and
   returns files-as-results, not chunk fragments.

### Top bar

- **Nav buttons (top-left): ⌂ Home / ‹ Back / › Forward.** Home opens the Homepage (below); Back/Forward
  walk a browser-style history over the middle panel's destinations (Home / folder / file). Built 2026-06-21
  (replaced the old decorative window-style dots) — see `AMAdocs-DEV-NOTES.md`.
- Simple filename / keyword search (TinySPARQL FTS — instant, no LLM, no embeddings).
- Separate from the AI chat. Answers the "find file named X" question; AI chat answers
  the "find files about X" question. Two distinct modes, clearly labelled.

### Homepage (the launch surface)

The app opens to a **Homepage** in the middle panel — the place we lean on to inform the user and offer
options, instead of cramming everything into menus. The ⌂ Home button always returns here. **v1 (lean,
2026-06-21):** a hero (name · version · tagline), a status-card grid (Index / Library / Model / Engine),
an indexed-folders list, and Quick actions (Browse my files · Index a folder… · Refresh). Fed by the
`/amadocs-status` endpoint's structured `data` (which also still writes the on-disk `AMADOCS-STATUS.md`).
Designed to grow: indexing progress + STOP on the Index card, a model picker on the Model card, per-folder
re-index/remove, onboarding.

**Tuning / Advanced panel (direction, 2026-06-21).** Because the audience is now explicitly the
tinkerer crowd (zero-config is no longer a goal — see `K-base.md`), the Homepage is the place to
**expose every tunable, the prompts, and the CSS for customisation**, each shown with our
recommended default + rationale ("these settings worked on a GTX 1650 Ti / granite4.1:3b — adjust
for your machine") and a Reset-to-recommended. Tunables, grouped: **prompts** — chat system prompt,
summary/cataloguing prompt, vision-caption prompt; **summary** — `MAX_PAGES` / `MAX_CHARS` /
`NUM_PREDICT` / temperature / summary model; **chat/retrieval** — answer length cap, temperature,
`similarityThreshold`, `topN`, rerank on/off, Option-A summary injection; **indexing** —
`EMBED_COOLDOWN_MS`, cadence interval, batch size; **appearance** — the theme `--*` CSS variables
(see the user-CSS / LLM-theming idea). Three engineering realities to design around: most are env
vars / hardcoded constants today (need a runtime settings store + a push path into the *collector*
process; the summary constants are duplicated in two `DocSummary` copies); the chat prompt has the
`openAiPrompt`-baking trap (must write through to the workspace, not just `saneDefault`); and changes
don't retro-apply (only new summaries reflect a new summary setting → pairs with a re-summarise action).
Recommended phasing: a read-only "here's what we use & why" card first, then live numeric knobs, then
editable prompts. See `AMAdocs-DEV-NOTES.md` and the next-session plan.

---

## Right-click menu

```
📄 any-file.pdf
├ 🔍 Analyse with AI      (OCR + vision caption — primary for images/scanned docs;
│                          available on all files as a "force re-analyse" option)
├ 🧠 Summarise            (generate or refresh aiSummary via LLM)
├ ⬆️  Prioritise           (move to front of background indexing queue)
├ 💾 Save copy with AI notes  (export file copy with summary/OCR/caption embedded
│                              as XMP metadata)
└ 📂 Show in file manager  (reveal in Nautilus)
```

Images and unanalysed files: "Analyse with AI" is shown more prominently (first item,
different icon) since without it they are invisible to the AI.

---

## AI database — local, separate from files

**LanceDB** holds all AI-generated data, keyed by file path:
- Embeddings (vectors for semantic search)
- `aiSummary` (the ~120-word catalog card + a `Keywords:` line of exact names/dates/codes/terms)
- OCR extracted text (for scanned docs / images)
- Vision captions (moondream descriptions of images)
- Index status and mtime (for incremental sync)

**Files are never modified.** The "Save copy with AI notes" right-click option is the
only path that writes AI data into a file — and it writes a copy, not the original.

---

## Initial setup

On first launch (or when a new drive/folder is added), a one-shot indexing pass runs. It is
presented as **one honest onboarding moment** — "AMAdocs is building your search index" — not
a piecemeal drip-feed. Under the hood it runs in two phases:

**Embedding pass (fast: minutes to ~1 hour depending on corpus size)**
- Reads LocalSearch-extracted text for all indexed files (no LLM, no Ollama).
- Computes embeddings using the native ONNX embedder (all-MiniLM-L6-v2).
- Writes to LanceDB. Semantic search is available after this phase.
- Safe queue: serial, cool-downs, durable, hard STOP — THE #1 RULE applies.

**Summary generation (slower: hours, background)**
- Runs the LLM (granite4.1:3b) to generate `aiSummary` per file.
- Strictly serial, cool-downs, pauses when machine is active (idle-aware).
- Summaries fill in progressively; the AI panel shows a spinner for unsummarised files.

**Images and scanned docs:** excluded from both auto-phases. On-demand only via
right-click "Analyse with AI". Rationale: vision inference is heavy; auto-running
moondream on 10,000 photos would violate THE #1 RULE.

**After setup:** incremental maintenance. GNOME LocalSearch's inotify monitoring detects
new/changed/deleted files. The gnome-sync delta path re-embeds only what changed. Cost
scales with changes, not corpus size.

---

## Reused engine components

The AMAdocs engine and its proven components are reused directly under the file-manager shell:

- **TinySPARQL bridge + gnome-sync** — the indexing backbone. `POST /gnome-sync` is the embed
  trigger; the file tree makes the folder the natural unit of organisation.
- **Safe ingest queue** — serial worker, cool-downs (EMBED_COOLDOWN_MS), hard STOP
  (stopAll / stopWorkspace), durable finalize-on-confirm, bounded batches + remaining.
- **All file viewers** — PDF.js, image viewer + caption/OCR panel, text view.
- **Grounded citation loop** — chunk → page → passage highlight. The differentiator; "jump to
  where in the document this came from" is even more natural in a finder context.
- **aiSummary** — generation, caching, on-demand refresh. Shown in the right panel automatically.
- **Vision captioning (moondream)** — right-click "Analyse with AI" on images.
- **OCR** — same, for scanned docs.
- **LanceDB embeddings + semantic retrieval** — scope filter (`sourcePath` / `filterIdentifiers`)
  drives the folder-scoped chat path.
- **API auth token gate**, **session scoping**, **`stripScaffolding()` + `capAnswer()`**.

## New UI build

- **File tree component** — real filesystem tree, left panel.
- **Folder browser view** — middle panel mode 1, with metadata + summary subtitles.
- **File preview tabs** — middle panel mode 2, reusing existing viewers.
- **Grid cover thumbnails** — clipped top-left crops per card; raster for PDF/image, clipped live-render for
  text-heavy types (reuses the preview renderers). Built 2026-06-24. **Carousel/cover-flow** view = next mode.
- **Right panel: summary card + scoped chat.**
- **Top search bar** — TinySPARQL FTS, separate from AI chat.
- **Onboarding screen** — one honest progress moment for initial indexing.
- **Background indexing cadence scheduler** — resumes pending work on relaunch, runs summary
  generation as a low-priority background task.
- **Chat result mode: files** — folder scope returns file links + snippets, not a synthesised answer.

---

## Resolved design decisions

1. **One global workspace (`amadocs-library`).** Folder-level scoping is a `sourcePath` path
   filter in LanceDB queries — not separate tables. Per-folder workspaces rejected as
   unnecessary complexity.

2. **One doc producer (gnome-sync).** Because everything flows through the gnome-sync path,
   the earlier mixed-schema LanceDB problem is moot. (The schema bug was also fixed directly
   via `withAmadocsSchema()` — see DEV-NOTES.)

## Virtual semantic folders (the AI abstraction layer) — IN BUILD 1 SHIP SCOPE

> ⭐ Flagship feature, **promoted into Build 1 ship scope (2026-06-23)** — the main remaining engineering
> before release. *"An abstraction layer for your hard drive built on AI."*
> The apex of the semantic-file-manager idea: not just understanding files, but **organising them by
> meaning** — the physical filesystem becomes a presentation layer, AI the organising principle underneath.

**Motivation.** Physical folders force ONE rigid hierarchy, but a document is semantically
multi-dimensional — a VEX-robotics newsletter sitting in `/Generated_Documents` is *also* "STEM",
"robotics", "Term 4". Folders can't express that; semantic views can. (Surfaced directly by the search
experiment — see `AMAdocs-DEV-NOTES.md`.)

**Why this is legitimate, not a gimmick.** The physical folder tree is *already* an abstraction. On an
SSD there is no physical "folder" — the flash controller scatters bytes across blocks, and the directory
hierarchy is itself just a metadata **index** the OS presents to make the bytes navigable. A semantic view
is therefore not fake organisation over "real" folders: **both are indexes over the same bytes.** The folder
tree is the OS's index; semantic folders are a meaning-based index beside it — there is no privileged "real"
structure, only indexes, and AMAdocs simply offers a smarter one.

**Tier 1 — Virtual "smart folders" (safe; this is what Build 1 ships).** Rendered in the left tree
*alongside* the real filesystem — like macOS Smart Folders / Gmail labels / playlists. **Files never move**
(each is a saved view over LanceDB), one file can appear in several groups, and it reuses the
summary-vector + `scopePath` machinery the search redesign already builds.

**Design (settled 2026-06-23) — classification, not clustering.** A small local model is a *classifier/router*,
not a generator (the same principle as the CSS-theming skill), so we don't ask it to invent clusters and
names from nothing. Instead:

- **Division of labour:** the **user owns the structure** (chooses folder names, starting from a simple
  *default structure*); the **AI owns the placement** (decides which file goes where); a few **optional,
  bounded questions** sharpen the edges.
- **Mechanism (zero-GPU, deterministic):** every smart folder is a named **anchor** (name + short
  description) embedded with the existing MiniLM embedder. Each document is assigned to its **nearest anchor**
  by cosine over its already-stored summary vector (argmax; a similarity floor → an automatic **Unsorted**
  folder). No clustering, no new model. **Editing re-flows live** — rename/retune a folder → re-embed that one
  anchor → files re-assign instantly.
- **The "questions" stay cheap and reuse the same primitive:** (a) folder-*intent* disambiguation up front
  (e.g. *"does 'Work' include study?"*) whose answer **enriches that folder's anchor description**; (b) a
  per-*file* tiebreak only on genuinely ambiguous files (top-two anchors near-tied) whose answer **pins** the
  file. Both are fully skippable — bare folder names auto-classify.
- **One unifying primitive:** a smart folder is `anchor` (semantic) | `query` (top-N) | `pinned` (manual), or
  a mix. So **Mode 1 (AI-automated)** = anchor folders the AI fills, **Mode 2 (user-edited)** = the user
  creates/curates any type, and the two are the same machinery.
- **Multiple structures + toggle:** the user can hold several named *structures* (each = a set of smart
  folders); the left panel is a **switchable lens** — real FS tree ↔ an AI structure ↔ the user's own
  structures — toggled at will. Both modes are reached from the Homepage "Smart Folders" card.
- **Engine delta:** the one new piece is scoping search by an explicit **`sourcePath` set** (`IN` / OR-list)
  rather than only the current `starts_with(prefix)`; plus a tiny anchor-embed + nearest-assignment util and a
  `virtual-folders.json` store. Optional unsupervised clustering ("let the AI discover groups") becomes a
  later add-on, not the default path.

**Tier 2 — Suggested physical reorganisation (powerful; opt-in, heavily guarded; much later).** Moving real
files collides with THE #1 RULE — it breaks Obsidian vault links, git repos, symlinks, and fights cloud
sync. If ever built: propose a plan → user reviews every move → execute with a manifest + one-click undo +
a hard denylist (`.git`, vaults, cloud-synced dirs, system paths). Non-destructive middle path: materialise
the semantic tree with **symlinks** (visible in Nautilus too, originals untouched).

**Sequencing (Build 1 finish line, 2026-06-23):** (1) **cull the demo corpus** to a curated keeper set;
(2) **re-summarise the keepers + eyeball the summary-vector breadth search live** (Recall@5 1.000 in the
harness, not yet verified in-app) — this populates the substrate virtual folders sit on; (3) **virtual
folders** (the design above); (4) **Homepage / UI polish**. Virtual folders is meaningless until every file
has a summary vector, hence steps 1–2 first.

## Roadmap — two builds (decided 2026-06-23)

AMAdocs is now planned as **two builds** so the model stack matches the hardware instead of fighting it:

- **Build 1 — "AMAdocs Lite" (near complete).** Targets modest machines like the 4 GB GTX 1650 Ti dev box.
  Keeps the current stack: **granite4.1:3b** (chat + summaries, 2.1 GB — fits with headroom), **moondream**
  (vision), **Tesseract** (OCR), **MiniLM** (embeddings). Finish line = the 4-step sequence above. **No Gemma.**
- **Build 2 — "AMAdocs" (next track, parked until Build 1 ships).** Consolidates the stack onto **one Gemma 4
  multimodal model** (chat + summaries + image analysis + a handwriting-OCR fallback), keeping Tesseract for
  verbatim printed scans and MiniLM for embeddings. Designed for an **~8 GB VRAM floor**, where the real
  candidate **`gemma4:e2b-it-qat`** (4.34 GB = 3.35 GB text weights + 0.99 GB vision projector, per the Ollama
  registry manifest) sits resident with both modalities + context headroom. It does **not** fit the 4 GB box
  (measured 3713 MiB free), which is exactly why the two builds are split. The earlier `e2b-it-q4_K_M` (7.2 GB)
  was the wrong tag. Gemma 4 is plain **Apache-2.0**, so it clears the MIT/Apache-only model-catalog gate that
  blocked Gemma 3. Full detail in `AMAdocs-DEV-NOTES.md`.

## Open questions

1. **Existing data migration.** If anyone is running an older drop-zone collection, it doesn't
   map to the folder-tree model. Likely: a migration note in the release; old LanceDB data stays
   queryable but is no longer surfaced the old way.

2. ✅ **The `p.N` citation label for bridged docs** — RESOLVED (2026-06-21) for backstop PDFs.
   `buildDoc` carries `asPDF`'s per-page char ranges through `materializeViaCollector`, so
   collector-backstop PDFs (scanned/OCR/empty-text) get `p.N` labels; GNOME-text PDFs stay label-less
   by design (would require re-parsing every PDF). Verified live on the 83-page scanned "Year 6 ICT"
   book (chips `p.11`/`p.18`). See DEV-NOTES.

3. **Name.** AMAdocs is the working name; "Finder++" was a candidate. To be decided before
   public release.
