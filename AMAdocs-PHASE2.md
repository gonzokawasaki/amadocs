# AMAdocs — Phase 2 Spec: Semantic File Manager

> Status: **Design / pre-build** (2026-06-18). Phase 1 codebase is the starting point.
> Entry point summary in `K-base.md` → "Phase 2 Reframe".

---

## The pivot in one sentence

Stop asking users to bring files to the app. Go to the files instead — build a file manager
that already understands what's in everything.

---

## What changes vs. Phase 1

| Phase 1 (AMAdocs) | Phase 2 (Finder++) |
|---|---|
| Drop files into collections | Browse the real filesystem |
| Collections (workspaces) as organising unit | Folders/drives as organising unit |
| Chat is the primary interface | File browser is the primary interface |
| AI is the foreground | AI is the infrastructure |
| Embed-then-chat | Browse-then-ask |
| Catalog card = embedded vector | Catalog card = shown in right panel on select |

The Phase 1 engine and all its proven components survive. The UI is rebuilt around a
file-manager shell.

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

**Folder/drive selected:**
1. Folder metadata (file count, indexed count, pending count)
2. Chat input + conversation, scoped to that folder. Returns **files as results** (not a
   synthesised answer) with snippets. Clicking a result opens the file in preview mode.

**Nothing selected:**
1. Brief explainer: "Select a file to see its summary. Ask a question to search your files."
2. Chat input — searches the whole indexed filesystem.

### Top bar

- Simple filename / keyword search (TinySPARQL FTS — instant, no LLM, no embeddings).
- Separate from the AI chat. Answers the "find file named X" question; AI chat answers
  the "find files about X" question. Two distinct modes, clearly labelled.

---

## Right-click menu

```
📄 any-file.pdf
├ 🔍 Analyse with AI      (OCR + vision caption — primary for images/scanned docs;
│                          available on all files as a "force re-analyse" option)
├ 🧠 Summarise            (generate or refresh aiSummary via LLM)
├ ⬆️  Prioritise           (move to front of background indexing queue)
├ 💾 Save copy with AI notes  (export file copy with summary/OCR/caption embedded
│                              as XMP metadata — the Phase 1 metadata-embed feature)
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

On first launch (or when a new drive/folder is added), a one-shot indexing pass runs in
two phases:

**Phase 1 — Embedding pass (fast: minutes to ~1 hour depending on corpus size)**
- Reads LocalSearch-extracted text for all indexed files (no LLM, no Ollama).
- Computes embeddings using the native ONNX embedder (all-MiniLM-L6-v2).
- Writes to LanceDB. Semantic search is available after this phase.
- Safe queue: serial, cool-downs, durable, hard STOP — THE #1 RULE applies.

**Phase 2 — Summary generation (slower: hours, background)**
- Runs the LLM (granite4.1:3b) to generate `aiSummary` per file.
- Strictly serial, cool-downs, pauses when machine is active (idle-aware).
- Progress shown in the right panel as a persistent status chip.
- Summaries fill in progressively — the AI panel shows a spinner for unsummarised files.

**Images and scanned docs:** excluded from both auto-phases. On-demand only via
right-click "Analyse with AI". Rationale: vision inference is heavy; auto-running
moondream on 10,000 photos would violate THE #1 RULE.

**Honest onboarding message:**
> "AMAdocs is building your search index. Semantic search will be ready in about
> [N minutes]. File summaries will fill in over the next few hours in the background.
> You can use the app now — keyword search works immediately."

**After setup:** incremental maintenance. GNOME LocalSearch's inotify monitoring detects
new/changed/deleted files. The gnome-sync delta path re-embeds only what changed. Cost
scales with changes, not corpus size.

---

## What survives from Phase 1 (reuse directly)

- **TinySPARQL bridge + gnome-sync** — the indexing backbone. `POST /gnome-sync` is still
  the embed trigger; the file tree just makes the folder the natural unit of organisation.
- **Safe ingest queue** — serial worker, cool-downs (EMBED_COOLDOWN_MS), hard STOP
  (stopAll / stopWorkspace), durable finalize-on-confirm, bounded batches + remaining.
- **All file viewers** — PDF.js, image viewer + caption/OCR panel, text view.
- **Grounded citation loop** — chunk → page → passage highlight. Still the differentiator.
  In a finder context, "jump to where in the document this came from" is even more natural.
- **aiSummary** — generation, caching, on-demand refresh. Now shown in the right panel
  automatically rather than only on right-click.
- **Vision captioning (moondream)** — right-click "Analyse with AI" on images.
- **OCR** — same, for scanned docs.
- **LanceDB embeddings + semantic retrieval** — unchanged. Scope filter
  (`filterIdentifiers`) already designed for the folder-scoped chat path.
- **API auth token gate** — unchanged.
- **Session scoping** — unchanged.
- **`stripScaffolding()` + `capAnswer()`** — unchanged.

## What is new build

- **File tree component** — real filesystem tree, left panel. Expand/collapse, status
  indicators per file, left-click and right-click handling.
- **Folder browser view** — middle panel mode 1. Grid/list of folder contents with
  metadata + summary subtitles.
- **File preview tabs** — middle panel mode 2. Tab bar, tab switching, reuses existing
  viewers.
- **Right panel: summary card + scoped chat** — the summary card is new presentation;
  the chat + retrieval engine behind it is Phase 1 reused.
- **Top search bar** — TinySPARQL FTS, filename + keyword. Separate from AI chat.
- **Setup/onboarding screen** — honest progress for Phase 1 (embedding) and Phase 2
  (summaries) of initial indexing.
- **Background indexing cadence scheduler** — resumes pending work on relaunch, runs
  summary generation as a low-priority background task.
- **Chat result mode: files** — when a folder is selected, chat returns file links +
  snippets rather than a synthesised answer. Clicking a result opens preview.

## LanceDB schema bug resolution

The Phase 1 open bug (bridged gnome-sync docs adding 4 extra columns vs. normal
drag-drop uploads causing Arrow schema mismatch) is resolved by elimination. In Phase 2
there is only one doc producer: gnome-sync. Drag-drop as a primary ingest path is
retired. The mixed-schema problem disappears.

---

## Open questions (to be resolved before build)

1. **Workspace/slug model under the hood. ✅ RESOLVED.** One global workspace
   (`amadocs-library`). Folder-level scoping is done via a path filter on `sourcePath`
   in LanceDB queries — not separate tables. Simpler, and the existing `filterIdentifiers`
   mechanism already supports this. Per-folder workspaces rejected as unnecessary complexity.

2. **What happens to Phase 1 users?** If anyone is running AMAdocs Phase 1, their
   embedded collections don't map to the new folder-tree model. Likely: a migration note
   in the release; existing LanceDB data is still queryable but the UI no longer surfaces
   it in the old way.

3. **The `p.N` citation label for bridged docs** — still open from Phase 1. Low priority
   but worth fixing during Phase 2 build since the citation loop is more prominent.

4. **Name.** "Finder++" was raised as a candidate. To be decided before public release.
   AMAdocs may stay as the working name through Phase 2 development.
