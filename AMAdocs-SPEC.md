# AMAdocs — Product Spec: Semantic File Manager

> The canonical product spec. Overview in `K-base.md`; engineering log in `AMAdocs-DEV-NOTES.md`.

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
   scatter; a fused **lexical (TinySPARQL FTS) + summary via RRF** leg lifts recall further (0.95) as a
   safety net for exact rare terms the 120-word summary doesn't echo (e.g. "microbit"). See
   `AMAdocs-DEV-NOTES.md` → "LLM search redesign". **Hard prerequisite — now being satisfied (2026-06-22):**
   summaries must exist for every indexed file. gnome-sync now summarises by default; the /STEM eval folder
   (40 docs) is backfilled and a full-778 backfill is in progress (~4h bounded cadence drain). Once complete,
   the breadth summary-search routing can be built on top.

**Nothing selected:**
1. Brief explainer: "Select a file to see its summary. Ask a question to search your files."
2. Chat input — searches the whole indexed filesystem. Like folder scope, this is a **breadth**
   query: it retrieves over per-document summaries (+ optional RRF lexical leg) and returns
   files-as-results, not chunk fragments.

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
- `aiSummary` (the ~120-word catalog card)
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

## Future direction — Virtual semantic folders (the AI abstraction layer)

> ⭐ Flagship future feature (2026-06-21). *"An abstraction layer for your hard drive built on AI."*
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

**Tier 1 — Virtual "smart folders" (safe; build first).** Cluster the per-document summary vectors
(k-means / HDBSCAN), have the local LLM name each cluster ("STEM resources", "Student grade reports",
"Exam papers"), and render the clusters as virtual folders in the left tree *alongside* the real
filesystem — like macOS Smart Folders / Gmail labels / playlists. **Files never move** (it's a saved query
over LanceDB), one file can appear in several semantic groups, and it reuses the summary-vector +
`scopePath` machinery the search redesign already builds — nearly free once summaries-by-default exists.

**Tier 2 — Suggested physical reorganisation (powerful; opt-in, heavily guarded; much later).** Moving real
files collides with THE #1 RULE — it breaks Obsidian vault links, git repos, symlinks, and fights cloud
sync. If ever built: propose a plan → user reviews every move → execute with a manifest + one-click undo +
a hard denylist (`.git`, vaults, cloud-synced dirs, system paths). Non-destructive middle path: materialise
the semantic tree with **symlinks** (visible in Nautilus too, originals untouched).

**Sequencing:** after search is refined and per-document summary vectors exist — meaningless until every
file has a summary vector. Status: captured direction, not scheduled.

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
