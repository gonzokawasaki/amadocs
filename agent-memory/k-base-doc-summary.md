---
name: k-base-doc-summary
description: per-document AI catalog-card summary (aiSummary); THE SWAP is BUILT (2026-06-15) — summary embedded by default at ingest, full-text Deep search is opt-in per file
metadata: 
  node_type: memory
  type: project
  originSessionId: 79479a8b-9f1f-4524-a796-349c610c68d4
---

**BUILT 2026-06-14** — a document can get a ~120-word factual "catalog card" summary, stored as a
new **`aiSummary`** field on the doc JSON. Purpose: metadata *about* each file for a future
**semantic file browser** (the "next stage"). Reuses the ~120-word answer-cap standard.

**⚠️ REVERSED 2026-06-15 — summary is now the DEFAULT (see [[k-base-alpha-simplification]]).** The
big reframe makes AMAdocs an AI *librarian*: every dropped file gets a ~120-word summary/caption by
default. The dump-100 tax that made it on-demand is now accepted because safety > speed AND the cost
is bounded + serial-queued + stoppable (full safety model: [[k-base-ingest-safety]]). The
*mechanism* below is unchanged (DocSummary leading-slice on first 8000 chars / ~5 pages); what flips
is the trigger: `DOC_SUMMARY_ENABLED` becomes default-on. Full-document embedding (semantic search)
is the new per-file OPT-IN.

**✅ BUILT 2026-06-15 — THE SWAP (catalog-by-default + opt-in Deep search).** Implemented Option A
(librarian default = summary IS embedded so chat can find every file; Deep search upgrades to
full-text). Changes: (1) `DOC_SUMMARY_ENABLED` default flipped to **true** (server `#attachOptions`
`?? "true" !== "false"`; start-stack.sh, packaged main.js, collector/.env). (2) `Document.addDocuments`
got a 4th `{mode}` arg ("deep" default / "summary"); `upload-and-embed` now passes `mode:"summary"`,
which embeds only `catalogText(data)` = title + `aiSummary` (fallback: first 2000 chars when no
summary — covers images' caption + summarizer-down). Tags `workspace_documents.metadata.amadocsSearchMode`.
The on-disk doc JSON keeps full pageContent (viewer/citations unchanged). (3) New endpoint **`POST
/workspace/:slug/doc-deep-search {path}`** re-embeds the full file IN PLACE under the same docId:
`deleteDocumentFromNamespace` + `prisma.document_vectors.deleteMany` + `addDocumentToNamespace(...,
skipCache=TRUE)` + flip metadata to "deep". ⚠️ **skipCache=true is REQUIRED** — the vector cache is
keyed on **docpath** (`uuidv5(filename)`), NOT content, so without it the re-embed restores the
summary chunks. (4) UI (`amadocs-ui/index.html` → synced to desktop): cataloged rows show a hover
"🔍 Deep search" pill + right-click "🔍 Deep search this file"/"✓ Deep searched" (via `docModeByPath`
from doc-list metadata); `deepSearchDoc()` posts behind a status bubble then reloads; upload copy →
"Cataloged N documents…". Legacy pre-reframe docs have no flag → treated as "deep". **Verified:**
all 6 server/UI files syntax-check; `catalogText` branch unit-test 6/6; only the AMAdocs drop path is
cataloged (other `addDocuments` callers keep deep). **NOT live-E2E'd** (no stack running; needs
Ollama+models — human-eyeball/live class). Cataloged-doc citations won't page-jump (summary isn't
verbatim in pageContent — graceful); deep-searched docs get the full passage citation loop.

**(Historical, pre-reframe) Trigger = ON DEMAND (right-click "Summarize"), NOT at ingest** (user
decision 2026-06-14: auto-summarising every upload adds ~25-30s/doc — brutal on "dump 100 files").
Auto-at-ingest existed but was opt-in `DOC_SUMMARY_ENABLED=true` (default false; knob in
collector/.env, start-stack.sh, packaged main.js).

**On-demand path (default):** server `POST /workspace/:slug/doc-summarize {path,force}`
(`endpoints/workspaces.js`) → `fileData()` → returns cached `aiSummary` unless `force`, else
generates with **the workspace's `chatModel`** (the picked model), writes `aiSummary` back, returns
it. Uses `server/utils/DocSummary/index.js` (twin of the collector util). UI: "🧠 Summarize" item in
the doc-row right-click menu (`showDocMenu`; hidden for images via `isImageName`), `summarizeDoc()`
shows a timer status bubble ([[k-base-status-feedback]]) then drops the summary into chat;
`loadTextView()` shows a persistent "🧠 AI summary" panel when `aiSummary` exists.

**Auto-at-ingest path (opt-in):** generated in `collector/processSingleFile/index.js`
(`attachDocumentSummary()`) — the single funnel every drop passes (not the 8 converters; not by
making ~20-caller `writeToServerDocuments` async). `collector/utils/DocSummary/index.js` (mirrors
`VisionCaption`) POSTs the **leading slice** (first 5 pages when PDF `pages` exist, else first ~8000
chars), `num_predict:200`, `temperature:0.2`, `trimToSentence()`. Best-effort → null. Threaded via
`summary:{}` block in server `#attachOptions`. Skips images ([[k-base-image-analyser]]) + parse-only.

**Verified live (phi3.5, running stack):** default upload → 1s, NO summary at ingest, `aiSummary:null`
✓; `POST /doc-summarize` → 98-word card (30s) via workspace chatModel, persisted, served by
`doc-view`; 2nd call `cached:true` instant ✓. Auto path also verified. phi3.5 embellishes a bit
(small-model issue, [[k-base-strict-prompt]]). **Not eyeballed live:** the actual right-click menu /
status bubble / summary panel in the UI (human-eyeball class). **Not built:** the file-browser UI
that consumes `aiSummary`; back-filling pre-existing docs (null until summarized). **How to apply:**
browser reads `aiSummary` from `doc-view` or drives `doc-summarize`; consider a doc-level vector for
semantic browse (not done yet).

**✅ BUILT 2026-06-14 — embed summary INTO a copy of the file (right-click "💾 Save copy with
summary").** Writes the summary into the file's OWN native metadata so the gist travels inside the
file (visible in OS file managers); **source NEVER touched** — reads the retained copy into a buffer,
embeds, streams a new download. Major formats only (others 415, future update): `server/utils/
MetadataEmbed/index.js` `embedSummary({buffer,ext,summary})` — **PDF** `pdf-lib` `/Subject`+keywords;
**Office** (.docx/.xlsx/.pptx) `jszip` rewrites `docProps/core.xml` `<dc:description>`; **JPEG**
`piexifjs` EXIF `ImageDescription` (ASCII-stripped, no re-encode); **PNG** hand-rolled iTXt
"Description" chunk + CRC32 (no dep, no re-encode). New dep `piexifjs@1.0.6` (pure JS; 2nd added dep
after exifr). Endpoint `GET /workspace/:slug/doc-export-embedded?path=` finds original via
`amadocsRetainedOriginal(id)`, uses cached `aiSummary` or generates+persists one (images use their
caption text). UI: "💾 Save copy with summary" in right-click menu (`canEmbedSummary` gate),
`saveWithSummary()` blob-download behind a status bubble. **Verified live:** PDF (Subject set) + PNG
(valid 800×600, iTXt carries summary, aiSummary cached) over HTTP; JPEG+DOCX unit-verified. Not
eyeballed: the live UI download. Idea behind it: most of a drive is pdf/office/jpg/png so it adds a
lot of value ([[k-base-platform-focus]]).

**⬜ Follow-up (noted 2026-06-14): surface summaries in the OS file manager.** Dev box = ML4W
Hyprland → **Nautilus (GNOME Files) 50.2.2** (Super+E via `~/.config/ml4w/settings/filemanager`).
A `nautilus-python` ext (needs `python-nautilus`, not installed) → right-click "Summarize with
AMAdocs" + AI-Summary column/tooltip; engine seam = collector `parseDocument` (absolutePath, no
embed) → `DocSummary` → cache as `user.amadocs.summary` **xattr**. MUST be pull-not-push (right-click
only; column reads cached xattr, never auto-runs the model on directory view) or it becomes the
parked AI-Finder lock-up footgun ([[k-base-folder-index]]). GNOME-only, outside the Electron app.
Existing `aiSummary` is keyed by docId not disk path → this is a separate in-place path.
