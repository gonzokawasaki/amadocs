# Coracle — Developer Notes

> **Coracle** (formerly *AMAdocs*) — a private, local AI document assistant. The name is the new
> project theme: a **coracle** is a small, light, single-person boat you carry to the water and that
> carries you across it — the metaphor for a lightweight, personal, private vessel for navigating your
> own documents. It runs on a modest machine (one person's corpus, local models, no cloud), and the
> product language leans into the metaphor — *navigate / chart / waters* — for search and the file
> view. See the rename entry below for what changed and what deliberately did not.

Technical companion to `K-base.md` (overview) and `AMAdocs-SPEC.md` (product spec). This is the
**engineering log** — newest entries on top, kept in chronological/archaeological order on purpose.

## 🪶 RENAME (2026-06-25) — the project is now **Coracle** (was AMAdocs); branding-only this pass

The GitHub repo was renamed `amadocs` → **`coracle`** and the product adopts the **Coracle theme**:
the name plus the **coracle metaphor as product language** (a small personal boat for navigating your
own waters → your documents; UI copy will lean on *navigate / chart / waters / vessel*). The git
remote `origin` was repointed to `…/coracle.git`.

**Scope this pass = docs/branding only (deliberate).** All runtime/code identifiers stay `amadocs-*`
on purpose — the LanceDB workspace slug `amadocs-library` (and its `amadocs-library.lance` /
`amadocs-library__summaries.lance` tables), the `storage/documents/gnome-amadocs-library/` doc store,
`storage/gnome-sync/amadocs-*.json`, env vars (`GNOME_*`, `AMADOCS_*`), and UI internals are unchanged.
Renaming those would mean **migrating/re-indexing the live recovered corpus** (250 docs / 1957 vectors)
and rewriting baked-in references — a separate, planned task, not worth the breakage for a brand pass.

**Not done yet (easy follow-ups, intentionally deferred):** renaming the doc *files* themselves
(`AMAdocs-DEV-NOTES.md` / `AMAdocs-SPEC.md` → `Coracle-*`) + their cross-references; user-facing strings
(app/window title, Homepage hero); and a possible visual **Coracle skin** (water/wood palette) alongside
Terminal/Slate/Desktop. Branding language is being adopted in the docs now; code + UI strings follow when
we choose to.

## ✅ HOUSEKEEPING + VERIFY (2026-06-25) — working tree committed; breadth search re-verified on live tables

Two things, no new features: got the multi-session working tree into git, then closed the long-owed
breadth-search verification now that the library is recovered.

**Library state confirmed (fresh session, stack down/cool):** the 2026-06-24 re-summarise drain **completed**
— `amadocs-library.lance` = **1957 rows** (the predicted recovery target), sync state = **250 tracked / 0
queued** (`mtime:""`), pace 15s. The "wedge" saga is fully closed.

**Committed the working tree (was uncommitted across ~4 sessions — a real loss risk; a `/tmp` backup was
wiped by a reboot once).** Five logical commits on `main` (not pushed): summariser `Keywords:` line · drain
robustness (bounded timeouts + delete-phase instrumentation) · summary-progress in `/amadocs-status` · cover
thumbnails + sandboxed HTML rendering · docs. Deleted the throwaway `_sumtest*` scratch files (the eval lives
at `tooling/search-eval.js`).

**Breadth search re-verified on the LIVE recovered tables (heat-free).** Ran `tooling/search-eval.js` — it
CPU-embeds the gold queries and hits the REAL production `db.summarySearch` over the live `__summaries` table
(no granite, no stack), /STEM fully card-covered (40/40):

|            | Recall@5 | MRR  |
|------------|----------|------|
| chunk (old)| 0.857    | 0.766|
| **summary**| **0.952**| 0.893|
| lexBM25    | 0.833    | 0.798|
| RRF-fusion | 0.905    | 0.821|

Summary breadth still **beats chunk and fusion**, returning one card/doc with the right docs on top; scope
routing confirmed in code (`utils/chats/stream.js:216` `isFileScope`). Slightly under the earlier 1.000 —
the 3-gold "assessment criteria" query now scores 2/3 (`Assessment_Criteria_Breakdown.docx` drops out of
top-5); card-text variation, not a regression to chase. **Honest scope:** this is a functional/API-level
verification of the production retrieval path, NOT a literal Electron GUI screenshot (the chrome automation
tools attach to Chrome, not Electron; an end-to-end stream-chat would fire granite for no extra signal since
routing + retrieval are already proven).

**The 127/250 summary-card gap = legit-empty short docs, not a hole.** Of 250 tracked docs, 129 carry a
summary (≈127 cards); 121 are empty — **116 are tiny `.md` calendar/exam-schedule notes (110–126 chars,
under `summariseDoc`'s 200-char floor → "" by design)** + 4 old `.xls` + 1 mis-titled. Tail worth a glance
someday, not now. Build-1 finish **step 2 (re-summarise keepers + eyeball breadth search) is DONE**; next is
step 3 (virtual semantic folders) — currently parked at user's request to discuss the search algorithm more.

## ✅ BUILT (2026-06-24) — document COVER thumbnails: clipped top-left crops in the grid

A grid-card **cover** for every file, built + running + eyeballed live. **The design insight (user):**
don't fight for a faithful full-page thumbnail of a text-heavy doc — a whole page shrunk to tile size is
illegible grey texture. Render a **legible top-left crop** instead (title / letterhead / first heading /
opening line — exactly what the eye uses to recognise a doc on a shelf). *Crop, don't scale.*

**This dissolves the hard category instead of solving it.** Text-heavy types were only hard for *raster*
thumbnails — but they're exactly the types AMAdocs already renders as **live HTML/DOM** (Word→mammoth,
Markdown→marked.js, spreadsheets→SheetJS, text/code as text). So the cover for those is the **existing
preview renderer dropped into a small clipped tile** — no raster pipeline, no LibreOffice, no Electron
screenshot, crisp at any DPI, themeable. The LibreOffice/Office-thumbnail dependency problem just goes away
because text docs aren't rasterised at all. Only genuinely visual types (PDF, image) get a real raster cover.

**What shipped (both UI copies — `tooling/amadocs-ui/index.html` → mirrored byte-identical to
`amadocs-desktop/ui/index.html`):**
- **`.fc-thumb` CSS** — fixed-height (8.5rem) tile, `overflow:hidden`, top-left anchored, a bottom
  fade-to-`--bg` gradient ("there's more" / torn-corner cue), theme-var styled. `.is-img`/`.is-pdf` center a
  raster (no fade); `.is-empty` collapses the tile (→ summary-only card) for no-cover types. Clamps the
  renderer's `.vsheet-page`/`.md-body` wrapper to a non-scrolling crop and hides the `.vnote` loader chrome.
- **Cover slot** on each file card in `renderFolderGrid` (gated on the `desktop.readFile` bridge via a
  `canCover` flag), inserted between `.fc-head` and `.fc-divider` — i.e. **cover + the librarian summary card
  together** (the distinctive identity: visual fingerprint *and* what-it-is).
- **`wireCovers` / `renderCoverInto` / `renderPdfCover`** — lazy via one shared `IntersectionObserver`
  (`rootMargin:300px`, copied from `renderPdfInto`'s lazy-page pattern), one-shot per tile (`dataset.done`).
  `renderCoverInto` reads bytes off disk via `desktop.readFile`, mime-dispatches: PDF→`renderPdfCover`
  (page-1-only canvas at tile width — NOT the full multi-page `renderPdfInto`), image→`<img>`,
  docx→`renderDocxInto`, xlsx/csv→`renderXlsxInto`, md→`renderMarkdownInto`, text/json→`renderBlobTextInto`.
  Text/markdown input is `blob.slice()`d (4–6 KB) to keep the DOM small; unknown types → `.is-empty`.
- **Covers are decoupled from indexing** (consistent with the 2026-06-21 preview decision): they read straight
  off disk, so they render for *unindexed* files too — the card just shows "Not yet indexed" in the summary slot.

**Status: built, parse-verified (`vm.Script` over both inline UI scripts = 0 failures; copies byte-identical),
launched + previewed live.** Ran the desktop app with **`GNOME_CADENCE_DISABLED=1 GNOME_SUMMARY_DISABLED=1`**
(log confirmed `[gnome-cadence] disabled`) → server/collector/ollama up, **zero indexing heat** (no drain, no
granite, no embed), covers render purely client-side. Reached via folder → ⊞ grid toggle. Debug port
`--remote-debugging-port=9222` added on relaunch.

**⚠️ Then it FROZE on the /STEM folder — three rounds of live root-causing. The real lesson: bound the WORK,
not the input bytes.** Guards now in the cover path (all in `wireCovers`/`renderCoverInto`, both UI copies):
- **Serial queue** (`_coverQ` + `_coverPump`) — covers render **one tile at a time**. The naive version fired
  `renderCoverInto` for *every* tile that intersected, so scrolling to the bottom kicked off a parallel burst of
  whole-file reads + parses → freeze. Queue clears on folder change; skips detached tiles.
- **12 MB input cap** — skip reading huge files. Helps, but **NOT sufficient** (see the xlsx below).
- **Extension gate** (`COVERABLE_RE`) — decide renderability by extension **before reading**. The 10.45 MB
  `Vibe Coding an App.pptx` was being fully read + base64-decoded on the main thread *just to discard it* (no
  pptx cover renderer). Now skipped with zero I/O.
- **The actual culprit + the principle:** `SISVT…STEM Assessment Tracking….xlsx` is **20 KB on disk** but its
  first sheet's used range is **`B1:F1048576` = 5.24 MILLION cells** (formatted to Excel's max row). The cover
  reused `renderXlsxInto` → `sheet_to_html` over the *full* range → a multi-million-cell DOM table → instant
  freeze. **Input-size and extension caps cannot catch this — a 20 KB file exploded into a 5 M-cell render.**
  Fix: a dedicated **`renderXlsxCover`** that clamps `!ref` to the first ~15 rows × ~10 cols *before*
  `sheet_to_html` (which is also exactly the top-left crop the cover wants). Diagnosed properly — `ls -laS` the
  folder + read each xlsx `!ref` with the node `xlsx` lib — instead of guessing per file.
- **`renderPdfCover`** also `pdf.destroy()`s after page 1 to free memory.
- **Known remaining gap:** only **xlsx** is output-bounded; a `.docx` with a huge embedded table could still
  build heavy DOM via mammoth (the /STEM docx are all <60 KB so it didn't bite). Bound docx the same way if it
  recurs.

**✨ HTML now renders as a WEBPAGE, not source (2026-06-24).** `.html`/`.htm` previously fell into the
`text/*` catch-all → raw escaped source. New `renderHtmlCover` (cover: 1000px-wide page scaled to tile width,
top-cropped) + `renderHtmlInto` (preview pane: full rendered page) draw it in a **sandboxed iframe**. TWO safety
layers because covers auto-render on scroll in a privacy-first app: `sandbox=""` (no scripts/forms/popups) **and**
a prepended CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`) that **blocks
all network** — a stray/tracking `.html` can neither run nor phone home. Wired into all three dispatchers
(`renderCoverInto`, `renderFromDisk`, `renderOriginalInto`).

**NOT yet done (follow-ups):**
- **Catch this BUG CLASS (decided worth doing, 2026-06-24):** (a) a **Long Tasks `PerformanceObserver`**
  dev-logger flagging any main-thread task >50 ms + which file's cover caused it (surfaces jank before it's a
  freeze; ~10 lines, dev-only); (b) a **pathological-fixtures smoke test** — sheet-formatted-to-row-1M, huge
  PDF/CSV/image, deeply-nested docx — rendering each cover under a time budget in CI (**/STEM is now a real
  fixture**); (c) the architectural fix below makes the class *impossible*.
- **Carousel view mode** — a third `setView('carousel')` (alongside `'list'`/`'grid'`, same `entries`, CSS
  horizontal scroll-snap). The covers are the substrate; this is just another presentation.
- **Perf + the architectural robustness fix (the "(c)" above) — render covers in a Web Worker + cache.**
  Today covers render on the main thread, so a pathological file freezes the UI until each guard is found
  (xlsx now clamped; docx not yet). The class-killing fix: render heavy covers in a **Web Worker** — it cannot
  freeze the UI and, crucially, **can be killed on a timeout** (you can't interrupt sync main-thread JS), then
  **rasterise the finished tile → cache** (data-URL/file keyed by path+mtime, same scheme as LanceDB AI data) so
  the main thread only ever does `<img src>`. The cache layer and the robustness boundary are the **same work**.
  (`renderFromDisk`/`readFile` reading the WHOLE file over IPC is also wasteful — worker + size/extension gates
  address it.)
- **Reuse GNOME's freedesktop thumbnail cache** (`~/.cache/thumbnails/{normal,large,…}`, PNG named by MD5 of
  the `file://` URI) as a zero-cost first source for files Nautilus already thumbnailed — the same "ride on the
  OS's work, fill the gaps" philosophy as riding on LocalSearch. (Note: GNOME only has Office-doc thumbs if a
  LibreOffice thumbnailer is installed, so this doesn't dodge the dependency for those — the live-render path does.)
- **Tuning** — text-tile font is 0.6rem; bump if the crop reads too small. Cover-first card layout (cover above
  the header) is an option vs. the current header-then-cover.

## 📝 FUTURE IDEA (2026-06-24) — coarse-to-fine "agentic" answers (cards → deep read)

**Idea (user):** one query like *"find the doc where capex is discussed"* runs a two-hop funnel — search
the catalogue **summary cards** to pick candidates, then read the **full-text chunks** of just those
candidates for a detailed, cited answer. Needs more planning; parked here.

**Why it fits:** both halves already exist — stage 1 = `summarySearch` over `<slug>__summaries` (built,
R@5 1.000); stage 2 = chunk search scoped to a path (file-scope "deep search"). New work is small: take
top-K summary hits → run chunk retrieval **restricted to that set of sourcePaths** → synthesise once.

**Design leanings from the discussion:**
- This is **deterministic coarse-to-fine, not a true agent loop** — call it that. Build the fixed two-hop
  first. A real LLM-driven loop (decide which docs to open, judge sufficiency, re-query) only earns its
  keep for multi-hop queries a single pass can't answer, and on the fan-stop 4 GB box **every iteration =
  more granite/GPU heat** (THE #1 constraint). If ever added: bound to ≤2 iterations, small model as
  router/judge (one-token "sufficient?"), not a free planner.
- **Synthesise once, not per-candidate** — gather the narrowed candidates' chunks into ONE granite call.
  One generation, stays serial, minimal heat.
- **Generous at stage 1, narrow at stage 2** — a funnel only loses recall at stage 1, and stage 1 is pure
  vector math (cheap, no granite), so cast wide (top-10–15 cards) then narrow to ~3–5 for the read. The
  new `Keywords:` line covers the rare-term misses that used to leak here.
- **Show the candidate cards it picked** as provenance (extends the grounded-citation differentiator one
  level up; makes the two-hop legible).

**Shares infra with virtual folders:** scoping search by a `sourcePath` **SET** (IN/OR-list) rather than
`starts_with(prefix)` is the same engine delta the virtual-folders design needs — build it once, both
land. → sequence this as a **step 5**, after virtual folders, not inside the Build 1 finish line.

**Open / to plan:** does this unify the currently-separate breadth/deep scopes into one "just ask" answer
mode? top-K thresholds; corpus scope (the "email" example assumes mail is indexed — today the catalogue is
filesystem docs only, so demo with a doc type actually indexed). Pairs with the clarifying-questions note
below.

## 📝 FUTURE IDEA (2026-06-24) — LLM clarifying questions to refine a search

**Idea (user):** the LLM can ask the user a question to refine an ambiguous search before/while answering.
Needs more planning; parked here. Same primitive as the virtual-folders "optional, bounded questions"
(folder-intent disambiguation + per-file tiebreak) — pointed at search.

**The trap to avoid:** do NOT ask granite to *invent* a clarifying question — it's a heat-costing call, adds
a round-trip before any answer, and it will ask about facets that don't exist in the corpus (hallucinated
options are worse than none).

**The right way — the retrieval results decide whether and what to ask (cheap, grounded):** after stage 1
you already hold candidate cards with real metadata (folder, date, type, similarity). Ambiguity is
detectable from that set **with no LLM call**:
- candidates split across distinct folders → offer a folder facet;
- wide date span → offer a time facet;
- uniformly low top similarity → recall is weak, ask for more specific terms instead of guessing;
- many near-tied candidates → offer to narrow.
The options come straight from real candidate metadata, so they **can't be hallucinated** and granite is
optional (templated phrasing works). The question stage then *saves* heat — pruning candidates shrinks the
context into the one synthesis.

**Strong leaning: answer-then-offer, not ask-then-answer.** Don't block by default (blocking reintroduces
the friction "AI librarian by default" is meant to remove). Answer from the top candidate immediately, then
offer the refinement as ignorable facets ("answering from the 2023 deck; also in Q4 forecast — switch?").
Reserve a blocking question for the rare genuinely-unresolvable case. Rule: **ask only when the answer would
materially change** (same bar the harness uses; same "skippable, sharpens edges" framing as virtual
folders). **Cap at one question per query** — multi-turn interrogation is where it turns annoying and, on
this box, each extra generation is more GPU time.

**This is a single-user corpus**, so "which of *your* folders" is meaningful (the user recognises their own
structure) — faceted refinement that feels robotic on web search feels natural here.

**Open / to plan:** does refinement live in the **conversational chat** (inline "switch?" affordances) or a
**structured faceted UI** (clickable folder/date filters above the candidate cards)? Retrieval logic is
identical; the UX fork interacts with the breadth/deep scope-unification question in the note above.

## 📝 NOTE / FUTURE IDEA (2026-06-24) — explicit `powerMonitor` resume hook on wake-from-sleep

**Not built — captured for later.** There is currently **no sleep/suspend-specific code path**. On
suspend the Node process freezes with the OS: the cadence timers (`cadence.js` boot `setTimeout` +
15-min `setInterval`) and any in-flight per-doc `sleep()` cool-downs just fire late on wake, and any
in-flight granite/embed HTTP call to Ollama either completes after wake or times out → that one doc is
retried next tick. Nothing is lost — the durable/idempotent/no-over-claim queue (`[[k-base-ingest-safety]]`)
makes freeze-and-thaw safe by construction. The OS crawl (LocalSearch) is idle-aware and pauses/resumes
with the OS on its own.

**The one thing left on the table:** after a long sleep, AMAdocs may wait up to a full 15-min period
before its next tick picks up the delta. A small improvement would be an Electron `powerMonitor.on('resume')`
hook in `amadocs-desktop/main.js` that fires `cadence.runAndChase()` (or pokes the sync endpoint)
immediately on wake instead of waiting for the next interval. The only existing `powerMonitor` mention is
the parked AI-Finder OCR idle-detection idea further down this log — not implemented. Low priority; the
current behaviour is correct, just not maximally prompt.

**Current state (2026-06-20):** AMAdocs is the semantic file-manager UI wired end-to-end to the
engine (live file tree, AI state chips, folder indexing, scoped chat, context-menu actions); the
"ride on GNOME" loop and safe ingest queue are proven live; the LanceDB schema bug is fixed and the
`teaching` table re-indexed. Three CSS skins (Terminal / Slate / Desktop) ship on top of the wired
UI. The **background cadence scheduler is now built** (resume-on-relaunch + periodic delta tick), and
**granite4.1:3b is blessed as the bundled default** (packaged env + summary fallback + catalog lead).
The **sparse-index mystery is solved and fixed** (see top entry): LocalSearch was skipping every `.git`
directory by default, so the whole `teaching_docs` vault was invisible — corpus now indexed. Preview is
client-side (PDF.js/mammoth/SheetJS, **+ marked.js for markdown** as of 2026-06-21), decoupled from
indexing (any local file previews from disk), and wide spreadsheets/markdown no longer bleed off the page. The app now **opens to a live status doc** (index/db/model/version). The **GNOME
extraction blind spots are now backstopped** (top entry): docx/xlsx/pptx that GNOME mis-routes, scanned
PDFs, and images now run through AMAdocs' own collector extractors and embed — folder sync handles office
docs + scanned PDFs automatically, right-click "analyse with AI" handles images (OCR + vision) on demand.
The **`p.N` citation label** is now restored for backstop PDFs (carry `asPDF`'s page ranges) and the
**dryRun over-count is fixed** (empty-text files route to the backstop instead of being phantom-counted)
— both 2026-06-21, verified live. The top-left **window-style dots are now real Home/Back/Forward nav
buttons** and the launch surface is a proper **Homepage** (status cards + indexed-folders + quick actions),
not the old read-only markdown status — both 2026-06-21, verified live in the Electron app.
**Summaries-by-default is now live on the GNOME-ride path** (2026-06-22): every gnome-sync'd doc gets a
granite `aiSummary` (was collector/upload-only); test batch + the 40-doc /STEM eval folder backfilled and
verified, and a real `aiSummaryForPath` query bug (unquoted DataFusion identifier) found + fixed so
Option-A summary chat finally works — see the top entry. A **full-778 backfill is now in progress**
(bounded cadence drain, ~4h, $0). The summariser was then **upgraded to emit a `Keywords:` line**
(2026-06-24, top entry) — exact names/dates/codes/technical terms appended to each card so breadth search
recovers the rare-term recall the prose paragraph drops; applies to new summaries / on Re-summarise. Open: **packaging** (stale AppImage, icon, Windows/macOS) + the
summary-search *routing* redesign this backfill unblocks. The "Phase 1 / Phase 2" labels below are
historical build-stage names — the product is just AMAdocs now.

## ✅ CORRECTION (2026-06-24 PM) — the "wedge" was a MISDIAGNOSIS; drain is healthy, just slow + late-embedding

The incident entry below blamed a **frozen LanceDB delete** holding `inFlight`. **That was wrong** —
proven by instrumenting the EXECUTE delete phase + the materialize loop and watching a clean boot-resume
in the live desktop app:

- `removeDocuments` = **89ms** (the 175 deletes were already-gone no-ops), `deleteSummaryVectors` = **~14s**
  (175 sequential card-deletes over the small `__summaries` table). **Both COMPLETE every pass** — no freeze.
- The materialize loop runs fine: `loop START — toEmbed=163, paused=false`, docs 1..N `result: materialized`,
  **0 materialize failures**, `queued` count steadily decreasing.

**Why it LOOKED frozen (three compounding artifacts, none a hang):**
1. **Pace.** The saved Homepage slider was **55000 ms** (55 s rest per doc) → 163 docs ≈ **~2.5h** materialize
   phase. (Read live per-doc via `getPaceMs()`, so it can be changed without a restart.)
2. **GPU idle is expected here.** The head of the queue is short calendar/SLE notes (<200 chars) →
   `summariseDoc` returns `""` and **skips granite entirely** → `nvidia-smi` reads 0% for long stretches.
   Granite only fires on longer docs. So "GPU idle + no progress" ≠ wedged.
3. **`embedFiles` runs ONCE, after the whole loop.** The main `amadocs-library` table does **not** grow until
   every doc in the pass has materialized — so sampling `countRows()` shows **1123 flat for the entire ~2.5h**,
   which is indistinguishable from a freeze if you only watch the row count. (This is the real trap that
   produced the "main table sampled twice 8s apart = identical" observation.)

**What's actually true:** the library is degraded (1123 rows / 72 summary cards / `workspace_documents` ~79)
because the 163-doc rebuild simply **hasn't finished a pass yet** — not because it can't. Recovery = let ONE
uninterrupted pass complete (user chose to keep the **55 s** thermal-safe pace 2026-06-24 → ~2.5h, then
`embedFiles` rebuilds the lance table + `upsertSummaryVector` rebuilds the cards at end-of-pass). The incident's
real damage cause stands (curl/restart churn mid-drain); the *mechanism* was slow-pace + deferred-embed, not a
lock.

**Shipped this session (kept):** `withTimeout()` helper + `GNOME_DELETE_TIMEOUT_MS` (default 120s) wrapping
both delete calls — cheap insurance against a *genuine* future lance hang (converts a freeze → logged error →
retried). Plus diagnostic markers `[gnome-delete]` (delete-phase timings) and `[gnome-drain]` (loop size +
first-6-doc results) — low-noise, safe to leave; trim the per-doc `[gnome-drain]` lines on the next restart if
desired. The 2026-06-24-AM robustness fixes (collector/sparql timeouts, per-doc try-catch) also stand.

**Possible real improvement (NOT done, deferred):** the end-of-loop `embedFiles` means search stays degraded
for the whole pass and an interruption leaves everything un-embedded (only `pendingEmbed`-checkpointed for the
*next* pass). Embedding in smaller batches *during* the loop would make recovery incremental + visible. Bigger
change; left for after this recovery completes.

## ⚠️ INCIDENT (2026-06-24 AM) — re-summarise drain "wedge" (see CORRECTION above — misdiagnosed) + robustness fixes

**State at exit:** stack UP (server :3001, collector :8888, Electron app). **The library is DEGRADED — ~79 docs vs 255** — and a boot-resume `runSync` is **wedged holding the `inFlight` lock** (GPU idle, no progress). Pace = 120000 ms. This is NOT fixed; it needs one more focused session. Honest account below.

**How it happened (self-inflicted during diagnosis):** validating the new summariser keyword line (entry below), a `curl` to `POST /workspace/amadocs-library/resummarize` flipped **176** docs to "changed" (delete-old + re-embed). The delete phase ran — **`workspace_documents` 255→79, main lance `amadocs-library` 1957→1123** — then `runSync` **stalled before rebuilding them**. Repeated `curl --max-time` aborts + restarts compounded it. The 176 are durably queued in state (`mtime:""`), source files intact → recoverable once the drain works.

**Where the hang is (localized by elimination, NOT yet pinned to a line):**
- NOT `computeDelta` / `queryFileList` / `queryBlindSpots` — those go through `sparql()`, now 30s-bounded; a hang would throw → cadence logs `sync error`. None logged.
- NOT the materialize loop / collector / granite — added a 60s collector timeout + the existing 120s granite timeout; **neither ever fired** across multiple runs. So execution never reached the loop.
- **FROZEN (not grinding)** in the **EXECUTE delete phase**: `Document.removeDocuments` (index.js:623) or `deleteSummaryVectors` (:624) — both LanceDB writes. Main table sampled twice 8s apart = identical (1123). Suspected **LanceDB lock/conflict** on this changed-set (possibly aggravated by my many concurrent `lancedb.connect()` probes during debugging — but it re-wedged after I stopped probing, so likely a genuine removeDocuments/lance hang). **Reproduces across clean restarts** (the boot-resume `cadence.tick()` → `runSync(limit:0, reconcile:false)` re-enters and re-wedges).

**Robustness fixes SHIPPED this session (all `node --check` clean — KEEP them; they're correct, but they do NOT fix this wedge since it's pre-loop):**
- **(A)** `collectorApi.parseDocument()` now takes an optional bounded `timeoutMs` (AbortController; default = no timeout, so the upload path is unchanged). `materializeViaCollector` passes `GNOME_BACKSTOP_TIMEOUT_MS` (default **300000**) so one un-parseable/OCR-stuck backstop file can't wedge the serial drain forever (→ null → retried next sync).
- **(B)** `sparql()`'s synchronous `execFileSync` got a `timeout` (`GNOME_SPARQL_TIMEOUT_MS`, default **30000**) — a hung tinysparql query can no longer freeze the whole event loop.
- **(C)** Per-doc `try/catch` in `runSync`'s `toEmbed` loop — one bad file is skipped (left ABSENT, retried) instead of aborting/wedging the batch.

**NEXT SESSION — to actually fix + recover:**
1. **Instrument the EXECUTE delete phase** (markers before/after `removeDocuments` and `deleteSummaryVectors` in `runSync`, index.js:626-633) and let one boot-resume reveal the exact stuck call. Then bound/guard it (likely a timeout or a lance-lock check around `removeDocuments`).
2. **Recover the library:** once the drain completes a clean pass, the 176 flipped (`mtime:""`) docs rebuild (re-embed + re-summarise with the new keyword prompt) → back to ~255 docs + summary cards. Run it at the 120s pace, **uninterrupted** (the biggest lesson: do NOT poke it with `curl`/restarts mid-drain — that caused most of the churn).
3. **Cleanup surfaced:** **1930 orphan doc-JSON sidecars** on disk (only 250 tracked; **361 with `aiSummary`** = the source of the user-reported "380 summaries" mismatch — a disk-derived count over orphans; the live counter is 74/250). Breadth `__summaries` table = only **72 cards** for 255 docs (the original "search only works sometimes" cause). Both resolve when the drain + an orphan-JSON sweep run.

## 🔑 SUMMARISER (2026-06-24) — `Keywords:` line for rare-term breadth recall

The catalog-card summariser now extracts exact searchable tokens, not just prose. **Why:** breadth
(folder/global) chat ranks against the embedded `aiSummary` string (lance `upsertSummaryVector` embeds it
verbatim — `vectorDbProviders/lance/index.js:335-339`), and the search-redesign eval already pinned the one
failure mode: *exact rare terms the 120-word card omits* (e.g. `microbit` → summary Recall@5 0.50). A polished
prose paragraph naturally drops proper nouns, codes and rare terms, so breadth search can't match them — which
is why folder search felt "good only some of the time."

**Change (both `DocSummary` copies — `server/` + `collector/utils/DocSummary/index.js`, kept identical):**
- **New prompt, two parts:** the same ≤120-word factual paragraph, then a final line beginning exactly
  `Keywords:` listing the specific terms present in the excerpt — proper names (people/orgs/places),
  dates/years, reference numbers/codes, and distinctive technical/topic terms. `Keywords: none` when there are
  none.
- **`NUM_PREDICT` 200 → 300** so the extra line isn't truncated.
- **New `DocSummary.finalize()`** replaces the bare `trimToSentence` call in `summarize()`. It splits the
  keyword line off *first*, then sentence-trims only the prose, then re-attaches the line. Necessary because
  `trimToSentence` cuts at the last `.`/`!`/`?` — which lives in the paragraph — and would otherwise silently
  lop the keyword line off the end. `Keywords: none` / empty is dropped; the last `keywords:` marker wins so a
  stray mention in prose can't false-split.

**Validated (no backfill — thermal):** 5-case parser unit test (newline / inline / none / no-line fallback /
stray-mention) + one REAL `granite4.1:3b` call on `0500_…Specimen_Insert_1.pdf` →
`Keywords: 0500/01, tundra, Pleistocene` — the paper code plus rare terms the paragraph omitted, exactly the
intended recall win (names already in the prose, e.g. Lyuba/Siberia, are embedded regardless). The keyword line
is **visible on the catalog card** too (deliberate — the ask was to append it into the summary; embed-only is a
one-line switch if the card reads cluttered).

**Only affects NEW summaries** — existing cards are unchanged until **🧠 Re-summarise** is run (use
`onlyMissing: false` to re-do all surviving docs under the new prompt, not just the gaps). Not yet re-eval'd:
re-run `tooling/search-eval.js` after re-summarising /STEM for a before/after Recall@5 number. Planned next:
user culls the corpus, then runs Re-summarise.

## 🧭 PLANNING (2026-06-23) — two-build split + Gemma size data + virtual-folders design settled

Planning session, no code shipped. Three outcomes:

**1. Two builds, not one.** **Build 1 "AMAdocs Lite"** = this 4 GB GTX 1650 Ti box, near complete, keeps the
granite + moondream + Tesseract + MiniLM stack (NO Gemma). **Build 2 "AMAdocs"** = the Gemma 4 consolidation,
designed for an **~8 GB VRAM floor**, parked until Build 1 ships. The split exists because of hard data below.

**2. Gemma 4 sizing — corrected with real numbers (the earlier memory was wrong).**
- Measured this box: `nvidia-smi` → **3713 MiB free**, and the **dGPU is compute-dedicated** (display runs on
  the Intel iGPU → nearly the whole 4 GB is usable, not "4 GB minus desktop").
- `gemma4:e2b-it-q4_K_M` = **7.2 GB** — wrong tag, far too big. The real candidate is Google's official QAT
  int4, **`gemma4:e2b-it-qat`**. Pulled the **registry manifest** (no weights download): text weights
  **3.35 GB** + vision projector (mmproj) **0.99 GB** = **4.34 GB** total.
- Verdict: even text-only (3.35 GB + ~1 GB KV/runtime) overshoots the ~3.3 GB effective budget → ~15–25 % CPU
  layer offload → reintroduces the chassis-heat problem. So Gemma can't hold both modalities resident on 4 GB;
  on an 8 GB card `e2b-qat` fits clean. Perf math: TU117 GDDR6 ~192 GB/s → fully-resident ~3.35 GB tops
  ~50 tok/s (real 20–30); each ~10 % offload ≈ halves it. Settling test on any box = `ollama run … --verbose`
  + `ollama ps` (shows the GPU/CPU layer split). Build 2 re-bases on `e2b-qat` @ 8 GB floor, full consolidation
  clean (no granite fallback needed at that tier).

**3. Virtual semantic folders → promoted into Build 1 ship scope, design settled.** Full design now in
`AMAdocs-SPEC.md`. Headline: **classification, not clustering** — same "small model = classifier/router, not
generator" principle as the CSS-theming skill. The **user owns the structure** (chooses folder names from a
simple *default structure*), the **AI owns the placement** (which file goes where), with a few **optional,
bounded questions** to sharpen edges. Mechanism is **zero-GPU + deterministic**: each folder is a named
**anchor** (name + description) embedded with MiniLM; each doc assigns to its **nearest anchor** by cosine over
its existing summary vector (floor → "Unsorted"); editing re-flows live. Questions reuse the same primitive —
folder-intent answers enrich an anchor's description, per-file tiebreaks pin a file; both skippable. One
unifying primitive (`anchor` | `query` | `pinned`, or a mix) covers Mode 1 (AI-auto), Mode 2 (user-edited),
and multiple named **structures** the user **toggles** between in the left panel (a switchable lens: real FS ↔
AI structure ↔ own structures). Engine delta = scope by a `sourcePath` **set** (`IN`/OR) not just
`starts_with(prefix)`, + a small anchor-embed/nearest-assign util + a `virtual-folders.json` store.

**Build 1 finish sequence:** (1) cull the demo corpus → (2) re-summarise keepers + eyeball breadth search live
→ (3) virtual folders → (4) Homepage/UI polish.

## 🐛 FIX + ✨ FEATURE (2026-06-22) — pace slider now applies per-FILE; Homepage shows summary progress

Two changes this session, both verified against the live running stack (server :3001 nodemon reload +
Electron renderer reload over the `--remote-debugging-port=9222` CDP socket).

**1. BUG: the Homepage "Indexing pace" slider was ignored mid-backfill.** `runSync` captured the pace
ONCE per batch (`const docCooldownMs = getPaceMs()` at the top of the EXECUTE block) but `GNOME_SYNC_CAP`
defaults to **200 docs/batch** ≈ ~40 min at ~12 s/doc — so dragging the slider had no effect until the
in-flight batch finished, contradicting the UI toast's promise ("takes effect on the next file"). **Fix:**
read the pace **live inside the per-doc loop**, right before the rest `sleep`, in
`server/utils/GnomeBridge/index.js` (~line 633/679). The batch now only captures `paceDisabled =
summariesDisabled()` (a constant per process); the actual `getPaceMs()` is re-read each doc, so a slider
change applies on the very next file with no restart. Verified live: user moved the slider to **95 s**
mid-session and it took hold (persisted to `storage/gnome-sync/amadocs-settings.json`). Separately noted
the saved value had been sitting at `0` (no rest at all = the "GPU firing constantly" the user saw).

**2. FEATURE: Homepage now documents summary progress (answers "how many docs have a summary?").** The
status payload + Homepage previously showed total docs but NOT how many carry an AI catalog card —
backfill progress was only visible via `grep -c Summarised server.log` or the state file. Added:
- `GnomeBridge.summaryStats(slug)` → `{ total, summarised, queued }` per synced folder. `summarised` =
  tracked docs whose stored JSON has a non-empty `aiSummary` (reuses `docHasSummary`); `queued` = no
  summary yet but stamped `mtime===""`/`pendingEmbed` (in the backfill pipeline). **Live** — reads each
  doc JSON, so the number climbs as the cadence drains. Exported in `module.exports`.
- `/api/amadocs-status` (`server/endpoints/workspaces.js`) now returns a library-wide
  `summaries:{total,summarised,queued}` aggregate **and** per-folder `summarised`/`queued` on each
  `synced[]` entry. Best-effort (guards `typeof Gnome.summaryStats === "function"`).
- Homepage (`tooling/amadocs-ui/index.html` → mirrored to `amadocs-desktop/ui/index.html`): a new
  **"Summaries"** card (`128 / 778`, sub-line `AI catalog cards · N queued` / "all done") + the Indexed
  folders line now reads `N files · M summarised (K queued) · last sync …`.
- Verified live: endpoint returned `{total:778, summarised:128, queued:352}` and climbed during the
  session (37 → 128) = the count tracks the backfill in real time. Both server files `node --check` clean;
  both UI copies vm-parse clean. **Possible follow-up (not done):** auto-refresh the Homepage counts on a
  timer while a backfill runs (currently refreshes on load / ⟳ only).

## 🔬 FINDING (2026-06-22) — "GPU idle, CPU hot" = the heat is the native ONNX embedder, NOT granite

User reported the last run kept the **GPU totally idle while the CPU ran hot** — the opposite of the
thermal model the whole `[[thermal-throttle]]` saga (gpu-tempguard / "granite dominates") was built around.
Traced where the work actually lands; the GPU model was never the CPU source:

**granite (the LLM) runs fully on the GPU and barely touches the CPU.** Ollama journal, last real load
(13:00:43): `load_tensors: offloaded 41/41 layers to GPU`, `CUDA0 model buffer size = 1998.84 MiB` (+320 KV
+67 compute ≈ 2.4 of 3.6 GiB resident at `num_ctx=4096`). systemd's own accounting confirms it:
`ollama.service: Consumed 4min 50s CPU over 2h 55min wall`. So granite = brief GPU bursts, then GPU idle.

**The sustained CPU load is the embedder.** `server/.env`: `EMBEDDING_ENGINE='native'` /
`EMBEDDING_MODEL_PREF='Xenova/all-MiniLM-L6-v2'` → AnythingLLM's `NativeEmbedder`
(`utils/EmbeddingEngines/native/index.js`) runs MiniLM through **`@xenova/transformers` 2.17.2 +
`onnxruntime-node` 1.14.0 on the CPU** (CPU execution provider; no CUDA EP in the 1.14 npm build). onnxruntime
intra-op defaults to the physical core count → it pins all **4 cores** of the i5-10300H (4C/8T) per chunk,
per doc. That is the steady multi-second-per-doc load that reads 0% on `nvidia-smi`.

**Why this run was GPU-idle the WHOLE time:** the recent work is the summary-vector backfill, and
`server/_backfill_summaries.js` is by design *"Embeds only (NativeEmbedder, local/CPU — NO granite
generation, thermally safe)."* An embeds-only pass invokes granite zero times → GPU dead idle → 100 % of the
work falls on the CPU ONNX embedder. Exact match for the report.

**Implication for the thermal controls:** `gpu-tempguard.sh` reads only `nvidia-smi` GPU temp → **blind to
embedding heat** (this is *why* `chassis-monitor.sh` watching `x86_pkg_temp` exists, and why the live finding
showed GPU 64–67 °C while pkg hit 84–89 °C). The **pace slider cooldown still helps** — resting between docs
rests the CPU embedder too — but it's framed around granite/GPU; for an embeds-only pass granite isn't the
variable, the per-doc rest still is. Net correction to the mental model: **two distinct heat sources** —
granite→GPU (interactive chat, summary generation) and MiniLM→CPU (every embed, incl. the embeds-only
summary-vector seed) — and the CPU one is the one that was running hot here.

**Options to tame the CPU embedder (investigated, NOT yet implemented — user to choose):**
- **Move embedding onto the GPU — NOT viable cheaply here.** `onnxruntime-node` is pinned at **1.14.0** (the
  NativeEmbedder comment depends on its `dispose()`-is-a-noop behaviour) and that build is **CPU-only** (no
  CUDA EP shipped). The only GPU path is switching `EMBEDDING_ENGINE='ollama'` to a GPU embed model
  (`granite-embedding`/`nomic-embed-text`) — but that (a) changes the vector space/dim (MiniLM = 384-d) →
  **forces a full re-embed of the whole corpus** (`amadocs-library.lance` + `__summaries`), and (b) competes
  with granite for the 3.6 GiB VRAM and just **relocates heat to the worse-cooled GPU**. Rejected for now.
- **Cap the CPU work (portable, recommended) — two flavours:** (1) OS-level: launch the node server under
  `taskset -c 0-1` (limit to 2 of 4 cores) and/or `nice`/`systemd CPUQuota` in `tooling/start-stack.sh` — zero
  code, cross-machine-safe, lowers peak heat at the cost of slower embeds (throttle-not-stop, same philosophy
  as the pace slider); downside: throttles ALL server work, not just embedding. (2) onnxruntime intra-op
  thread cap — fiddly: transformers.js 2.17 only cleanly exposes `env.backends.onnx.wasm.numThreads` (WASM
  backend), not a per-session `intraOpNumThreads` for the node backend, so this needs a patch to how the
  pipeline session is created. (1) is the clean win and fits the "one knob, works across machines" steer.

## ✅ DONE (2026-06-22) — Indexing PACE: one user-set "rest between summaries" knob (heat, the simple way)

Replaced the abandoned thermal-automation direction (temp watchdogs / chassis monitor / charge-cap
systemd units — all brittle across machines, see [[thermal-throttle]]) with **one honest knob the user
controls**, per the user's explicit steer: *"trying to build in lots of scripts that automate this is too
difficult across many different machines — just let the user decide … managed by a simple timeout rest
between sessions."* The lever is the existing per-doc cool-down (`GnomeBridge.runSync`'s `docCooldownMs`):
each summarised doc fires one granite `/generate` (sustained GPU); a longer rest between docs keeps an
old/hot laptop cool and quiet during a bulk backfill at the cost of wall-clock — fine to leave overnight.

**What shipped (no scripts, no auto-tuning, no restart needed):**
- **`GnomeBridge.getPaceMs()` / `setPaceMs(ms)`** (`utils/GnomeBridge/index.js`) — the pace is persisted to
  a tiny `storage/gnome-sync/amadocs-settings.json` (`{summaryCooldownMs}`), clamped 0–600000 ms.
  `getPaceMs` precedence: **saved slider value > explicit `GNOME_SYNC_COOLDOWN_MS` launch override
  (back-compat) > conservative default 30000 ms**. `runSync` now reads `getPaceMs()` live (once per batch,
  still `summariesDisabled() ? 0`), so a slider change applies on the **next** sync with no restart and the
  boot-resume cadence picks up the saved value automatically. Default changed from 0 → **30 s** (≈10 h for
  ~780 docs, ~40 % GPU duty) — "fairly conservative" out of the box.
- **`POST /amadocs-settings {summaryCooldownMs}`** + `pace.summaryCooldownMs` added to the `/amadocs-status`
  `data` (`endpoints/workspaces.js`).
- **Homepage "Indexing pace" slider** (`tooling/amadocs-ui/index.html` → synced to `amadocs-desktop/ui/`):
  range 0–120 s (⚡ Fast ↔ Gentle & cool ❄), live `fmtPace` label on drag, persists on release via
  `homeSetPace`→`apiSetPace`. Honest hint text ("a longer rest keeps an older/hot laptop cool … takes
  longer to finish … applies to the next file, no restart").

**Decision (user, 2026-06-22): keep this to ONE transparent knob.** `GNOME_SYNC_CAP` stays an INTERNAL
safety bound (per-pass batch size), deliberately NOT surfaced — two workload controls would confuse the
expert-Linux audience. So the cap-vs-pace coupling that *would* leak cap into user-visible behaviour was
removed at the source (below) rather than by exposing a second slider.

**Follow-up BUILT same session — per-doc checkpoint + the two safety fixes a long-lived loop needs**
(`runSync`, all in `utils/GnomeBridge/index.js`; chosen over "just lower the cap" because it collapses the
mental model to one knob that's safe at any pace):
- **Per-doc checkpoint (durability).** The EXECUTE loop now writes state `{docpath, mtime, pendingEmbed:true}`
  and persists **the instant each summary is materialized**, before the batch embed. A new RESUME pass in
  PLAN re-embeds any `pendingEmbed` doc's EXISTING docpath (granite never re-run); `onDocComplete` clears the
  flag to a plain done-entry on confirm. Legacy `{docpath,mtime}` entries = done (back-compat). Net: an
  interruption mid-backfill never re-summarises a completed doc → **`GNOME_SYNC_CAP` is now irrelevant to
  durability**, so it can stay internal at 200.
- **STOP check in the loop.** `if (Embed.isIngestPaused()) break;` per iteration + gating the embed dispatch
  on `!paused` — a long pace makes the materialize loop long-lived, so without this the hard STOP would keep
  firing granite for the rest of the batch. Materialized docs are checkpointed, so STOP resumes cleanly.
- **Serial guard (no double-granite).** Module `inFlight` Set + a `Embed.hasRunningWorker()` check bail any
  second pass with **409 busy**. The loop now runs for a long time with no worker active, which would
  otherwise let a cadence tick start a concurrent pass (2× GPU heat); the `hasRunningWorker` half also closes
  a real race (lock releases at embed *dispatch* but `pendingEmbed` clears at embed *confirm*, so a pass
  entering that window could re-embed an in-flight doc → duplicate vectors).

**Status: built + parse-verified** (`node --check` both server files; vm.Script over UI scripts = 0
failures; UI source synced identical to the desktop copy) **+ unit-tested the pace store directly** (default
30 s, set/get/clamp at both ends, file cleaned up) **+ module load-tested** after the runSync rewrite. The
per-doc-checkpoint / STOP / lock paths are reasoned-through, **NOT yet exercised live** (would need a real
GNOME + DB + an induced interruption). **NOT yet eyeballed in the running app** — deliberately did NOT boot
the stack (cadence boot-resume would relaunch the paused 726-doc thermal backfill). When that backfill is
resumed it now runs at the user's chosen pace, checkpoints per file, and honours STOP. Per
[[thermal-throttle]] / next-session plan.

## ✅ DONE (2026-06-22) — Summary-vector breadth search (the "AI librarian by default" retrieval)

Built + measured the search redesign from `AMAdocs-DEV-NOTES → "LLM search redesign"`: **breadth-scope
chat (a folder, or the whole workspace) now retrieves over ONE per-document summary vector instead of
full-text chunks**, so results are one librarian card per document rather than scattered chunk fragments
(which in a big folder dominate the topN with duplicate chunks of one doc and miss the right doc). File
scope (clicked into one doc) is unchanged — chunks + the Option-A summary injection ("deep search").

**Measured on the /STEM eval (7 labelled queries, real corpus, REAL production `db.summarySearch`):**

|            | Recall@5 | MRR  |
|------------|----------|------|
| chunk (old)| 0.857    | 0.766|
| **summary**| **1.000**| 0.821|
| lexBM25    | 0.833    | 0.810|
| RRF-fusion | 0.905    | 0.750|

Summary-only **beats chunk and even fusion**, so we shipped summary-only for breadth — no lexical/RRF
complexity. **The key finding: the only thing making summary search look mediocre earlier was the
similarity threshold.** Summary vectors are document-level/broad, so their cosine similarities run lower
than chunk vectors; the inherited chunk default of 0.25 silently dropped good matches (the rare-term query
"microbit" sits ~0.2 → got cut → Recall 0.00). A summary-specific floor of **0.20** took it 0.857→1.000.

**What shipped:**
- **Separate table `<slug>__summaries`** — NOT a marker column in the chunk table, because the main table's
  Arrow schema is locked at its first row (a marker would force a drop+reindex). One row/doc = its
  `aiSummary` embedded with the SAME engine as chunks/queries, so the spaces are comparable; can be
  dropped+rebuilt cheaply while tuning. New `LanceDb` methods (`vectorDbProviders/lance/index.js`):
  `summaryNamespace`, `summaryRow` (stable schema via one constructor), `upsertSummaryVector` (idempotent
  by sourcePath: delete-then-add), `deleteSummaryVector`, `summarySearch` (mirrors `similarityResponse`'s
  shape; returns `{...,empty:true}` when the table doesn't exist yet → caller falls back to chunk search).
- **Scope routing in `chats/stream.js`** — FILE scope (exact path) → `performSimilaritySearch` (chunks) +
  Option-A; BREADTH scope (scopePath ends "/" OR is null) → `summarySearch`, topN bumped to ≥10, with a
  summary-specific threshold `AMADOCS_SUMMARY_SIM_THRESHOLD` (default 0.20). Empty-table fallback to chunk
  search so breadth chat still works mid-rollout. **No UI change** — the folder-scope UI already renders
  `sources` as one card/doc.
- **Self-maintaining on the gnome-sync path** (`GnomeBridge/index.js`): `runSync` upserts summary vectors
  after `embedFiles` and deletes them after `removeDocuments` (captures sourcePaths first); `backstopFile`
  (right-click analyse) upserts too. Best-effort + gated by `summariesDisabled()` — never breaks ingest,
  still serial (THE #1 RULE). `resummarize` refreshes cards through the same delete+re-embed path.
- **One-off seed** `server/_backfill_summaries.js` populated the table from the 156 `aiSummary`s already on
  disk → **106 unique-path cards** (duplicate doc-JSONs sharing a path collapse to one), embeds-only
  (~13 s, $0, NO granite, thermally safe). `WIPE=1` rebuilds clean.
- **Eval harness promoted** to `tooling/search-eval.js` (parameterized `THRESH`/`TOPN`/`K_RRF`; exercises
  the real `db.summarySearch`). Run from `server/`: `node ../../tooling/search-eval.js`.

**Status: built, parse-verified (`node --check` all touched files), and measured via the harness against
the live tables.** NOT yet eyeballed in the running Electron app — deliberately didn't start the full
stack, because cadence boot-resume would relaunch the paused thermal backfill (726 files queued `mtime=""`).
**Remaining:** (1) live in-app verify of folder chat showing summary cards; (2) the 726-file granite
backfill now has a clear payoff (more cards = broader breadth recall) — run it throttled; (3) follow-up:
folder "search" still runs a full granite generation server-side whose answer the UI discards
(`amadocs-ui` ~line 2437) → a retrieval-only breadth path would save GPU per query.

## ✅ DONE (2026-06-22) — "Re-summarise" button: user-triggered backfill of missing summaries

Built + wired the re-summarise action the SPEC's Homepage "Tuning" direction anticipated ("changes
don't retro-apply → pairs with a re-summarise action"). **Why it's needed at all:** the mtime-based
delta (`computeDelta`) only re-selects NEW or CHANGED files, so a file indexed *before*
summaries-by-default — or before a future summary prompt/model change — is invisible to the cadence and
never (re)gains a summary on its own. A **typical fresh user never hits this** (they index on a
summaries-by-default build, so every file is summarised as it's first embedded); it bites only (a) anyone
who indexed with `GNOME_SUMMARY_DISABLED=1` first (the thermal-safe path) and later wants summaries, and
(b) the prompt/model re-tune case. So this is a deliberate **user-triggered** maintenance action, not
silent always-on delta behaviour. Until now the only way to backfill existing files was the manual
`/tmp` `mtime=""` surgery we've been doing by hand.

**Mechanism — reuses the proven backfill path, zero new ingest machinery (THE #1 RULE intact):**
- `GnomeBridge.resummarize(slug, {onlyMissing=true})` — stamps the SAVED `mtime` to `""` for matching
  tracked files (those with a docpath; `onlyMissing` ⇒ only ones whose stored doc JSON has an empty
  `aiSummary`, via new `docHasSummary(docpath)`). That makes the next `runSync` see them as "changed" →
  delete-old + re-embed + re-summarise through the **exact same serial / `GNOME_SYNC_CAP` / `GNOME_SYNC_
  COOLDOWN_MS` / durable** path as the hand-driven backfill. Skips already-stamped (`mtime===""`) entries
  so repeated clicks don't double-count. Returns `{ok, flipped, total}`; refuses when `GNOME_SUMMARY_
  DISABLED=1` or the folder was never indexed.
- `POST /workspace/:slug/resummarize {onlyMissing?=true}` — flips, then kicks ONE bounded `runSync`
  (limit:0, folder re-read from saved state so it drives the cadence's code path) and returns
  `{...flip, ...syncBody}`. The background cadence drains whatever exceeds the bounded pass.
- UI: `apiResummarize()` helper + `homeResummarize()` handler + a **🧠 Re-summarise files** button in the
  Homepage Quick actions; toasts `flipped`/`remaining`, then refreshes the homepage after 4s.

**Status: built + parse-verified only** (`node --check` on both server files; vm.Script over all 6 inline
UI scripts = 0 failures; source synced `tooling/amadocs-ui/index.html` → `amadocs-desktop/ui/index.html`).
**NOT yet clicked live** — deliberately holding the GPU quiet during the in-flight thermal-throttled
778-backfill; safe to eyeball once that completes (a `onlyMissing` click then is consistent with it — it
flips the same still-missing set). **Known tradeoff (inherited from the existing path, not introduced
here):** `runSync`'s `toDelete` is computed over ALL changed docs but `toEmbed` is capped, so flipping a
set larger than the cap deletes those docs' vectors up front and re-embeds `cap`/pass — search is degraded
for the not-yet-drained remainder until the cadence catches up. Acceptable for a deliberate, user-initiated
background re-index, but if we want search to stay whole during it, bound `toDelete` to the same cap. **Two
minor follow-ups:** legit-empty summaries (images / too-short docs that summarise to `""`) get re-flipped on
every `onlyMissing` click since "tried-but-empty" isn't distinguished from "never-tried" — harmless churn,
fixable with a `summaryAttempted` marker; and there's no progress/STOP surfacing yet beyond the toast.

## ⚠️ 2026-06-22 — Backfill interrupted by overheating; resumed THROTTLED + GPU temp-guard watchdog

Mid-full-backfill the user **powered the machine down** — a burning/overheating smell in the room
(possibly this box, possibly another machine nearby; unconfirmed). Context that makes this box a
credible culprit: it's a **fan-stop GTX 1650 Ti laptop** whose GPU fan the OS can't read/control
(`nvidia-smi` reports fan/power-limit `N/A`), run in a **sub-tropical hot room**, and the full-778
summary backfill fires one granite `/generate` per doc → sustained GPU load for hours. On reboot:
thermals normal at idle (GPU 39 °C, CPU pkg 42 °C, trip points sane 100–120 °C), nothing running but
`ollama serve`. Backfill progress is durable — **~141 docs had summaries** (was ~52 at flip), i.e.
~89 done before shutdown. ⚠️ The pre-flip state backup lived in `/tmp` and the **reboot wiped it** —
"undo the flip" is no longer possible; only path is to let the backfill finish.

Two safety layers added before relaunch:

**(1) Per-doc thermal cool-down** — `GnomeBridge/index.js` runSync EXECUTE loop now sleeps
`GNOME_SYNC_COOLDOWN_MS` after each doc that did real GPU work (gated; default 0 so tiny incremental
syncs are unaffected; auto-disabled when `GNOME_SUMMARY_DISABLED=1`). Pairs with the existing
`GNOME_SYNC_CAP` (per-tick batch size). Still fully serial — no new parallel work (THE #1 RULE).

**(2) GPU temp-guard watchdog** — `tooling/gpu-tempguard.sh`: polls `nvidia-smi` every 5s and, since
the OS can't drive this GPU's fan, **`SIGSTOP`s every `ollama` process at CEILING (80 °C)** to instantly
freeze GPU compute, then **`SIGCONT`s at RESUME (70 °C)**. A frozen `/generate` just makes the in-flight
HTTP request wait — resumes cleanly, worst case one summary retried next sync. Logs to
`tooling/logs/tempguard.log`. App-independent hard backstop.

Relaunched throttled: `GNOME_SYNC_COOLDOWN_MS=4000 GNOME_SYNC_CAP=50 bash tooling/start-stack.sh`,
watchdog at 80/70. **Measured rate ~19.5 s/doc** (granite itself dominates — the 4s cooldown is minor;
matches the earlier ~19 s/doc figure). ~627 docs remaining → **ETA ~3–4 h**. First ~3 min: peak GPU
**58 °C, 0 freeze events** — comfortably under the ceiling. User is watching thermals physically. If
interrupted again, relaunch resumes (durable). To run the app WITHOUT the heavy backfill at all:
`GNOME_SUMMARY_DISABLED=1`.

**Addendum (2026-06-22, refined diagnosis + backfill PAUSED).** User identified the overheat as a
**COMBINED** heat source: an **old (~8yr) battery that runs hot WHILE CHARGING** plus the GPU spinning
up — not GPU-only. This matters because the watchdog is **blind to it**: `gpu-tempguard.sh` reads only
`nvidia-smi` GPU temp, and on this box `BAT1` exposes **no** temperature via sysfs. Live probe of what
this box CAN report: ACPI **chassis** zones in `/sys/class/thermal` (`x86_pkg_temp` + `pch_cometlake`
~52 °C idle, `acpitz`) — these rise with battery/case heat and are the usable proxy. **Mitigation found:
this laptop supports a charge cap** — `/sys/class/power_supply/BAT1/charge_control_end_threshold`
(default 100); `echo 60 | sudo tee …` stops charging so a backfill runs on AC with the battery idle,
removing one heat source (doesn't persist across reboot without a systemd unit / tlp). **Proposed (NOT
yet done): add `x86_pkg_temp`/`acpitz` reads to `gpu-tempguard.sh`** so it freezes ollama on chassis heat
too, not just GPU. **Current status: backfill is PAUSED — stack is DOWN** (only `ollama serve` running);
saved state still has **726/778 files flipped `mtime=""` and queued** (52 summarised). Just relaunching
the stack auto-resumes those 726 via cadence boot-resume — so DON'T relaunch un-throttled. User chose to
**defer the backfill** and refine other things first; resume later with charge-cap + throttle + watchdog
(ideally the hardened one). See [[thermal-throttle]] + [[next-session-plan]].

## ✅ DONE (2026-06-22) — Summaries-by-default: test PASSED + /STEM backfill + fixed a real `aiSummaryForPath` bug

Resumed the interrupted summaries-by-default test (code built+verified 2026-06-21; the gnome-sync path
now summarises every doc — see the next-session plan). Three outcomes this session:

**(1) The 5-doc test batch passed (verified by direct DB/disk inspection; server was down at session
start).** The post-interrupt cadence tick (`lastSync 2026-06-21T23:20:59`) had already run the new code
and summarised the 5 flipped ICT_MOET files via the **`tinysparql` GNOME-ride path** — the path that
previously never summarised. All 5 carry an accurate `aiSummary` (disk JSON **and** `workspace_documents`
metadata); **no duplicate workspace docs** (each sourcePath = exactly 1 doc — the delete-old+re-embed
delta worked); **vectors net-unchanged** (13811 total == baseline; 783 docs / 781 unique paths). 12 docs
had summaries at that point (5 flipped + ~5 newly-detected Cambridge IGCSE files re-embedded fresh =
proof it fires on both changed and new files). The 2 pre-existing backstop dupes (`ict_quiz_SA2.xlsx`,
scanned `Year 6 ICT…pdf`) are unrelated edge cases, not the test files.

**(2) Small backfill on /STEM (the 40-doc eval folder) — clean.** Flipped `mtime=""` on the 40 `/STEM/`
state entries (backup at `/tmp/amadocs-library.json.bak-*`), booted the stack, let the cadence resume
drain them. **40/40 summarised** (~3–13 s/doc, granite4.1:3b), no errors; **40/40 carry `aiSummary` in
both lance + `workspace_documents` metadata**; no new duplicate sourcePaths; `document_vectors` still
**13811** (== baseline — re-embed swaps chunks in place, summary rides as a doc field). Backfill mechanism
proven; the full-778 pass is the same trick at scale (~4 h, $0, idle-aware via cadence).

**(3) ⚠️ Found + fixed a real bug — `aiSummaryForPath` threw on EVERY call (Option A was a no-op for TWO
reasons, not one).** Validating the read path the Option-A summary-grounded chat uses
(`stream.js:266 → VectorDb.aiSummaryForPath`), it returned `""` even with summaries present. Root cause:
its filter `where(`sourcePath = '…'`)` uses an **unquoted identifier**, which DataFusion case-folds to
`sourcepath` in a binary `=` comparison and throws *"No field named sourcepath"* (caught → `""`).
Characterized the dialect against the live table (lancedb 0.15.0):

| clause | result |
| --- | --- |
| `sourcePath = '…'` (unquoted, binary) | **throws** (case-folded to `sourcepath`) |
| `"sourcePath" = '…'` (double-quote) | 0 rows — double-quotes parse as a *string literal* |
| `` `sourcePath` = '…' `` (backtick) | ✅ matches |
| `starts_with(sourcePath, '…')` (unquoted, function arg) | ✅ matches — so folder-scope search is fine |

The gotcha: the unquoted convention that works for the `starts_with(sourcePath, …)` *function arg* (the
scopePath filter in `similarityResponse`, confirmed still working — 295 rows on /STEM) does **not** carry
to the `=` operator. **Fix:** backtick-quote the identifier in `aiSummaryForPath`
(`server/utils/vectorDbProviders/lance/index.js`) + corrected the misleading comment. Verified via the
real method against 4 present files (spaced + nested + ICT/STEM paths → all return their summary) and a
missing file (→ `""`); `node --check` clean; nodemon reloaded the running server. **Net: Option-A
summary-grounded file chat is now genuinely functional for the first time** (data + query both fixed).

**Still open:** user decision on the **full-778 backfill** (vs new-files-only); a live SSE stream-chat
eyeball of Option A through the UI (unit-proven here, not yet clicked in-app); and the summary-search
*routing* redesign itself (breadth scope → summary vectors), which this backfill unblocks.

## 🔬 EXPERIMENT (2026-06-21) — LLM search redesign: chunk vs summary vs lexical vs RRF-fusion

The "search feels totally disconnected" problem, diagnosed and measured end-to-end. Conclusion:
**folder/drive/global ("breadth") chat should retrieve over per-document SUMMARIES, not full-text
chunks; file scope keeps chunk-level deep search.** Backed by a real offline eval on this box, not
eyeballing. Throwaway rig kept at `server/_sumtest2.js` (+ `_sumtest.cache.json`, 40 granite
summaries of `/STEM`) — the seed of the eval set the search work needs.

**Why current folder search scatters (root cause).** Folder scope = `starts_with(sourcePath, folder)`
over **full chunk vectors** (lance `similarityResponse`), topN=4. In a 100-doc folder that's thousands
of chunk fragments; the top-4 are 4 stray passages that happen to share a word with the query — often
from one doc repeated. Three concrete failure modes proven on `/STEM` (40 docs):
1. **Duplicate-chunk domination** — every test query wasted 3–4 of its top slots on *copies of the same
   document*. At production topN=4 a folder can collapse to one doc.
2. **Recall misses the right doc** — "machine learning" *missed* `crest-silver-machine-learning-collection.pdf`
   entirely (high-frequency "machine"/"assessment" words in other docs crowd it out); "assessment criteria
   for grading" returned subject *assessments* (VibeCoding, MicrobitCar) instead of the actual rubric docs.
3. **Metadata pollution** — embedded chunk text begins with a `<document_metadata> sourceDocument: …`
   boilerplate header, so chunk search partly ranks on injected scaffolding, not content. Cheap fix worth
   doing regardless.

**Hard prerequisite found: 0 of 781 indexed docs have a summary.** The whole corpus came through the
gnome-sync path, which builds docs via `buildDoc` straight from TinySPARQL text and **never summarises**
(summaries are generated only in the collector path — uploads + the right-click/backstop route). So
summary-search has nothing to run against today **and the already-built Option-A summary-grounded file
chat is a silent no-op on every real file.** "Summaries by default + backfill" (memory's #1 queued task)
is the gate, not an enhancement.

**The eval (7 hand-labeled queries over `/STEM`, Recall@5 / MRR):**
```
                 Recall@5   MRR
  chunk (now)      0.857    0.766     duplicate-domination + the criteria/ML misses above
  summary          0.929    0.821     best single method; clean one-card-per-doc
  lexical BM25     0.833    0.893     best MRR — nails exact terms #1, lower recall on paraphrase
  RRF-fusion       0.952    0.750     best recall — covers both, small MRR cost from noise blending
```
- **Summary-search wins for topical/breadth queries** ("what docs are about X") — one vector per doc, no
  duplicate domination, matches *what a doc is* (the LLM card says "an assessment criteria table") not word
  overlap.
- **Summary's one weakness is exact rare terms** the 120-word card didn't echo: "microbit" → summary R@5=0.50
  (missed `microbit and electronics.pptx`), but **RRF-fusion(summary + lexical) recovered it to R@5=1.00**
  (dense found the RC-car assessment, lexical found the pptx). Textbook hybrid win.
- **Naive fusion can hurt MRR**: BM25 over *full body* imports keyword-spam (tracking spreadsheets rank high
  on "assessment") and blended it back into the clean summary result (query 3: summary R@5=1.0 → fusion 0.67).
  Likely fixes: lexical over **title+summary** (not full body), weight summary higher, or a light rerank on the
  fused top-N. (Caveat: 7 queries is directional, not significant; queries skewed topical. One gold was
  mislabeled — VEX newsletter lives in `/Generated_Documents` not `/STEM` — dropped before the final numbers.)

**Recommended architecture (evidence-backed):**
1. **Summaries by default** on the gnome-sync embed path (not just collector) + backfill the 781 (~19s/doc,
   $0, ~4h, idle-aware queue). *The gate.*
2. **One per-doc summary vector** (embed the `aiSummary`), tagged (e.g. `isSummary=true`) in the same table so
   the existing `scopePath` filter just works.
3. **Scope routing:** folder/drive/global → summary-vector search, one hit per doc, **files-as-results**;
   file scope → current chunk search + Option A (the "deep search" click-into-a-doc mode).
4. **Hybrid recall leg:** fuse a lexical leg (TinySPARQL FTS — already run for the filename bar) with the
   summary search via **RRF**, as a recall safety net for exact terms. Expose pure-summary vs fused as a
   Homepage tunable (fast/clean vs best-recall).
5. **Fix the `<document_metadata>` pollution** in what gets embedded/matched.

This connects to the IR research reviewed this session (Google = multi-stage funnel: cheap recall → fuse
(RRF) → rerank → answer; its biggest levers — Navboost/clicks, link graph — don't transfer to a single-user
local corpus, so copying "Google's algorithm" literally is a trap; what transfers is **hybrid lexical+dense,
multi-representation indexing, intent/scope routing, and offline eval with Recall@K/MRR/NDCG**).

## ✅ DONE (2026-06-21) — Summary-grounded file chat (Option A) + positioning shift

**Product shift (user, 2026-06-21): zero-config-for-non-technical-users is dropped as a goal.**
The audience is now explicitly the **techy Linux crowd who like to play with all the settings,
including the CSS.** Consequence for the build: the Homepage becomes the surface where we **expose
every tunable, the prompts, and the theme CSS for customisation**, each with a recommended default
+ rationale ("worked on this machine"). Captured in `K-base.md` ("Who it's for"), `README.md`
(Status), and `AMAdocs-SPEC.md` (Homepage → "Tuning / Advanced panel" direction). Not built yet —
direction only; recommended phasing is read-only "what we use & why" card → live numeric knobs →
editable prompts (the prompt one needs the `openAiPrompt` write-through, see the strict-prompt notes).

**Option A — summary-grounded file-scoped chat (built, NOT yet eyeballed live).** Diagnosed gap:
chat answers come ONLY from LanceDB similarity search (`performSimilaritySearch` → top-N chunks that
match the *question*), with zero positional bias, so the title page / first few pages — which hold the
key orienting info — are seldom retrieved for a specific question. Meanwhile `aiSummary` is built from
exactly those pages (`DocSummary.leadingSlice` = first 5 pages / 8000 chars) yet was **never read by
the chat path** (it only fed the UI card). Fix reuses that good summary. Two edits, tagged `AMAdocs:`:
- `server/utils/vectorDbProviders/lance/index.js` → new `aiSummaryForPath({namespace, sourcePath})`:
  exact-path query `.query().where("sourcePath = '…'").select(["aiSummary"]).limit(1).toArray()`
  (confirmed present in lancedb 0.15.0), returns `""` on miss, never throws. Exact `=` (not
  `starts_with`) so a sibling path can't bleed in.
- `server/utils/chats/stream.js` → after the `contextTexts` assembly and **before** the query-mode
  empty-context refusal: if `scopePath && !endsWith("/")`, fetch the summary and
  `contextTexts.unshift(<overview block>)`. Context-only, **not** pushed to `sources`, so it grounds
  the answer without producing a citation that can't jump to a page. No-op for folder scope, unscoped
  chat, or files with no summary (bridged/GNOME docs, images).

Both files pass `node -c`. **TODO: eyeball live** — does the overview actually improve "what is this
doc about" answers; note the before-the-refusal placement lets a file-scoped query answer from the
summary alone when no chunk matches (intended, but it's a refusal-semantics change). **Deferred:**
Option B (pin first N real, citable chunks) and Option C (positional rerank boost) — do A first.

## ✅ DONE (2026-06-21) — Preview polish: markdown rendering + spreadsheet/markdown bleed fix

Three fixes to the document preview pane (`renderXlsxInto` / new `renderMarkdownInto`, and the
`.vsheet-page` family in `ui/index.html`), all verified live over CDP in the running Electron app:

- **`.md` files now render as formatted markdown** (were showing as raw source). Vendored **marked.js
  v12.0.2** (MIT, ~35 KB) into `ui/vendor/` (+ `tooling/amadocs-ui/vendor/`), alongside PDF.js/mammoth/
  SheetJS — fully offline, nothing fetched at runtime. New `renderMarkdownInto()` parses GFM (tables,
  task lists, fenced code) into a `.vsheet-page.md-body`, with a plain-text fallback if marked ever
  fails to load. Wired into all three dispatch paths: `renderFromDisk` (off-disk, by `.md/.markdown/
  .mdown/.mkd` ext or `text/markdown` mime), `renderOriginalInto` (indexed docs, by mime/docpath), and
  the citation-jump path. New `.md-body` CSS themes headings/lists/checkboxes/code/blockquotes/tables
  with the existing page CSS variables.
- **Wide spreadsheets no longer bleed off the page** (original report). `.vsheet-page.is-xlsx` is now a
  definite, content-independent width (`calc(100% - 2rem); max-width:64rem`) and each sheet's table is
  wrapped in `.xlsx-sheet { overflow-x:auto }`, so a too-wide grid scrolls **inside** the page instead
  of spilling past its right edge.
- **Wide markdown bleed (code blocks + tables)** got the same treatment: `.md-body` is given a definite
  width with `min-width:0` so wide children can't stretch the page via flex `min-content` sizing; `pre`
  is capped at `max-width:100%` with `overflow-x:auto`, and `table` uses `display:block; width:max-
  content; max-width:100%; overflow-x:auto` (the GitHub approach) to become its own horizontal scroll
  area. Long words/URLs wrap via `overflow-wrap:break-word`. **Root cause** (both md + xlsx): the fixed
  paper width didn't hold because flex `min-content` let content widen the page — the cure is a definite
  page width plus children capped at `max-width:100%` with internal scroll.

**Verified live:** README.md → formatted (h1/lists), DEV-NOTES.md → `pageBleeds:false` with the 1746 px
`pre` and 1955 px `table` scrolling internally; a wide grades `.xlsx` → page within the desk, table
scrolls inside. **Follow-up idea noted** (not built): opt-in per-mime preview renderers surfaced on the
Homepage — code viewer (syntax highlighting) for programmers, video player for filmmakers, etc.

## ✅ DONE (2026-06-21) — Browser-style UI zoom (Ctrl +/−/0 + Ctrl+wheel)

Zoom was effectively fixed: the window hides the native menu bar (`win.setMenuBarVisibility(false)`),
so the default View-menu zoom accelerators never ran and nothing drove Chromium's page zoom. Wired it
directly on the window's `webContents` in **`amadocs-desktop/main.js`** (new `setupZoom(win)`, called in
`createWindow` right after `setMenuBarVisibility`):
- **Keyboard** via `before-input-event`: Ctrl/Cmd + `+`/`=` (zoom in), `-`/`_` (out), `0` (reset). The
  handler calls `event.preventDefault()`, which also suppresses any default-menu zoom role → no
  double-stepping.
- **Ctrl + mouse wheel** via the `zoom-changed` event: Chromium applies the step, we clamp + resync the
  cached factor so the keyboard path continues from wherever the wheel left off.
- Clamped **0.5×–3.0×** in 0.1 steps (`clampZoom`); a `did-finish-load` handler **re-applies the factor
  after each load** (the loading.html → ui/index.html navigation otherwise resets it).
- Page zoom scales the **whole renderer** — the DOM context menus, the Homepage, file previews — which is
  what "zoom the menus" needs.

**Scope:** Electron-only (correct — the browser dev-stack already has native browser zoom). **Session-only:**
factor lives in memory, resets to 100% on restart; persisting across launches (write to a settings file)
is an easy follow-up, not done.

**Verified live (2026-06-21):** user confirmed Ctrl + zooms the UI in the running app. (Automated check
was inconclusive — CDP-injected synthetic keystrokes don't reliably reach Electron's `before-input-event`;
a temporary instrumented build proved `setZoomFactor` itself moves `devicePixelRatio`/`innerWidth` and that
the handler fires, then the human keypress settled it. Instrumentation removed; `node --check` clean.)

## ✅ DONE (2026-06-21) — Strong-contrast pass on all three themes (faint text/boxes fixed)

User feedback: text and boxes were too faint against the background — "go for strong, not subtle, on all
items." Everything in the UI inherits from the per-theme CSS custom properties, so the fix was at the
variable layer (propagates to every box + text item at once). Edited **`tooling/amadocs-ui/index.html`**
(source of truth) → synced identical to **`amadocs-desktop/ui/index.html`**. All three themes
(**dark**/default, **light**, **slate**):
- **Text** pushed toward max contrast: `--text`, `--text-muted`, `--text-faint`, and the near-invisible
  `--text-xfaint` (was a 0.40–0.45-alpha ghost → now a solid value).
- **Boxes:** `--border` strengthened dramatically (the main culprit for "faint boxes"); `--bg-hover`/
  `--bg-desk`/`--bg-sel` lifted for clearer panel separation; `--scrollbar-thumb` matched to the border.
- **Badges** (file-type chips): fill alpha ~doubled (0.10–0.16 → 0.20–0.30) with brighter fg.
- **Accents** (green/blue/amber/red) brightened a notch so links/"Connected ●"/warnings stand out.
- **Paper sheet** (Homepage + doc view render on a white `--page-bg`): darkened the fixed faint colours
  `.p-eye`/`.p-sub`/`.p-folio` + the shared `--page-faint`/`--page-p`/`--page-rule` for contrast on white.

Left intentionally faint: `.nav-btn:disabled { opacity:0.35 }` — that's the deliberate "Back/Forward
disabled at history ends" affordance. All changes are value swaps inside existing declarations (no
structural CSS change).

## ✅ DONE (2026-06-21) — Homepage v1 + Home/Back/Forward nav buttons

Two linked pieces of the "lean on the homepage instead of menus" direction. **Lean v1 — we add cards/actions
as the product grows.**

**Top-bar nav (replaces 3 dead dots).** The top-left `.topbar__dot` spans looked like macOS traffic-lights
and did nothing. Replaced with three wired buttons (`.nav-btn`): **⌂ Home / ‹ Back / › Forward**. Backed by a
browser-style history stack (`navHist = {stack, idx, replaying}`) over the three middle-panel destinations
(Home status doc / folder / file preview). The trick: the three destination fns (`showStatusDoc` / `selectFolder`
/ `showFilePreview`) each call `pushHist()` up top, so **every** path into them is captured automatically without
touching each call site; Back/Forward replay via `navDispatch` with `replaying=true` so the replay doesn't
re-record, and re-selecting the same place is de-duped (`navEq`). Boot resets the stack after `initFileTree`
(which calls `selectFolder(home)` for its side-effects) so **Home is the history root** (Back disabled on first
load). `updateNavButtons()` toggles the disabled state at the ends.

**Homepage (repoints `showStatusDoc`).** The old launch surface rendered the server markdown read-only via
`renderStatusMd` (now unused but left in place; the on-disk `AMADOCS-STATUS.md` artifact still generates).
`showStatusDoc` now renders a structured HTML homepage (`renderHomeHtml`) inside the `.vsheet-page` paper sheet:
hero (◆ AMAdocs · version · tagline · generated-time + refresh), a 4-card status grid (**Index** GNOME
connected? · **Library** docs · workspaces · **Model** chat · provider · **Engine** version · Node · vectorDb),
an **Indexed folders** list (or empty-state hint), and **Quick actions** — three wired buttons:
`🗂 Browse my files` (`desktop.homePath`→`selectFolder`), `＋ Index a folder…` (`desktop.pickFolder`→`selectFolder`
→`onSyncFolder`), `⟳ Refresh status`. Active tab label is now `⌂ Home` (was `◆ AMAdocs Status`).

**Engine — `server/endpoints/workspaces.js`:** renamed `buildAmadocsStatusMarkdown()` → `buildAmadocsStatus()`,
which now computes a structured `data` object (engine/model/gnome/library/synced) **and** derives the markdown
from the same values, returning `{ markdown, data }`. The `/amadocs-status` endpoint serves both (`data` feeds
the homepage; `markdown` still writes the on-disk file + stays back-compat). No new data gathered — just exposed.

**Verified live (2026-06-21)** — real dev stack (server :3001 reloaded via nodemon, collector :8888, ollama),
Electron app (`--no-sandbox --remote-debugging-port=9222`, driven via `tooling/cdp.js`):
- `/api/amadocs-status` returns `data` (GNOME connected, 784 docs / 3 ws, granite4.1:3b, 1 synced folder).
- Clean page load lands on Home and **stays** (`navHist.stack ["home"], idx 0`); 4 cards + 3 actions + the synced
  folder all render from the live payload (screenshot `tooling/logs/homepage.png`).
- Back/Forward flow proven: Home → `🗂 Browse my files` (Back on, Fwd off) → `navBack` to Home (Back off, Fwd on)
  → `navForward` to the folder. Disabled-state toggling correct at both ends.
- `node --check` (workspaces.js) + `vm.Script` over both inline UI scripts: 0 failures. Source synced
  `tooling/amadocs-ui/index.html` → `amadocs-desktop/ui/index.html` (identical).

**Cosmetic nits left open:** (1) hero reads "◆ AMAdocs**v1.14.0**" with no space before the version chip — a
margin tweak. (2) The version shown (`v1.14.0`, Node 22) is the **AnythingLLM engine** version, not an AMAdocs
product version — surface a real product version when one exists.

## ✅ DONE (2026-06-21) — Preview decoupled from indexing: any local file previews from disk

Previously `showFilePreview()` only rendered a file if it was in `docIndex` (i.e. already embedded);
every un-indexed file hit the "Right-click → analyse with AI" placeholder. That conflated two distinct
things — **preview** ("let me see this file") and **indexing** ("make it searchable"). The renderers
(`renderPdfInto`/`renderImageInto`/`renderDocxInto`/`renderXlsxInto`) already operate on a `Blob`; the
only reason preview needed an index was that bytes were fetched via the engine's `doc-original?path=
<docpath>` (and a docpath only exists post-index). The Electron bridge had no filesystem-read, so the
UI had no other way to get the bytes. Fixed by adding one:

- **`amadocs-desktop/main.js`** — `read-file` IPC handler: `fs.readFile` → `{ok, data:<base64>, mime}`.
  Path-guarded (string + `isFile()`), **size-capped at 100 MB** (`too-large` error), ext→mime via a
  `PREVIEW_MIME` map (default `application/octet-stream`).
- **`amadocs-desktop/preload.js`** — exposes `readFile(path)` on `window.amadocs`.
- **`tooling/amadocs-ui/index.html`** (→ cp `amadocs-desktop/ui/`):
  - `renderFromDisk(container, fsPath, name)` — reads bytes off disk, builds a `Blob`, dispatches by
    mime exactly like `renderOriginalInto` (PDF/image/docx/xlsx·csv), `text/*`+json → new
    `renderBlobTextInto` (blob `.text()` → escaped via `renderDocText`; `renderTextInto` couldn't be
    reused — it needs a docpath/engine), unknown binary → "no built-in preview" note.
  - `showFilePreview` — when not indexed but `desktop.readFile` exists → `renderFromDisk` (else the old
    placeholder, for the browser dev stack with no bridge).
  - `renderImageInto` — `if(!docpath) return;` after appending the image, so an un-indexed image shows
    raw (no bogus `doc-view?path=null` caption fetch).
  - Not-indexed summary card now reads "Not yet indexed — previewing from disk. Right-click → analyse
    with AI to make it searchable." (preserves the indexing discoverability the placeholder used to carry).

**Net UX:** preview works on **any** local file regardless of index state; indexing (caption/OCR/search)
stays opt-in. Slightly shifts the old "you must index to interact" model — intentional, user-approved.

**Verified live (2026-06-21)** — relaunched Electron (main-process change → full restart), CDP-driven:
`window.amadocs.readFile` present; a non-indexed `.txt` (`Design prompt for AI design.txt`) → renders
2,428 chars from disk (not the placeholder); a non-indexed PDF (`0500_m20_in_12.pdf`, a Cambridge IGCSE
paper) → **8 PDF.js canvases rendered straight from disk**, metastrip `indexed pending`, summary card
shows the new hint (screenshot `tooling/logs/disk-preview-pdf.png`). Zero console/server errors. Parse
checks: `node --check` on main.js + preload.js, vm.Script over both inline UI scripts (0 failures).

## ✅ DONE (2026-06-21) — `p.N` citation labels for backstop PDFs (carry asPDF's page ranges)

Closed the "cosmetic `p.N` citation label for bridged docs" open item — **scope: backstop PDFs only**
(user-chosen Option A; the cheap, zero-regression half). Background: a citation chip shows `p.N` by
mapping the cited chunk's char-offset into a `pages` array (`[{page,start,end}]`) via the UI's
`matchPage()`. Normal collector PDFs build that array in `asPDF` (`collector/.../asPDF/index.js:44`);
bridged docs lost it. There are two bridged cases — **collector-backstop PDFs** (scanned / OCR'd /
empty-text), where `asPDF` *already computes* `pages` but `materializeViaCollector`→`buildDoc` **threw
it away**; and **GNOME-text PDFs** (`tinysparql`), where TinySPARQL hands us flat text with no page
boundaries (would require re-parsing the PDF — deliberately **not** done, to keep ride-on-GNOME intact).

**Fix (`server/utils/GnomeBridge/index.js`, ~5 lines):**
- `buildDoc(meta, text, source, pages = null)` — new `pages` param; emits `pages: Array.isArray(pages)
  ? pages : []`. It's a **disk-only doc-JSON field** read by `doc-view` (`endpoints/workspaces.js:1490`),
  **not** part of the LanceDB metadata schema (`withAmadocsSchema` only forces amadocsSource/sourceMime/
  sourcePath/pageCount/aiSummary) — so pages-bearing and page-less docs mix freely in one workspace
  (normal asPDF uploads already do). `[]` for GNOME flat text → `matchPage` returns null → chip shows no
  label, passage highlight unaffected.
- `materializeViaCollector` — reads `doc = res.documents[0]` and passes `doc.pages` into `buildDoc`. Since
  `backstopFile` (the right-click "analyse with AI" path) also routes through `materializeViaCollector`,
  on-demand analysed PDFs get labels too. Non-PDF extractors (mammoth/xlsx) omit `pages` → `[]`, correct
  (no page concept).

**Verified live (2026-06-21)** — real dev stack (server :3001 + collector :8888, granite, native ONNX
embedder) + the Electron app (`--no-sandbox --remote-debugging-port=9222`, driven via `tooling/cdp.js`):
1. Real gnome-sync drained the two newly-routed blind spots; the **83-page** scanned/OCR'd `Year 6 ICT
   Translated KNTT…pdf` embedded with a full `pages` array (83 ranges, 0→135969 chars = pageContent len).
2. `doc-view` serves all 83 ranges.
3. A scoped `stream-chat` against that PDF returned 4 sources; the **UI's own `matchPage`** resolved them
   to **p.11 / p.18** (Python port + then live in-app).
4. **In the Electron renderer:** the file-scoped REPL rendered citation chips labelled **`p.11` / `p.18`**;
   clicking `p.11` jumped the PDF preview to page 11 with the passage highlighted (screenshot
   `tooling/logs/citation-pN.png`). Server log clean (no errors). GNOME-text PDFs still show no label, by
   design.

## ✅ DONE (2026-06-21) — dryRun over-count fixed: empty `plainTextContent` files no longer phantom-counted

Closed follow-up (1) from the "OBSERVED — cadence loop verified live" entry below: a `dryRun`
gnome-sync's `indexed`/`queued` counted files the real embed path skips, so the preview didn't match
what executed. Root cause (confirmed live on this box against `…/teaching_docs/ICT_MOET`): GNOME
sometimes stores an **empty-string** `nie:plainTextContent` for a file it mis-routed (here an `.xlsx`
and a scanned `.pdf`). Those files have the triple, so `queryFileList` matched them (24 rows) — but
`materialize`→`fetchText` returns `""` → `if (!text.trim()) return null` → they never embed (real
sync held at 22). And they were **also** excluded from `queryBlindSpots`, which used a bare
`FILTER NOT EXISTS { plainTextContent }` — the empty triple *exists*, so NOT EXISTS was false. Net:
counted-but-never-embedded phantoms, falling through **both** queries.

**Fix (2 SPARQL filters, `server/utils/GnomeBridge/index.js`):**
- `queryFileList` — added `FILTER(STR(?t) != "")` so it returns only **genuinely text-bearing** gnome
  files (24 → 22). dryRun's gnome-text count now matches what `materialize` actually embeds.
- `queryBlindSpots` — changed `FILTER NOT EXISTS { ?ie nie:plainTextContent ?anytext }` →
  `FILTER NOT EXISTS { ?ie nie:plainTextContent ?anytext . FILTER(STR(?anytext) != "") }`, so
  "no *usable* text" fires on empty-string text too. The 2 empty-text files (both backstop exts) now
  route to the **collector backstop** (officeparser for the xlsx, OCR for the scanned PDF) instead of
  vanishing — strictly better than just correcting the count: they actually embed now.

**Verified (2026-06-21)** — `node --check` passes; the exported query fns run directly against the live
LocalSearch daemon over D-Bus (no server/DB needed): on ICT_MOET, `queryFileList` 24→**22**,
`queryBlindSpots` 3→**5** (now incl. `ict_quiz_SA2.xlsx` + `Year 6 ICT…schools.pdf`), dryRun
`indexed` = **27, all with a real extraction path**. Probe confirmed exactly 2 files there carry an
empty `plainTextContent` — the two now reclassified. The delta/state/cap machinery is untouched (the
queries feed `current` the same way). Remaining inherent optimism: a scanned PDF whose OCR yields
nothing is still counted in `queued` — unavoidable without running the collector in dryRun.

## ✅ DONE (2026-06-20 PM) — Collector backstop: GNOME's extraction blind spots now embed (docx + OCR/vision)

Closed the long-standing "ride on GNOME inherits GNOME's silent blind spots" gap (the docx/scanned-PDF/
image holes flagged repeatedly below). The sync path only ever embedded files GNOME had already extracted
text for (`nie:plainTextContent`), so **docx/xlsx/pptx that GNOME's OOXML extractor mis-routes** (the
WPS-mime sniffing bug — 175 recorded `"Document must begin with an element <book>"` failures on this box),
**scanned/image-only PDFs**, and **images** were invisible. This was also why right-click **"analyse with
AI" on an image was a dead end** — `ctxAnalyse` needed a `docpath`, but images are excluded from bulk
index and had no ingest route to ever get one. **Both were one root cause:** AMAdocs' own collector
extractors (`asDocx`→mammoth/officeparser, `asPDF`→OCR fallback `ocrPDF`, `asImage`→OCR + moondream
caption) existed but were never called from the sync path. Fix reuses them wholesale — **no new
extraction code.**

**Design split (user-chosen):** office docs (docx/xlsx/pptx) + scanned PDFs are backstopped
**automatically during folder ⟳ sync / cadence**; images are **on-demand only** via right-click
(vision captioning is heavy — keep it opt-in, matching the existing `⚡ analyse` UI for images).

**Engine — `server/utils/GnomeBridge/index.js`:**
- `buildDoc(meta, text, source)` — new `source` param tags `amadocsSource:"collector-backstop"` (vs the
  default `"tinysparql"`); both are flat text served in place via `doc-original`'s `sourcePath` fallback.
- `queryBlindSpots({folder,exclude})` — sibling of `queryFileList` but `FILTER NOT EXISTS { ?ie
  nie:plainTextContent ?t }` + a backstop-extension filter (`.docx/.xlsx/.pptx/.doc/.xls/.ppt/.pdf` —
  images deliberately NOT in bulk). Same `GROUP BY ?u + MAX(?m)` double-row guard.
- `materializeViaCollector(slug, url)` — runs `CollectorApi.parseDocument(name, {absolutePath})`
  (parse-only; `processSingleFile` honours `absolutePath`+`parseOnly` → **never trashes/stashes the
  user's real file**), takes `documents[0].pageContent`, builds the doc via `buildDoc(…, "collector-
  backstop")`. Falls back to `EXT_MIME` when GNOME has no node for the file.
- `runSync` folds blind spots into `current` = `queryFileList` ∪ `queryBlindSpots` via a `sourceByUrl`
  map; the EXECUTE loop dispatches `materialize` (gnome text) vs `materializeViaCollector` (collector).
  The whole delta/state/cap/finalize-on-confirm machinery + THE #1 RULE stay unchanged.
- `backstopFile(slug, fsPath, {userId})` — on-demand single-file path (accepts images too). **Idempotent
  by sourcePath:** removes any existing same-path workspace doc (via `Document.forWorkspace` →
  `removeDocuments`) before embedding, so re-analysing never leaves duplicate vectors. Clears the STOP
  pause (user-driven), and records office/PDF files that live under a synced folder into that folder's
  state (matching url) so the cadence won't re-embed them.

**Engine — `server/endpoints/workspaces.js`:**
- `POST /workspace/:slug/analyse-file { path }` — thin wrapper over `backstopFile` (mirrors the
  `gnome-sync` wrapper). The right-click "analyse with AI" path for images / image-only PDFs.
- Generalized the `doc-original` in-place fallback from `amadocsSource === "tinysparql"` →
  `amadocsSource && sourcePath`, so backstop docs are first-class for preview + the citation loop.

**UI — `tooling/amadocs-ui/index.html` (source of truth) → `cp` `amadocs-desktop/ui/index.html`:**
- `analyseFile(entryPath)` helper (`POST …/analyse-file`).
- `ctxAnalyse` rewired: if the file already has a `docpath` → existing `deepSearchDoc` ("re-analyse");
  **else → `analyseFile()`** (was a dead-end toast). Both branches got a `setTimeout(refreshAiState,
  4000)` follow-up so the chip/dot reliably flips (the workspace doc list lags the embed by a beat).

**⚠️ Bug found + fixed mid-verify — duplicate vectors when on-demand + cadence both hit one file.** A
manual `analyse-file` and a cadence sync both embedded the same docx (the on-demand path had no dedup),
leaving two workspace docs for one `sourcePath`. Fix = the sourcePath-idempotency in `backstopFile`
above; re-analysing now collapses any duplicates to one. (Narrow residual: a special-char path where
`pathToFileUrl`'s encoding differs from GNOME's url could miss the state-dedup and let the cadence
re-embed once — self-heals on the next analyse.)

**Verified live (2026-06-20 PM) on this GNOME box** — real engine (granite, native ONNX embedder,
collector), driven by curl + CDP (`tooling/cdp.js`) against the running Electron app:
- **docx:** `…/ICT_MOET/VTA_Term3_week1_10_MrKieron_ICT.docx` (a recorded GNOME `<book>` failure) →
  mammoth extracted **5,352 words / 37,009 chars** → embedded; scoped `stream-chat` answered "the teacher
  is Kieron ODonnell" with **all sources attributed to that docx** (scopePath pre-filter working).
- **image:** right-click → "analyse with AI" on a fresh `.jpeg` flipped its chip **`⚡ analyse → ✓ deep`**
  (dot on) in ~12s in the live renderer, via the real `ctxAnalyse` handler.
- **doc-original** streams backstop docx (122 KB) + image (2.8 MB) in place (HTTP 200, correct MIME).
- **No duplicates:** dedup collapsed a 2→1 dup and a re-sync didn't re-create it — **0 duplicate
  sourcePaths workspace-wide** (28 docs / 28 unique paths).
- **dryRun** on ICT_MOET now *sees* the blind spots (`indexed` 24→27); they embed for real instead of
  being phantom-queued.

**⚠️ Caveats:** (1) ~~**moondream is NOT pulled on this box** (only granite) → image *captioning* is
skipped; only OCR text lands.~~ **RESOLVED 2026-06-20:** `moondream:latest` (1.7 GB) pulled; captioning
live. Re-verified end-to-end via the `VisionCaption` module against `tooling/test-docs/test-graphic.png`
(model `moondream`, basePath `http://127.0.0.1:11434`, 334-char caption — correctly read the yellow
circle / green rectangle / red triangle / blue sky). For good photo/diagram/whiteboard search this is now
on by default; a fresh box still needs `ollama pull moondream`. (2)
`removeDocuments` leaves orphan document-JSON files under `storage/documents/gnome-<slug>/` (harmless —
not workspace docs, no vectors). (3) The dryRun text-less over-count (below) is still open — but it now
over-reports *less*, since the blind-spot office/PDF files it counts genuinely embed.

## 🔎 OBSERVED (2026-06-20 PM) — cadence loop verified live; dryRun `queued` over-counts text-less files

Booted the dev stack (server :3001 + collector :8888; the upstream React frontend :3000 fails with
`cross-env: not found` — not installed, and we don't ship it, so benign) and the Electron app
(`electron . --no-sandbox`, reusing the running stack; chrome-sandbox still not SUID-root on this box).
Verified the **"ride on GNOME" indexing loop is live and current**:
- **GNOME OS index is warm** — `localsearch status` = idle, **2511 files / 940 folders** (well past the
  earlier 32; the `.git`-ignore fix from the entry below is holding).
- **Cadence scheduler ran this boot** — logged `[gnome-cadence] started — resume in 8s, tick every 15m`,
  and the resume pass actually fired (server up 15:42:27 → `storage/gnome-sync/amadocs-library.json`
  rewritten 15:42:42, the ~8s resume). One folder tracked: `…/teaching_docs/ICT_MOET` → `amadocs-library`.
- **That folder is fully in sync** — GNOME has extractable text for **22** files there; all **22** are
  embedded (22 doc JSONs, 22 workspace docs, 2.4M LanceDB table). 22/22, steady state.

**⚠️ Finding — `dryRun` `queued`/`indexed` counts include text-less files the real embed path skips.**
A `dryRun` gnome-sync on `ICT_MOET` perpetually reports `indexed:24, queued:2`, but a real sync embeds
**0** and holds at 22 (`tracked:22`). Not a stall: of the **31** files GNOME knows in that folder, only
**22 have `nie:plainTextContent`** — the real path queries for text, gets none for those 2, and correctly
skips them. The 2 phantom "queued" files are the known **`.docx` extraction failures** (GNOME's
"Document must begin with an element (e.g. <book>)" — here `Semester Plan ICT…docx` + `VTA_Term3…docx`).
So the dryRun preview count is misleading (over-reports by the count of text-less GNOME entries) even
though actual indexing is correct and complete. **Two follow-ups:** (1) make the dryRun `queued`/`indexed`
count only text-bearing files so the preview matches what executes; (2) the root cause is the GNOME docx
blind spot AMAdocs' own parser/OCR is *meant* to backstop — that backstop isn't wired into the gnome-sync
path, so those docx stay invisible. Neither is a regression; the cadence loop itself is correct.

## ✅ RESOLVED (2026-06-20) — sparse index = the `.git` ignore rule; preview not broken; status doc shipped

Follow-up to the "OBSERVED" entry below — all three threads closed in one session.

**(1) The index wasn't incomplete — it was excluded.** After idling, the count was still stuck at 32
files / 14 with text. Root cause: GNOME Tracker's default
`gsettings org.freedesktop.Tracker3.Miner.Files ignored-directories-with-content` = `['.trackerignore',
'.git', '.hg', '.nomedia']` → **any directory containing `.git` is skipped, recursively.** `teaching_docs`
is a git+Obsidian vault, so the entire tree (973 files: 424 pdf, 196 md, 101 docx…) was ignored. Non-git
dirs (Downloads, Documents top-level) indexed fine, which is why it looked "thin" not "off." The
`localsearch status` failure list (9 docx `<book>` errors) is **stale/irrelevant** — those paths had 0
live entries; the docx extractor actually works fine on them when run directly (`localsearch extract`
pulls full `nie:plainTextContent`). **This is a real "ride on GNOME" blind spot:** the target audience
(developers, Obsidian users) keep docs inside git repos/vaults that LocalSearch ignores by default.

**Fix applied (user-approved):**
```
gsettings set org.freedesktop.Tracker3.Miner.Files ignored-directories-with-content "['.trackerignore', '.nomedia']"
gsettings set org.freedesktop.Tracker3.Miner.Files ignored-directories "['po','CVS','core-dumps','lost+found','node_modules','.git','.svn','dist','build','.cache','.venv','__pycache__','.next','vendor']"
systemctl --user restart localsearch-3.service
```
The first un-skips git repos; the second (ignore-**by-name**) keeps `.git` internals and `node_modules`
out — needed because dropping `.git` from with-content pulled in **124,386** node_modules files. After the
~45s purge: **14 → 901 files with extractable text**, teaching_docs **0 → 973 (804 with text)**,
node_modules → 0. Settings persist in dconf. (For non-GNOME builds later, this argues for AMAdocs' own
watcher+extractor over OS-default behavior.)

**(2) Document preview was never broken — and never used LibreOffice.** It's 100% client-side: `doc-original`
streams the file → UI dispatches by mime → PDF.js / mammoth.browser.min.js / xlsx.full.min.js (all bundled
in `vendor/`), else text fallback. Verified the engine side healthy (`doc-original` 200 + correct MIME;
`doc-view` good JSON) and rendered a real docx live in Electron via CDP (rich mammoth HTML, no error). It
*looked* broken because `showFilePreview()` only renders when the file is in `docIndex`, which is built from
the **amadocs-library** workspace — and that workspace was **empty** (0 docs). Every tree file therefore hit
the "Right-click → analyse" placeholder. Indexed `ICT_MOET` (24 files) via `gnome-sync` → `loadDocIndex()` →
docIndex.size 22 → previewing a real `.docx` rendered correctly. **Resolution: index content (now unblocked
by fix #1); no code change to the preview path.**

**(3) Status doc shipped (read-only v1).** The app now opens to a live `AMADOCS-STATUS.md` in the preview
pane (user's idea — keep config/status out of the chrome). New `GET /api/amadocs-status` in
`server/endpoints/workspaces.js` → `buildAmadocsStatusMarkdown()` gathers workspaces+doc counts, GNOME
status + synced folders, model/embedder, engine/Node version → writes `storage/AMADOCS-STATUS.md` → returns
`{markdown}`. UI adds `renderStatusMd()`/`mdInline()` (handles `**bold**`, `` `code` ``, `- lists`) +
`showStatusDoc()` wired last in BOOT; `.status-doc` CSS. Source `tooling/amadocs-ui/index.html` cp'd →
`amadocs-desktop/ui/`. Verified rendering live. **Deferred to v2:** interactive config controls (radio/toggle
for model, cadence, deep-vs-catalog) — Markdown can't do interactive widgets, but our Electron DOM can; needs
a widget-capable status renderer. **Live-app diagnosis recipe used:** launch `amadocs-desktop` electron with
`--no-sandbox --remote-debugging-port=9222` (reuses running :3001 stack), drive with `node tooling/cdp.js
eval '<js>'`.

## 🔎 OBSERVED (2026-06-20) — the OS index on this GNOME box is sparse so far (core-bet reality check)

First real look at what LocalSearch has actually extracted on this Ubuntu/GNOME box (the move's whole
premise — "ride on a warm OS index"). Drove the live app fine end to end (live tree, AI-state chips,
folder/file REPL scope, both Desktop + Terminal skins — screenshots taken), but the **index itself is
thin**:

- **Daemon up, idle.** `localsearch-3` running; `localsearch status` → *"Indexer is idle"*, scope
  `index-recursive-directories = ['$HOME']` (single-dirs empty). D-Bus reachable, `GnomeBridge.available()`
  = true.
- **Only 32 files / 72 folders indexed**, of which **just 14 have extractable text**
  (`nie:plainTextContent`) — and 14 is *all AMAdocs currently has to ride on*. That's a tiny fraction of
  a real `$HOME` (the `teaching_docs/` corpus alone is hundreds of docs) → the crawl is **incomplete**,
  not warm yet. (Idle-aware: it defers; leaving the box idle for a few hours should let it deepen.)
- **~169 recorded extraction failures**: 155 `.mts` (AVCHD video — no text extractor, expected/benign),
  **9 `.docx`** failing with `"Could not open: Error on line 1 char 1: Document must begin with an
  element (e.g. <book>)"` (a parser error in LocalSearch's docx path), 4 `.xls`, 1 `.png`. The `.docx`
  failures are a **genuine blind spot** — exactly the seam AMAdocs' own parser/OCR is meant to cover,
  and notable because `teaching_docs/` is `.docx`-heavy.

**Plan:** leave the machine idling a few hours, then re-check `localsearch status` + the text-bearing
count (`SELECT (COUNT(DISTINCT ?u)) WHERE { ?ie nie:plainTextContent ?t ; nie:isStoredAs ?do . ?do nie:url ?u }`).
If it stays stuck at ~32, the crawl needs a nudge (`localsearch index --recursive ~/Documents`) or the
`.docx` extractor needs investigating. **This is the core bet's freshness/coverage question made real —
track it.**

## ✅ DONE (2026-06-20) — Granite blessed as the bundled default (was phi3.5)

`granite4.1:3b` (IBM, Apache-2.0) is now the default chat model everywhere, not just in
`.env.development`. Granite stays on-source far more cleanly than phi3.5 — it doesn't leak the
`Context N` chunk-scaffolding that `stripScaffolding`/`capAnswer` have to claw back (4/12 answers on
phi3.5; see the verbosity log below), so blessing it removes the product's most visible rough edge.
Three spots that still hard-coded phi3.5:
- **`amadocs-desktop/main.js` → `packagedEngineEnv()`** — `OLLAMA_MODEL_PREF: "phi3.5"` → `"granite4.1:3b"`.
  This is the real "bundled default": dev reads `.env.development` (already granite), but the packaged
  app passes env explicitly, so this was the one place a shipped build still defaulted to phi3.5.
- **`server/utils/collectorApi/index.js`** — the doc-summary model fallback `"phi3.5"` → `"granite4.1:3b"`
  (only hit when neither `SUMMARY_MODEL_PREF` nor `OLLAMA_MODEL_PREF` is set; matches the blessed default).
- **`server/endpoints/workspaces.js` → `AMADOCS_MODEL_CATALOG`** — granite moved to the **lead** entry,
  tagged `default:true` + "· the default" in its blurb; phi3.5 demoted below phi4-mini and relabelled
  "Older balanced all-rounder" (no longer "the default"). The first-run download overlay pulls the
  catalog's `default:true` entry, so it now fetches granite. (Catalog stays an MIT/Apache allowlist.)

The Phase 2 UI hard-codes no model (the model picker was a Phase 1 feature, not yet re-wired), and the
library workspace is left unpinned (`ensureLibraryWorkspace` sets only `chatMode:"query"`), so it
inherits the system default — i.e. granite — with nothing else to change. `OLLAMA_MODEL_TOKEN_LIMIT`
left at 4096 (safe/conservative; granite handles far more). `node --check` on the changed server file
passes. Historical phi3.5 test logs below are left as-written (they record what was actually run then).

## ✅ DONE (2026-06-20) — Background indexing cadence scheduler (resume-on-relaunch + periodic tick)

The last unbuilt piece of the "ride on GNOME" loop. The bounded `gnome-sync` already leaves no-limit
overflow + any crash/quit-dropped files un-finalized so the *next* sync re-sees them (the durable
"continue" contract) — but nothing was firing those next syncs automatically. Now a server-side
scheduler does: it **resumes pending/overflow work for every synced folder on relaunch** and runs a
**light periodic delta tick** to pick up new/changed/deleted files going forward.

**Refactor first (no behaviour change):** extracted the whole durable PLAN/EXECUTE/finalize-on-confirm
orchestration out of the `gnome-sync` endpoint into **`GnomeBridge.runSync({slug,folder,exclude,limit,
dryRun,reconcile,userId,fromScheduler})`** → returns `{status, body}` (the HTTP-style code the endpoint
relays verbatim). The endpoint (`endpoints/workspaces.js`) is now a ~15-line wrapper; the scheduler
shares the **same** code path, so the subtle no-over-claim/durable logic can't drift between the two.
Endpoint contract unchanged (400/503/200-dryRun/202-execute).

**Scheduler (`server/utils/GnomeBridge/cadence.js`)**, wired into both `bootHTTP`/`bootSSL` listen
callbacks (`utils/boot/index.js`). THE #1 RULE governs every line:
- **Serial, machine-wide.** Never dispatches a folder's embed while ANY worker is still embedding
  (`Embed.hasRunningWorker()`) — one folder at a time, no piling on across workspaces.
- **Respects the global STOP.** New `ingestPaused` latch in `EmbeddingWorkerManager` — `stopAll()`
  sets it; the scheduler skips entirely while it's set. The kill switch *stays* killed: the flag clears
  only on an explicit user-driven (non-dryRun, non-scheduler) `runSync`, or a fresh app launch
  (in-memory). The scheduler's own runs pass `fromScheduler:true` and never clear it.
- **Never pokes the OS indexer silently.** Runs `reconcile:false`, so on a box where LocalSearch is
  dormant it just no-ops on the 503 and retries next tick — it never restarts a system service behind
  the user's back (deliberate, per [[k-base-ingest-safety]]).
- **Bounded.** Relies on `runSync`'s own per-call `GNOME_SYNC_CAP` + the embedder's per-doc cool-down.
- **Cadence:** a resume pass ~8 s after boot, then `setInterval` every `GNOME_CADENCE_MS` (default
  15 min). When a tick leaves work behind (overflow to drain, or a worker still busy) it schedules one
  short follow-up (`GNOME_CADENCE_FOLLOWUP_MS`, default 45 s) so resume/large-batch drains progress
  promptly instead of waiting a whole period between bounded chunks. Single-flight (`ticking` guard);
  all timers `unref()`'d so they never hold the process open. Off switch: `GNOME_CADENCE_DISABLED=1`.

**Verified (2026-06-20):** `node --check` on all 5 changed server files. Two isolated logic harnesses
(stub the two deps via the require cache): the scheduler's **10** guard/flow cases pass — paused →
zero dispatch; worker-running → serial skip + "work remains"; dispatch on folder A stops before
folder B; scheduler opts (`fromScheduler:true`/`reconcile:false`/`dryRun:false`) + saved `exclude`
carried; 503 → no-op; all-caught-up → no follow-up; re-entrant tick single-flights; empty state →
no-op. Plus **8** `EmbeddingWorkerManager`/`GnomeBridge` cases: pause flag latch/clear, `stopAll()`
latches the pause, `runSync`/`listSyncedSlugs` exported.

**✅ VERIFIED LIVE on this GNOME box (2026-06-20)** — against the real engine (TinySPARQL daemon up,
native ONNX embedder, real `BackgroundService` worker), throwaway `cadence-test` workspace, fully torn
down after. (A) **Boot wiring:** the real server logs `[gnome-cadence] started — resume in …s, tick
every 15m` and exits clean — no boot crash, empty-state resume tick no-ops. (B) **Drain, 11/11:**
`/home/user/Downloads` had 11 OS-indexed files; with `GNOME_SYNC_CAP=3` an initial user sync embedded 3
(state finalized 3 confirmed), then successive `cadence.tick()`s **drained 3 at a time — tracked
3→6→9→11** (57 vectors written to LanceDB), and the caught-up tick reported no work. (C) **STOP stays
stopped:** `stopAll()` latched the pause → the next tick no-op'd; a `dryRun` did NOT clear it; an
explicit (non-scheduler) user sync DID clear it. Teardown dropped the throwaway lance table + 57
vectors + 11 doc pins + workspace + doc folder + state file; the real `amadocs-library`/`teaching`/
`my-documents` workspaces were untouched. Not yet exercised through the **packaged Electron** app, but
the engine-side cadence path is now proven end to end on real GNOME.

## ✅ DONE (2026-06-19) — Three UI skins (pure CSS theming, no structural change)

Added two more visual "feels" alongside the existing dark TUI look, all via the existing
`[data-theme]` + CSS-variable mechanism. **No structural/markup/feature changes** — same tree, tabs,
preview and REPL in every skin; the difference is colour + typeface + corner-rounding only.

- **Three skins**, cycled by the top-bar button (`toggleTheme()` → `THEMES` list / `applyTheme()`;
  default honours OS `prefers-color-scheme`):
  - `dark` → **"Terminal"** — dark · monospace · sharp. Byte-for-byte the prior look (its vars equal
    the old hardcoded values), so nothing regressed.
  - `slate` → **"Slate"** — new dim-slate palette · sans · blue accent · medium rounding. The
    "halfway between TUI and desktop" feel (blue accent nods to the search-first reference mock).
  - `light` → **"Desktop"** — the existing light theme, now genuinely sans + generous rounding
    (Finder/Obsidian feel).
- **Made the *feel* themeable, not just colour:** promoted typeface and corner-rounding to vars —
  `--font-ui` (mono vs sans) and `--radius` / `--radius-sm` / `--radius-xs`. `body` + the context-menu
  `font-family` now read `--font-ui`; the ~14 *chrome* `border-radius` values were swapped to the
  radius vars. The simulated document-page/image radii (2px / 0.14rem) were left fixed on purpose —
  a rendered doc shouldn't reflow because you reskinned the window chrome.
- Loaded **IBM Plex Sans** in the font `<link>` (also fixes a pre-existing fallback: the page-preview
  CSS already referenced Plex Sans but it was never loaded).
- Source of truth `tooling/amadocs-ui/index.html`, then `cp`'d to `amadocs-desktop/ui/index.html`
  (verified `diff -q` identical; the inter-copy diff was 100% these skin edits — zero functional drift).

**Gotcha (Electron launch on this box):** `yarn start` aborts with a `chrome-sandbox` SUID error
(*"…must be owned by root and have mode 4755"*). Proper fix needs one sudo:
`sudo chown root … && sudo chmod 4755 …/node_modules/electron/dist/chrome-sandbox`. Dev workaround
used this session: `node_modules/.bin/electron . --no-sandbox`. Electron reuses a running dev stack
if `:3001` already answers (`main.js:197`), so launching it alongside `start-stack.sh` is fine.

## ✅ DONE (2026-06-19) — Phase 2 wiring (port prototype → real UI) — ALL STAGES A–D COMPLETE

Built the Phase 2 "semantic file manager" UI per `AMAdocs-SPEC.md`, staged in 4 stages (A–D).
Source of truth = `tooling/amadocs-ui/index.html`, `cp`'d to `amadocs-desktop/ui/index.html`.
Phase 1 UI backed up at `index.phase1.html` in both locations.

**✅ Stage A done (2026-06-19) — shell + plumbing port.** Replaced the Phase 1 chat UI with the
Phase 2 three-panel shell (file tree / content area / AI REPL) ported verbatim from
`tooling/amadocs-phase2-prototype.html` (dark+light themes, rem scaling, folder list/grid,
preview tabs+metastrip+docarea, right-click context menu). Carried the Phase 1 **engine plumbing**
into the new file as DOM-free / container-parameterized functions ready for stages B–D:
- config/auth: `API`, `API_TOKEN` fetch shim, `apiUrl()`; **`WS_SLUG="amadocs-library"`** (one
  global workspace — folder scope = `sourcePath` filter, NOT separate tables), per-launch `SESSION_ID`.
- `ensureLibraryWorkspace()` (creates the lib ws + forces `chatMode:"query"`; toggles the `#conn`
  banner), `fetchDocuments()`.
- citation→page loop: `getDocView`/`matchPage`/`resolveCitations`/`findPassageRegion`/
  `locatePassagePage` + `CITES`; `capAnswer`/`stripScaffolding`.
- `streamChat()` (DOM-free SSE helper — REPL renders its own frames in Stage D), `isModelMissingError`.
- `gnomeSync()` / `stopAllIngest()` thin helpers; `summarizeDoc`/`deepSearchDoc`.
- preview renderers parameterized to a container: `renderOriginalInto` → `renderPdfInto`
  (lazy per-page canvas + textLayer highlight), `renderImageInto` (+caption/OCR), `renderDocxInto`,
  `renderXlsxInto`, `renderTextInto`.

Static demo data still shows (replaced by live data in stages B–D). Checkpoint eyeballed live
(served on :8080, no engine): three-panel layout matches the prototype; folder↔preview switch +
REPL folder/file scope flip work; right-click menu opens with image-aware "analyse with AI"
primary; **zero JS console errors**; `node --check` on the inline script passes; `#conn` banner
shows correctly when the engine is down.

**✅ Stage B done (2026-06-19) — live file tree (steps 4 / file tree wiring).** Replaced the
static demo `#tree` + folder markup with the **real filesystem**, read through the Electron
preload bridge (`window.amadocs.readDir` / `.homePath`). New code lives in a self-contained
"STAGE B — LIVE FILE TREE" block in the inline script (just above the BOOT IIFE), plus a
generalized `showFile()`/`showFolder()` (now state-driven via a `view` object, demo id-juggling
removed) and an image-aware tweak to `openCtx` (`isImageName` fallback). What it does:
- **Tree:** root = `await homePath()`, auto-expanded. Folders lazy-load children on first expand
  (`readDir` → `makeTreeNode` rows, dirs-first, dotfiles hidden, unreadable/empty → ghost note).
  Chevron toggles ▸/▾; per-row `○` is a neutral AI-state placeholder (Stage C fills ●/○).
- **Selection = scope:** left-click folder → folder view (list + grid rendered from `readDir`,
  real type badges/size/mtime, neutral AI chips) + REPL scope label + intro. Left-click file →
  preview view (tab + metastrip type/size/modified/indexed-unknown + "indexed later" docarea note).
- **Helpers:** `joinPath`/`baseName`/`parentPath`/`extOf`/`badgeFor`/`isImageName`/`fmtBytes`/
  `fmtDate` (POSIX; Linux/GNOME target). AI state, live preview, indexing and chat stay neutral —
  Stages C/D. Without the bridge (browser dev stack) the whole block no-ops and the static
  prototype is left in place.

**Stage B verification (2026-06-19):** inline JS parses (vm.Script over both no-`src` scripts, 0
fail); helper unit-tests pass in node (path/badge/bytes/date edge cases incl. dotfile-has-no-ext,
uppercase ext, unknown→b-txt, 1.5 KB / 1.4 MB rounding). Faithful live checkpoint via a throwaway
`_btest.html` (real page + a mocked `window.amadocs` over a fake FS, served on :8182, driven in
Chrome): home auto-expands, `.cache` dotfile hidden; expanding Documents/→Reports/ lazy-loads and
nests correctly (dirs-first); folder header + list rows + REPL scope track the selection; file
click → preview (tab "Annual-Review-2025.pdf", metastrip "PDF · 1.4 MB · 2025-12-08 · indexed
unknown", back "‹ Reports/", scope "— Annual-Review-2025.pdf", 2 demo tabs hidden, single tree
`.sel`); right-click image → "analyse with AI" primary, right-click PDF → "re-analyse with AI"
(not primary); back button returns to the folder. **Zero console errors** on the live path AND on
the no-bridge fallback (static prototype intact, 17-row demo tree + MOUNTS untouched). `_btest.html`
+ the :8182 server were removed after. Synced to `amadocs-desktop/ui/`. NEXT = Stage C (steps 5–6:
AI-state chips via `fetchDocuments × sourcePath`, folder indexing via `gnomeSync`).

**✅ Stage C done (2026-06-19) — live AI state + folder indexing (steps 5–6).** Added a
self-contained "STAGE C — LIVE AI STATE" block (just before BOOT) that gives every rendered
filesystem entry its real AI status, and wired the folder "⟳ index" action. What it does:
- **Doc index:** `loadDocIndex()` calls the carried `fetchDocuments()` (`GET /workspace/amadocs-library`
  → `ws.documents`), parses each doc's `metadata` JSON, and keys a module-level `Map`
  (`docIndex`) by on-disk **`sourcePath`** → `{mode, aiSummary, docpath, sourceMime}`. Docs with no
  `sourcePath` are skipped (e.g. legacy uploads). Also feeds `docpathByName` (title→docpath) so the
  carried citation loop resolves. Pulled once in BOOT **before** `initFileTree()` so the first paint
  already has state; refilled (`.clear()` first) on every refresh.
- **`aiStateFor(path,name)`** — the single decision point (pure, reads `docIndex`). Returns
  `{indexed, chipCls, chipLabel, dotOn, summary}` for the four states: indexed+`deep`→`● ✓ deep`,
  indexed+`summary` (`amadocsSearchMode`)→`● ✓ catalog`, unindexed image (`isImageName`)→`○ ⚡ analyse`,
  unindexed non-image→`○ ○ pending`. Drives the **tree dot** (`makeTreeNode`: `don`/`doff`), the
  **folder list/grid** chips + dots + the grid summary text (real `aiSummary` when present; the
  amber "Right-click → Analyse" hint for images; pending name uses the `.pending` muted style), the
  **folder header** count (`N files · …  · M indexed`) + sort-strip (`● M indexed · ○ K pending`),
  the **tree counter** (`idx <docIndex.size>`), and the **preview** metastrip (`indexed ● deep`/
  `needs analysis`/`pending`) + the right-panel SUMMARY card (real `aiSummary` or a neutral note).
- **`onSyncFolder()`** (the header `#btnSync` "⟳ index") — THE #1 RULE-safe: a `dryRun` gnome-sync
  previews the plan (`queued`/`indexed`/`remaining`); `queued===0` toasts "already indexed"/"nothing
  catalogued" and just refreshes. Otherwise a real run kicks off the bounded async embed (202), then
  `refreshAiState()` re-pulls `docIndex` and repaints the open folder + every rendered tree dot +
  the counter, with a 4 s follow-up refresh to catch fast completions (live SSE progress is Stage D).
  No-ops (toast) without the desktop bridge.

**Stage C verification (2026-06-19):** both inline scripts parse (vm.Script, 0 fail); node unit-tests
over the **extracted real** `loadDocIndex`/`aiStateFor` bodies pass (sourcePath-keyed mapping skips
no-path docs, deep/summary modes, image vs non-image fallbacks, citation-registry title→filename
fallback, `.clear()` on refill). Faithful live checkpoint via a throwaway `_stageC_check.html` (real
page + mocked `window.amadocs` fake-FS + a canned-engine `fetch` stub whose real gnome-sync flips a
pending file to indexed), served on :8183, driven in Chrome: Home shows `0 indexed · 2 pending` +
`IDX 3`; Documents/ renders all four chips correctly (`a.pdf ✓ deep`, `b.md ✓ catalog`,
`big.pdf ✓ deep`, `draft.txt ○ pending`, `diagram.png ⚡ analyse`) with matching tree dots and
`5 files · 1 folder · 3 indexed`; clicking **⟳ index** toasts "Indexing 1 file(s)…" and `draft.txt`
flips `○ pending → ● ✓ deep` (dot + chip), header → `4 indexed`, sort-strip → `4 indexed · 1 pending`,
counter → `IDX 4`, `diagram.png` stays `⚡ analyse` (image excluded from bulk index); file click →
preview metastrip `indexed ● deep` + the real `aiSummary` in the SUMMARY card. **Zero console errors**
(checked after reload). `_stageC_check.html` + the :8183 server removed after; synced to
`amadocs-desktop/ui/`.

**✅ Stage D done (2026-06-19) — REPL chat + context-menu actions (steps 7–8).** Wired the live
REPL chat and all context-menu actions. Three engine files changed + UI wired:

**Engine (3 files):**
- `server/utils/vectorDbProviders/lance/index.js` — added `scopePath` param to
  `performSimilaritySearch`, `similarityResponse`, `rerankedSimilarityResponse`. If set, adds
  `.where(starts_with(sourcePath, '<path>'))` as a pre-filter on the LanceDB vector search.
  Probed: unquoted identifier resolves case-insensitively in DataFusion (lancedb 0.15.0);
  quoted double-quotes resolve the column but return 0 rows — must stay unquoted. `.where()` is
  a pre-filter by default (confirmed: `postfilter(true)` is the explicit post-filter API). Both
  folder prefix (`/path/folder/`) and exact file path (`/path/file.pdf`) work via `starts_with`.
- `server/utils/chats/stream.js` — added `scopePath` to `streamChatWithWorkspace` signature,
  threads it to `performSimilaritySearch`.
- `server/endpoints/chat.js` — extracts `scopePath` from POST body, passes to
  `streamChatWithWorkspace`.

**UI (`tooling/amadocs-ui/index.html`, synced to `amadocs-desktop/ui/`):**
- `streamChat()` — accepts `scopePath` option, includes in POST body if set.
- `openCtx(e, entryPath)` — upgraded from `filename`-only to full path. Stores in module-level
  `ctxEntryPath`. Live call sites (tree nodes via `full`, list/grid rows via `el.dataset.path`)
  pass the full path; static demo rows pass just the name and fall back gracefully.
- `selectFolder()` — intro text now includes a `<div id="replFolderConv">` anchor for queries.
- `showFilePreview()` — `#docarea` now calls `renderOriginalInto()` for indexed files (real
  preview); `#replFile` renders summary card + `<div id="replFileConv">` for conversation.
- New **STAGE D** block:
  - `runRepl()` — resolves scope from `view.filePath`/`view.folderPath`, calls `streamChat`
    with the right `scopePath`. File mode: streams answer + resolves citations via
    `resolveCitations`/`matchPage`/`getDocView`; citation chips click → `renderOriginalInto`
    with `{targetPage, targetText}`. Folder mode: collects `sources`, renders file-result cards
    (click → `showFilePreview`); no LLM answer shown per Phase 2 spec. Handles empty results,
    abort (new query cancels in-flight), and `isModelMissingError` gracefully.
  - Enter key + "⏎ run" click wired to `runRepl()`.
  - Ctx actions: `ctxAnalyse` → `deepSearchDoc(docpath)` + `refreshAiState` + toast;
    `ctxSummarise` → `summarizeDoc(docpath)` + live summary card update if file is open;
    `ctxReveal` → `desktop.revealInFolder(path)` (falls back to toast in browser dev);
    `ctxPrioritise` / `ctxSaveCopy` → honest "Coming soon." toasts.

**Stage D verification (2026-06-19):** script parses (55,852 chars, vm.Script, 0 fail). Live
Chrome checkpoint on :8181 (static server) with a mocked `window.amadocs` bridge + canned
SSE fetch stub:
- `streamChat` POST body confirmed to include `scopePath` key.
- Folder mode `runRepl()`: appended `.repl-exchange` with `.cmd` + `.repl-folder-result` cards
  (name, snippet, score) + provenance count — verified via `innerHTML`.
- File mode `runRepl()`: `.cmd` ✓ · `.answer` ✓ (streamed text) · `.provenance` ✓ · `.prov-link`
  chips ✓ — all present and correct.
- `openCtx('/home/demo/Documents/spec.pdf')` → `ctxEntryPath` set correctly, `ctxFilename`
  textContent = `spec.pdf` ✓.
- Ctx actions: reveal → "File manager bridge not available in browser dev mode." ✓;
  summarise on unindexed → "File not indexed yet." ✓; prioritise → "Coming soon." ✓.
- **Zero console errors.** Synced to `amadocs-desktop/ui/`.

## 🧭 CURRENT PHASE (2026-06-16) — Semantic search by *riding on* GNOME (TinySPARQL/LocalSearch)

**The bet:** AMAdocs' real value = a semantic/LLM layer on top of the full-text + metadata
extraction the OS desktop indexer (**GNOME LocalSearch**, storing into **TinySPARQL**, the
renamed Tracker3) already does for free. Whole-folder semantic search **from AMAdocs**, without
re-implementing crawl/extract. Test corpus = **`/mnt/space/teaching_docs`**. Architecture chosen
(2026-06-16): **"Ride on TinySPARQL (hybrid)"** — read extracted text from the OS index for the
digital-text majority; use AMAdocs' own parser/OCR/vision only for the blind spots.

**Machine reality (this Arch + ML4W/Hyprland box):** `tinysparql` + `localsearch` **3.11.1**
installed but were **DORMANT** — never run, no index. The user unit `localsearch-3.service` has
`ConditionEnvironment=XDG_SESSION_CLASS=user`, which is unset in the systemd `--user` manager (no
`gnome-session`), so it never auto-starts. **Woke it manually:**
```bash
systemctl --user set-environment XDG_SESSION_CLASS=user
systemctl --user start localsearch-3.service
```
⚠️ **Thesis caveat:** outside a real GNOME Shell session the OS index does **nothing** — AMAdocs
must *enable & own* LocalSearch, not just read a populated store. On a real GNOME box it'd already
be warm.

**Scoped the index to the test folder (saved the old value to restore):**
```bash
# old value was ['$HOME']  → saved in /tmp/localsearch-old-recursive.txt
gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories "['/mnt/space/teaching_docs']"
gsettings set org.freedesktop.Tracker3.Miner.Files index-single-directories "@as []"
```

**Eval results (teaching_docs: 1.1G, 805 extractable docs — 424 pdf, 101 docx, 57 xlsx, 191 md, 6 pptx, 26 jpeg):**
- Crawled **in seconds** (idle-aware, no strain). **648 docs got extracted full text (~19.8M
  chars)**: 424 pdf + 191 md + 17 txt + 16 html. PDF extraction excellent (whole novels ~1M chars
  each; forms; resource packs). Rich metadata too (pageCount/wordCount/created/author/generator).
  Instant FTS5 keyword search (this *is* GNOME Files search). PDF text-layer coverage ~97%
  (29/30 sampled have a digital text layer).
- **3 blind spots = where AMAdocs earns its place:**
  1. ⚠️ **Office docs silently dropped.** **WPS Office** installed user mime defs in
     `~/.local/share/mime/` (`application/wps-office.docx`, …) that win **content-sniffing**;
     LocalSearch's OOXML extractor rule (`/usr/share/localsearch3/extract-rules/11-msoffice-xml.rule`)
     only matches the *standard* OOXML mimes → **all 164 docx/xlsx/pptx (20% of corpus) skipped,
     no error**. The extractor MODULE works fine — `localsearch extract <file>` on a docx yields
     perfect text+metadata; only the daemon's content-type *routing* fails. (Lesson: riding on the
     OS index inherits the OS's silent blind spots.)
  2. **No OCR / vision** — PDF extractor is poppler text-layer only; scanned PDFs (~3%) and the 26
     jpegs come back empty. (AMAdocs' existing OCR + moondream captioning fills this.)
  3. **Lexical only** — FTS is keyword-OR (e.g. `"narrative writing feedback"` → 0 as a phrase, 44
     by word-OR); no concept→wording bridge. That semantic layer is AMAdocs' job.

**Division of labor (now evidence-based):** GNOME owns crawl/monitor/extract of digital text +
metadata (the "don't melt the laptop" problem, already solved by the OS — cf. the parked AI Finder,
"AI Finder (#3)" below). AMAdocs owns embeddings + semantic retrieval + the LLM-answer/citation
loop + backstop extraction for the 3 blind spots.

**Querying TinySPARQL:** `tinysparql query --dbus-service=org.freedesktop.LocalSearch3 -q '<SPARQL>'`.
GOTCHAS: (a) `nie:url` is on the **file** node, `nie:plainTextContent`+`nie:mimeType` on the linked
**content** node — join via `?ie nie:isStoredAs ?do . ?do nie:url ?u`. (b) The CLI has **no JSON
output**, and a standalone `tinysparql endpoint` over the on-disk `~/.cache/tracker3/files/meta.db`
sees an **empty view** (the live daemon holds the WAL) — so query the live daemon over **D-Bus**.

**✅ BUILT — the bridge: `tooling/tinysparql-bridge.js`** (run under Node 22). Queries the live
LocalSearch daemon over D-Bus (file-based queries via `-f` to dodge shell escaping; CONCAT with a
U+001F field delimiter + a newline sentinel so each result row stays one physical line), pulls
`nie:plainTextContent` + metadata for every file under a folder prefix, and writes
**AnythingLLM-shaped document JSONs** (`id/url/title/docAuthor/pageContent/wordCount/…` — the same
shape `collector/.../asPDF` emits) into `server/storage/documents/tinysparql-teaching/`, plus an
embed manifest `tooling/tinysparql-adds.json`. Those paths feed the normal embed path
`POST /workspace/:slug/update-embeddings {adds:[...]}` (native ONNX embedder, **no Ollama needed**).
So AMAdocs adds embeddings on top of the OS-extracted text **without re-parsing**. Verified: writes
correct JSON with real full text + metadata (e.g. a 9,343-char markdown doc). The blind-spot files
have no `plainTextContent` in the index, so they're naturally absent — handled separately by
AMAdocs' own pipeline.
- ⚠️ **Consequence:** TinySPARQL text is **flat — no per-page ranges**. So bridged docs lose the
  citation chip's **page-number label** (`matchPage` has no `pages` to map). The **passage
  highlight** still works (it text-matches against the rendered PDF). Reconstruct `pages` via
  poppler later if the label matters.
- **✅ FIXED (2026-06-16) — bridged docs are now first-class for the viewer + citation loop.**
  Bridged docs never go through the collector's originals-retention path, so they have **no retained
  original** under `storage/originals/<docId>.<ext>` → `doc-original` 404'd → the "Text and images"
  render and the citation PDF-jump were broken for them. Fix: `doc-original` (`endpoints/workspaces.js`)
  now falls back to streaming the user's **real file in place via `data.sourcePath`** when the doc is a
  bridged one (`amadocsSource === "tinysparql"`) and no retained copy exists (gated on
  `fs.statSync(sourcePath).isFile()`; MIME-mapped; retained-original path and the normal 404 both
  unchanged — regression-tested on a normal doc). Verified: `doc-original` for a bridged PDF now
  returns the real 8-page `application/pdf`; `doc-view` returns the full text with `pages:null`
  (graceful — no page label, passage-highlight still works). Net: the only thing bridged docs still
  lack vs. dropped-in docs is the page-NUMBER chip label (flat text). The literal in-browser
  highlight render stays the standing human-eyeball item (matcher already validated against real PDF.js).

**Staying fresh = INCREMENTAL, never re-embed the whole corpus.** GNOME hands us the diff:
- **It keeps its own store live for free** — config has `enable-monitors true`; LocalSearch uses
  **inotify** to update TinySPARQL in near-real-time on add/change/delete. (This is the hard
  "filesystem watching" problem that got the AI Finder parked — inherited solved.)
- **Per-file `nfo:fileLastModified`** (verified populated on all 2,995 files) → delta query:
  `SELECT ?url WHERE { ?do nfo:fileLastModified ?m . FILTER(?m > "<last-sync>"^^xsd:dateTime) }`
  (tested working). Optional push alternative: **`TrackerNotifier`** D-Bus events
  (created/updated/deleted) for event-driven sync instead of polling — v2 nicety, not needed for v1.
- **AMAdocs already has the per-file ops:** changed/new → re-embed just that file (the
  `doc-deep-search` delete-vectors-by-docId → re-add path); deleted/moved → `update-embeddings
  {deletes}`. Cost scales with *changes*, not corpus size.
- **Cadence:** delta-sync on app launch + a light periodic tick; plus an occasional cheap
  **path-set reconcile** (diff GNOME's file list vs. ours — no re-embed — to catch missed
  deletes/renames). All through the safe serial/cool-down queue + global STOP ([[k-base-ingest-safety]]).
- ⚠️ **Caveat (recurring):** GNOME's store only stays live while `localsearch` runs — dormant by
  default on this non-GNOME box. So the refresh flow is **ensure the indexer has run (start it, let
  its idle-aware crawl catch up) → read the delta**. AMAdocs owns keeping it alive, not just reading.

**✅ BUILT + VERIFIED E2E (2026-06-16) — incremental delta-sync: `tooling/tinysparql-sync.js`**
(shares `tooling/lib/tinysparql-lib.js` with the bridge — the bridge was refactored to a thin wrapper
over that lib so both full-pull and delta use one doc-builder; identical Arrow-safe schema). Keeps a
workspace's embeddings in step with the OS index **without re-embedding the corpus**.
- **State:** `tooling/tinysparql-sync-state.<slug>.json` maps `sourceUrl → {docpath, mtime}`. **First
  run BOOTSTRAPS** — adopts whatever's already embedded (maps the live workspace docs' `metadata.url`
  → `docpath`) and records *every* current indexed file's mtime as a dormant baseline, so the 530
  not-yet-embedded files aren't later mistaken for "new." No embedding on bootstrap.
- **Diff → one `update-embeddings {adds,deletes}` POST:** `NEW` (indexed, not in state) → embed;
  `CHANGED` (managed file, `nfo:fileLastModified` advanced) → **delete old docpath + add fresh** (new
  random docpath ⇒ new vector-cache key, so no stale-cache reuse — sidesteps the docpath-keyed cache
  gotcha without needing `skipCache`); `DELETED` (managed file gone from index) → delete. Knobs:
  `SYNC_NEW=0` (track new files but don't embed them), `DRY_RUN=1` (print plan only).
- **Verified live, full NEW→CHANGED→DELETED cycle** on a throwaway `_sync_test.md` with made-up facts
  the model can't know: NEW → embedded (100→101 docs), retrieval returned the planted facts citing it
  @0.985; CHANGED (rewrote the facts) → re-embed swapped vectors in place, retrieval returned the
  **new** facts with zero trace of the old; DELETED → vectors removed (back to 100), retrieval → "no
  relevant information," 0 sources. **Crucially the dry-run showed exactly 1 changed, not 630** — the
  reconcile re-crawl preserves each file's real filesystem mtime, so only the genuinely-changed file
  re-embeds. Cost scales with *changes*, not corpus size, as designed.
- 🔎 **Two findings worth keeping:** (1) `nfo:fileLastModified` is stored with **two identical values
  per file**, which doubled every `queryFileList` row → fixed with `GROUP BY ?u` + `MAX(?m)`.
  (2) ⚠️ **inotify live-monitoring did NOT fire on this non-GNOME box** despite `enable-monitors=true`
  — a new/changed/deleted file was invisible to the daemon until **`systemctl --user restart
  localsearch-3.service`** forced a reconcile crawl. So on a non-GNOME desktop the freshness flow must
  **actively poke/restart the indexer** (or run its own watcher) before reading the delta — relying on
  GNOME's monitors only works inside a real GNOME session. (On a real GNOME box the restart step is
  unnecessary; the `TrackerNotifier` D-Bus push path is the v2 nicety to avoid polling there.) The
  restart is heavier than ideal but correct, and the re-crawl is idle-aware. Wiring this into the safe
  serial queue + a launch/periodic cadence ([[k-base-ingest-safety]]) is the remaining build.

**✅ PRODUCTIONIZED into the engine (2026-06-16) — `POST /workspace/:slug/gnome-sync`.** The bridge +
sync moved off the CLI tooling into the server so the app (UI/Electron) can drive "index a GNOME folder
into a workspace and keep it fresh" directly. **`server/utils/GnomeBridge/index.js`** is the ported
bridge (query LocalSearch over D-Bus → AnythingLLM-shaped doc JSONs into `storage/documents/gnome-<slug>/`;
state in `storage/gnome-sync/<slug>.json`; dev/prod storage-path aware). The endpoint
(`endpoints/workspaces.js`, body `{folder, exclude?="/novels/", limit?=0, dryRun?=false}`): **first call
= full index** (embeds every file LocalSearch has text for, up to `limit`; the rest recorded as a dormant
baseline); **later calls = delta-sync** (re-embed only new/changed via `nfo:fileLastModified`, drop
deleted) — same `computeDelta` as the CLI. Embeds via the engine's own `embedFiles` (native worker) /
`Document.addDocuments`; deletes via `Document.removeDocuments` (mirrors `update-embeddings`).
`Gnome.available()` guards with a clean **503** when the indexer isn't running. **Verified live:** dryRun
is read-only (writes 0 JSONs); a `limit:30` index embedded **30 distinct real docs** (no dupes), a
semantic query returned a grounded IGCSE-syllabus answer, and an immediate follow-up sync was idempotent
(`added:0, deleted:0`).
- ⚠️ **BUG found + fixed mid-build (worth remembering):** the **U+001F field-separator char was lost
  when the util file was written** (the invisible control byte didn't survive the editor write → `US`
  became `""`), so `row.split("")` exploded every result row into single characters (doc `url:"f"`,
  `mtime:"i"` — 30 copies of one garbage file). Fix: declare the separators with **explicit escape
  codes in source** (`US = ""`, `NL = "␛"`), not literal invisible chars. Lesson: never rely
  on literal control characters surviving file-write tooling — use `\uXXXX`.

**✅ DONE (2026-06-16) — the "ride on GNOME" loop is PROVEN E2E.** Booted the dev stack (Node 22),
created a `teaching` workspace (query mode + reranker on), bridged a **100-doc real-teaching slice**
(novels excluded — see bridge change below), embedded all 100 via `update-embeddings`, and ran real
semantic queries. **The whole thesis works:** GNOME LocalSearch-extracted PDF/HTML/md text → bridge →
native-ONNX embed → semantic retrieval → grounded phi3.5 answer **with source attribution tagged
`[tinysparql]`**. E.g. *"What reading/writing skills does IGCSE First Language English assess?"* →
accurate grounded answer citing the syllabus PDF (score 0.998); a concept→wording query (*"how are
students taught to analyse a writer's use of language for effect?"*) correctly bridged to the syllabus'
R1/R2/R4 objectives + the specimen mark scheme — the exact semantic lift FTS can't do. Small md notes
retrieve too (a schedule query pulled `2026-06-08 Full School Rehearsal.md`). Caveats observed, all
already-known: phi3.5 leaks `Context N` scaffolding + embellishes in the **raw** stream (the UI's
`stripScaffolding()`/`capAnswer()` handle both — the `ask-src.js` harness bypasses them); and bridged
docs are flat text so sources attribute by **title, no page-label** (passage-highlight still works via
text-match — by design, see the flat-text caveat above).

- **⚠️ BUG FOUND + FIXED — the bridge must emit a consistent Arrow schema (no `undefined` fields).**
  First embed run: only **14/100** docs landed; 86 (all the tiny md notes) failed with
  `LanceError(Arrow): Need at least 4 bytes in buffers[0] in array of type Utf8, but got 0`. Root
  cause (reproduced directly against the live LanceDB table): the **first** embedded doc fixes the
  collection's Arrow schema; the first alphabetical doc was a PDF carrying `pageCount` (Float64), so
  the schema included that column. The bridge emitted `pageCount: undefined` for non-paged docs
  (markdown) → JSON.stringify **drops** the key → those single-chunk batches `.add()` a row *missing*
  a schema column, and LanceDB-node builds a malformed 0-byte Utf8 buffer for it → the whole insert
  throws. **Fix:** bridge now emits `pageCount: 0` (always a number, never undefined) so every doc's
  key set is identical. Verified: re-embed of the same 100 → **100/100, zero failures.** (General
  lesson for any future custom doc-JSON producer: keep the field set identical across all docs — an
  omitted key on a single-chunk doc is enough to break LanceDB's `.add()`.)
- **Bridge change (`tooling/tinysparql-bridge.js`):** added `env EXCLUDE` (default `/novels/`) +
  `ORDER BY ?u` so a `LIMIT` slice is deterministic and skips the public-domain corpus-filler books
  (648→630 real teaching docs; the slice is IGCSE syllabi/past-papers/mark-schemes + schedule notes).

**NEXT:** (1) ⚠️ **EYEBALLED LIVE (2026-06-17) — render works, but found a real bridged-doc highlight bug
(see "⚠️ FINDING" below).** The chip resolves, clicking opens the **real PDF** (via the `doc-original`→
`sourcePath` fallback), PDF.js renders pixel-accurately, scrolls, and paints a highlight — but for a
bridged doc the highlight **latched onto recurring page boilerplate instead of the cited passage** when
that passage was past page 5 (a silent mis-highlight, not just the missing page-label). **✅ FIXED same
day** (scan-all-pages + cluster-hardened matcher — see "⚠️ FINDING" → "✅ FIXED" below); re-verified live,
highlight now lands on the real passage. Only the `p.N` chip label remains (poppler follow-up).
(2) ✅ **DONE — `gnome-sync` wired into the safe
serial queue** (cool-down + hard STOP + durable finalize-on-confirm + bounded + `ensureIndexer` behind
a `reconcile` flag; see "✅ BUILT … wire `gnome-sync` into the safe ingest queue" below). Remaining
under #2 = the launch/periodic cadence scheduler (the kill/STOP mid-batch live-stack E2E is CLOSED). (3) ✅
**DONE + EYEBALLED LIVE — the UI/Electron flow**: a sidebar "📂 Sync a folder" button → native folder picker
(`dialog.showOpenDialog`) → pick an existing/new collection → an upfront dryRun banner → live progress +
Continue + a STOP button, all driven live in the running app (see "✅ BUILT + EYEBALLED LIVE (2026-06-17) —
gnome-sync UI/Electron flow" below). Remaining overall = the **cadence scheduler** + the cosmetic `p.N`
bridged-doc label. See [[tinysparql-integration]] + [[k-base-ingest-safety]] in product memory.

### ⚠️ FINDING (2026-06-17) — bridged-doc citation highlight mis-targets boilerplate past page 5

**The live eyeball of NEXT #1 PASSED on render but FAILED on highlight precision** — exactly the class
of thing only an eyeball catches. Reproduced on the running Electron app (dev stack reused) against the
`teaching` workspace's 100-doc bridged slice. Harness: `tooling/eyeball-cite.js` (raw DevTools/CDP —
no puppeteer; `Runtime.evaluate` to drive + `Page.captureScreenshot`; screenshots in
`tooling/logs/cite-{1,2,3}-*.png`). Query: *"What reading and writing assessment objectives does the
IGCSE First Language English syllabus assess?"* → grounded R1–R5/W1–W4 answer citing the bridged
syllabus PDF @1.000.

**What works (verified live):**
- Chip resolves and is clickable; it carries **no `· p.N` label** (graceful — bridged docs are flat
  text, `doc-view` returns `pages:null`, `matchPage`→null). As designed.
- Clicking → `doc-original` streams the **real on-disk PDF** via the `data.sourcePath` fallback
  (bridged docs have no retained original) → PDF.js renders the page **pixel-accurately** (the
  "Why study this syllabus?" page with the Cambridge-learner diagram), scrolls, and paints a yellow
  text-layer highlight. The whole bridged → embed → retrieve → cite → open-PDF loop is real.

**The bug (root-caused in `tooling/amadocs-ui/index.html` `renderPdf`, line ~864–875):**
- `needle = normWS(stripChunkHeader(targetText))` (header-strip is fine), but `tp = targetPage` is
  **null** for bridged docs (no page ranges). With `tp` null the highlight search window defaults to
  `startP=1, endP=min(numPages, startP+4)` → **only pages 1–5 are ever searched.**
- The cited R1–R5 passage lives deep in the syllabus (~p.15), **outside** the 1–5 window. So the only
  fragment of the needle that matches within pages 1–5 is the **recurring footer**
  `"Cambridge IGCSE First Language English 0500 syllabus for 2027, 2028 and 2029."` (on every page) →
  `findPassageRegion` highlights that **boilerplate on an early page** instead of the real passage.
  Confirmed: captured `hlText` was exactly that footer line, on an early page.
- Net: for any bridged-doc citation whose passage is past page 5, the highlight is not just absent but
  **actively misleading** (points at page furniture). Dropped-in docs are unaffected — they carry
  `pages` ranges, so `tp` anchors the window on the real passage and the 5-page span covers it.

**Fix options (a design call):**
1. **Scan all pages when `tp` is null** (`startP=1, endP=numPages`, short-circuit on first *strong*
   hit). Simplest; correct; cost = render text layer for every page of big PDFs (mitigate: only build
   the text layer, skip the canvas raster until a hit; or cap at N pages with a "not found" fallback).
2. **Reconstruct `pages` for bridged docs via poppler** at bridge time (already flagged as a "later"
   task under the flat-text caveat above) — gives a real page anchor so the existing 5-page window
   works, and restores the `p.N` chip label for free. Heavier but fixes both the highlight and the
   label.
3. **Harden `findPassageRegion`** to reject short/recurring matches (require a longer contiguous span,
   or prefer the page with maximal needle coverage) so it can't latch onto a one-line footer. Belt for
   (1)/(2), not a standalone fix.

**✅ FIXED (2026-06-17) — chose (1) + (3); (2) left as the page-label follow-up.** UI-only, both copies
synced (`tooling/amadocs-ui/index.html` is source of truth → `cp` to `amadocs-desktop/ui/`):
- **`renderPdf`** — when there's no page anchor (`targetPage` null), call the new **`locatePassagePage(pdf,
  needle)`** to find the right page by a **cheap text-only scan over ALL pages** (no canvas raster — just
  `page.getTextContent()`), then run the existing render+highlight on that page. Anchored (dropped-doc)
  citations are unchanged — they skip the scan.
- **`locatePassagePage`** picks the page with the **largest contiguous match cluster** and requires it to
  be `>=3` fragment hits, so a lone recurring header/footer (which scores ~1–2) can't win.
- **`findPassageRegion`** rewritten to return `{lo,hi,score,count}` and highlight the **largest contiguous
  cluster** of fragment hits rather than the union of all hits — so a far-away footer match can no longer
  balloon the highlighted region across the page. Its one caller (`renderPdfPageHighlight`) updated to the
  object shape.
- **Re-verified live (same CDP harness):** the syllabus citation now highlights **10 spans** of the real
  R1–R5/W1–W4 assessment-objectives passage on the correct deep page (`hlText` = *"This question tests the
  following reading assessment objectives (10 marks): R1 demonstrate understanding of explicit meanings R2
  …"*), vs. the single footer span before. Screenshot `tooling/logs/cite-3-viewer.png`. The bridged-doc
  citation loop is now trustworthy; the only remaining gap is the `p.N` chip label (fix option 2, poppler).

### ✅ BUG — FIXED (2026-06-19, root cause from 2026-06-17) — drag-drop uploads FAILED in a workspace that has bridged (gnome-sync) docs: incompatible LanceDB Arrow schemas

**Symptom (user-reported, reproduced live):** dropping normal files into the `teaching` workspace → the
files parse + summarise fine, then **vanish** ("it won't read anything" / "couldn't read that file"). No
parsing error — the failure is at the **embed/insert** step.

**Server log signature:**
```
[VectorDB::LanceDb] addDocumentToNamespace lance error: LanceError(Arrow): Invalid argument error:
Last offset 1083955200 of Utf8 is larger than values length 0   →   Failed to vectorize <file>.docx
```

**Root cause — two doc producers write two different Arrow schemas into the same table.** A LanceDB
table's column set is **fixed by the first row ever inserted**, and the `teaching` table was first
populated by **bridged tinysparql docs** (`GnomeBridge`), which carry four extra metadata columns the
normal collector upload path does NOT emit. Verified by dumping both schemas:

| `teaching.lance` (seeded by bridge) | `my-documents.lance` (normal uploads) |
|---|---|
| id, url, title, docAuthor, description, docSource, chunkSource, published, wordCount, **amadocsSource, sourceMime, sourcePath, pageCount**, token_count_estimate, text, vector | id, url, title, docAuthor, description, docSource, chunkSource, published, wordCount, token_count_estimate, text, vector |

A normal dropped doc has no `amadocsSource/sourceMime/sourcePath/pageCount`, so its row is **missing
schema columns** → LanceDB-node builds a malformed 0-byte Utf8 buffer (hence the absurd `Last offset …`
> `values length 0`) → the `.add()` throws → vectorize fails → the doc never lands → it "disappears."
This is the **same class** as the 2026-06-16 bridge bug ("keep the field set identical across all docs —
an omitted key on a single-chunk doc is enough to break LanceDB's `.add()`"), but the inverse direction:
there the bridge omitted a key; here the *upload path* omits the keys the bridge established.

**⚠️ Schema survives an empty table.** Clearing all docs (rows → 0) does **NOT** reset the column set —
the table keeps its schema, so drops keep failing until the table itself is dropped/recreated.

**One-time unblock done (2026-06-17):** `db.dropTable("teaching")` (it was 0 rows — nothing lost; the
workspace row in SQLite is untouched). The table auto-recreates with whichever producer writes first
next — so to stay healthy, **seed it with a normal upload** (or keep bridged + uploaded docs in
*separate* workspaces). Repro/inspect schema: `@lancedb/lancedb` → `connect("server/storage/lancedb")`
→ `openTable(slug).schema()`.

**⚠️ Correction to the schema table above (verified live 2026-06-19).** The producers actually
diverge on **five** columns, not four — the 2026-06-17 dump missed `aiSummary`. The normal collector
upload emits `aiSummary` (`collector/processSingleFile/index.js:61-66`) which the **bridge does not**;
the bridge emits `amadocsSource/sourceMime/sourcePath/pageCount` which the **upload does not**. (The
live `teaching.lance` is now *upload*-seeded — `…,token_count_estimate,aiSummary,text,vector`, 13
cols, no amadocs cols — re-created since the 2026-06-17 dropTable, so it's the inverse of what the
table above shows.) The bug bites in **both** seeding directions; reproduced both directly against
`@lancedb/lancedb`.

**✅ Durable fix DONE (2026-06-19) — the gnome schema dominates (full union).** Both producers now
emit an **identical** column set, normalized at the single choke point every embed passes through:
`LanceDb.addDocumentToNamespace` (`server/utils/vectorDbProviders/lance/index.js`). A module-level
`withAmadocsSchema(metadata)` helper forces the full 5-column union onto every doc —
`amadocsSource/sourceMime/sourcePath` → `""`, `pageCount` → `0`, `aiSummary` → `""` when absent — so a
workspace can freely mix bridged + dropped docs in either seeding order (both verified SUCCESS).
Applied in **both** the fresh-embed path and the vector-cache replay path. Safe against embedding
pollution: `TextSplitter.buildHeaderMeta` plucks only `title/published/chunkSource`, so none of the
five columns ever leak into chunk text.

⚠️ **Migration caveat (affects the live `teaching` table now):** LanceDB locks a table's schema at
its first row (and the schema survives an empty table). This fix gives every **newly created** table
the full union. Tables created **before** this fix keep their old set — e.g. the current `teaching`
(13 cols, 12 rows, no amadocs cols) will now reject the wider post-fix writes, so it must be
**dropped + re-indexed** (`db.dropTable("teaching")`, the same one-time unblock; the SQLite workspace
row is untouched, the 12 rows are re-embeddable) to adopt the new schema. On a fresh `storage/`
(gitignored, re-indexed from GNOME per the handover) this is a non-issue; Phase 2 also retires
drag-drop as a producer. See [[tinysparql-integration]].

### ✅ BUILT (2026-06-16) — `gnome-sync` wired into the safe ingest queue (NEXT item #2)

The safety wiring ([[k-base-ingest-safety]] — THE #1 RULE) is **coded + unit/logic-verified** (live
E2E on the dev stack is the remaining human-eyeball item — see "Verification" below). All five gaps
identified in the plan are now closed; built *on* the existing serial worker, not replacing it:

1. **Cool-down between docs** — `jobs/embedding-worker.js` now waits `cooldownMs` BETWEEN documents
   (never before the first / after the last, even across recursion via a module-level `processedAny`);
   value threaded from the parent. `utils/EmbeddingWorkerManager.js` reads it from **`EMBED_COOLDOWN_MS`**
   (default **750ms**; `.env.development` sets **0** for fast dev iteration).
2. **Hard STOP** — worker handles a `{type:"stop"}` message (clear queue, set a `stopping` flag the
   loop checks between items, emit `stopped`, `process.exit(0)`); manager adds **`stopWorkspace(slug)`**
   and **`stopAll()`** (send `stop` + `worker.kill("SIGTERM")`, clean up `runningWorkers`/history). The
   exit handler distinguishes a deliberate stop (emits a clean `stopped`) from a crash (the old
   "exited unexpectedly" all_complete).
3. **STOP endpoints** — `POST /workspace/:slug/embedding-stop` → `stopWorkspace`; `POST /system/stop-all`
   → `stopAll` (the global kill switch the UI button binds to). Ingest only — in-flight chat untouched.
4. **No over-claim / durable resume** — gnome-sync no longer marks files embedded at dispatch. It
   persists a **pre-embed baseline** (deletes + dormant refreshes applied; the about-to-embed files
   deliberately **absent** from state) then finalizes per **confirmed** doc via new `embedFiles(...)`
   hooks `{onDocComplete, onComplete}`. Crash mid-batch → the un-confirmed files re-appear as
   new/changed in the next delta and retry (verified against `computeDelta`). Responds **202** with the
   *plan* (`{mode, queued, deleted, remaining, tracked}`), not `added`.
5. **Bounded request-thread work** — default batch capped at **`GNOME_SYNC_CAP`** (200) with a
   `remaining` "continue next sync" contract; an **explicit `limit`** keeps the old dormant-baseline
   semantics (overflow recorded `docpath:null`, not auto-pulled). Caps the `materialize()` loop too.
6. **Non-GNOME dormancy** — `GnomeBridge.ensureIndexer({restart})` runs the documented
   `systemctl --user` start/restart of `localsearch-3` and polls `available()`; **gated behind a
   `reconcile` body flag** (off by default — never restart a system service silently; deferred to an
   explicit "Re-index" action per [[k-base-ingest-safety]]).

**Decisions taken (the 3 flagged "to confirm"):** cool-down **750ms/doc** env-overridable, **0 in dev**;
default cap **200 + `remaining`**; STOP scope = **both** per-workspace and system-wide (UI uses the
system-wide one).

**Verification done:** `node --check` on all 5 changed files; logic checks (`computeDelta` retries an
unconfirmed pending file + flags an advanced-mtime managed file as changed; the worker loop lands
cool-downs *between* items / skips the last / halts on stop; `EMBED_COOLDOWN_MS` parsing).

**✅ LIVE-STACK E2E PASSED (2026-06-16)** on the running dev server against `/mnt/space/teaching_docs`
(`EMBED_COOLDOWN_MS=2000` to make a batch observably in-flight; server run as plain `node` for exact
kill control). Both failure paths exercised end-to-end — THE #1 RULE is now proven on a running stack,
not just logic-checked:
- **`kill -9` mid-batch (durable resume / no over-claim):** `limit:25` index, killed at 4-confirmed.
  State listed **exactly 4** (docpath set); the 21 in-flight files were **absent entirely** (never
  falsely marked done); **no orphan `embedding-worker` process survived** (killing the parent server
  took the inference child with it). On restart the workspace held **exactly 4** embedded docs (state
  matched reality — no over-claim *and* no under-claim), and the resume dryRun returned
  `mode:sync, queued:21` → the un-confirmed files reappeared and the batch finished to **25/25 with
  all-distinct URLs + docpaths, zero double-embeds**. (Title-level "duplicates" were genuinely distinct
  past-paper files sharing PDF-title metadata — URL is the identity key, and all 25 URLs were unique.)
- **`POST /system/stop-all` mid-batch (hard STOP):** returned `{stopped:["stop-test"]}`, the worker
  child (a real pid) **died instantly**, the **server stayed up and responsive** (ingest-only — STOP
  does not crash the server or touch in-flight chat), state stayed truthful (4 confirmed == 4 embedded),
  and a resume dryRun re-saw the 21 un-confirmed → STOP is durable too.

Net result: no over-claim, no silent file loss, no double-embed, no runaway inference process, server
survives STOP. **The live-stack/human-eyeball item under NEXT #2 is CLOSED.** Remaining open work moves
to **NEXT #3 = the UI/Electron flow** (folder picker + upfront banner + STOP button) and the
launch/periodic **cadence scheduler** that resumes pending files on relaunch.

### ✅ BUILT + EYEBALLED LIVE (2026-06-17) — `gnome-sync` UI/Electron flow (NEXT item #3)

The whole "ride on GNOME" backend was reachable only via CLI/CDP harnesses — **no way for a user to
trigger it in the app.** This wires it into the UI, and the whole flow (incl. the STOP kill switch) was
**driven live in the running Electron app and verified** (see "Verification" below). No engine changes — it
drives the already-live, already-E2E'd endpoints (`gnome-sync`, `/system/stop-all`, `embed-progress`).

- **Entry point (decided: a deliberate menu/settings action, not the drop zone):** a **"📂 Sync a
  folder"** button in the sidebar under "＋ Add documents" (`amadocs-ui/index.html`). Desktop-only — gated
  on `window.amadocs.pickFolder`, so it stays hidden in the browser dev stack (which can't resolve an
  absolute folder path or reach a native picker).
- **Native folder picker:** `main.js` `ipcMain.handle("pick-folder")` → `dialog.showOpenDialog({properties:
  ["openDirectory"]})`; exposed as `window.amadocs.pickFolder()` in `preload.js` (mirrors the existing
  `reveal-in-folder`/`open-folder` bridges).
- **Target collection (decided: pick existing OR new):** the sync modal lists existing workspaces
  (`GET /workspaces`) + a "➕ New collection…" option (created via `POST /workspace/new` at Sync time).
  Because the UI was hard-pinned to one workspace, `WS_SLUG`/`WS_NAME` are now **`let` (mutable)** and a new
  **`setActiveWorkspace(slug,name)`** re-points them + reloads the doc list — so a just-synced folder is
  immediately visible/chattable (a minimal collections-switch, not the full sidebar switcher in TODO #2).
- **Upfront banner (THE #1 RULE, said out loud):** the modal fires **`dryRun:true`** (the read-only plan
  contract) and renders honest counts — *"N files will be indexed now (M more after — run again to
  continue), and K no longer on disk will be removed. Large batches can keep your computer busy — you can
  stop anytime."* A brand-new collection shows a generic "index everything (up to 200 at a time)" line (no
  prior state to diff). dryRun is **always `reconcile:false`** (never restart a service just to preview).
- **Dormant-indexer UX (the non-GNOME caveat):** a dryRun on a box where LocalSearch isn't running returns
  503 → the banner says *"your file indexer isn't running"* and auto-ticks a **"Re-scan the disk first
  (slower)"** checkbox, which sets `reconcile:true` on the real run (the deliberate, explicit re-index per
  [[k-base-ingest-safety]] — never silent).
- **Progress + STOP:** on Sync it switches to chat and shows an `addSystemMsg` status bubble. The bubble now
  supports an inline **STOP** button (new `onStop` option → `POST /system/stop-all`, THE #1 RULE kill
  switch) and an **addAction** helper for a **"Continue"** button when `remaining > 0`. Progress is read from
  the **`embed-progress` SSE** channel (opened *before* the `gnome-sync` POST so no events are missed;
  `addSSEConnection` also replays buffered events): `batch_starting`/`doc_starting`/`doc_complete` drive an
  "Indexed X of Y" counter (note: worker `docIndex` is **0-based** — display is `+1`), `all_complete`/
  `stopped` settle the bubble. EventSource auths via `?token=` (it can't set headers; the gate accepts it).
- **✅ EYEBALLED LIVE (2026-06-17)** on the running Electron app against the real OS index (648 docs under
  `/mnt/space/teaching_docs`). CDP harnesses `tooling/eyeball-sync.js` + `eyeball-stop.js` (raw DevTools, no
  puppeteer — the native folder dialog can't be driven over CDP and `window.amadocs` is a frozen
  contextBridge object that can't be monkeypatched, so the test calls the real post-pick `showSyncModalFor()`
  with a fixed path; this is why `openSyncModal` was split into picker + `showSyncModalFor`). Verified, with
  screenshots in `tooling/logs/sync-*.png` + `stop-final.png`:
  - **dryRun banner with real counts:** *"200 files will be indexed now (429 more after — run Sync again to
    continue). Large batches can keep your computer busy — you can stop anytime."* (648 indexed − novels −
    cap 200 = 429 remaining). New-collection path shows the generic "index everything" banner. ✓
  - **Sync executes + progress counter advances:** "📂 Indexed 200 files into 'Teaching Eyeball'. 430 more
    remain." with the **Continue** button (the `remaining>0` path). ✓
  - **Workspace switch:** the app switched to the new collection and **200 docs rendered in the sidebar** —
    synced docs immediately visible/chattable. ✓
  - **STOP (THE #1 RULE) end-to-end:** with `EMBED_COOLDOWN_MS=3000`/`GNOME_SYNC_CAP=40` for a wide window,
    the STOP button renders **live mid-sync** ("📂 Indexed 3 of 40…"); clicking it halted the batch and the
    bubble settled to err-toned *"Sync stopped. Your collection keeps whatever was indexed so far — run Sync
    again to continue."* with **exactly 3 docs kept** (durable, no over-claim — matches the prior endpoint-level
    kill test). ✓
  - Note (harness, not a product bug): `Page.captureScreenshot` is flaky **during** active embedding on this
    box (renderer busy) — screenshot after the batch settles, or retry. The UI itself never stalled.
  - `node --check` on `main.js`, `preload.js`, and the extracted UI script all pass; UI copies synced
    (`tooling/amadocs-ui/index.html` → `amadocs-desktop/ui/`). Test workspaces cleaned up afterward.
- **Still open:** the **cadence scheduler** (resume pending files on relaunch) and the cosmetic `p.N`
  bridged-doc citation label (poppler).

---

#### Original plan (kept for reference)

Detailed, code-grounded plan for the safety wiring ([[k-base-ingest-safety]] — THE #1 RULE).
Verified the live code; the serial worker already exists, so this builds *on*
it rather than replacing it.

**The actual gaps (confirmed in code):**
1. **Over-claims completion (the big one).** `EmbeddingWorkerManager.embedFiles()` is **fire-and-forget**
   — it returns right after `worker.send({type:"embed"})` (`EmbeddingWorkerManager.js:149`), before any
   embedding happens. But the gnome-sync endpoint then *immediately* `Gnome.saveState()` with every file
   marked `docpath`-set and responds `added: adds.length` (`workspaces.js:461,490,497`). So **state records
   files as embedded before they are**; a crash leaves state lying, the file's mtime is unchanged, and the
   next delta never retries it. Also breaks durable/resume-at-relaunch.
2. **No cool-down.** Worker loop runs files back-to-back (`embedding-worker.js:64`).
3. **No hard STOP.** Only per-file `removeQueuedFile`; no kill-the-child / halt-all. (`worker.kill("SIGTERM")`
   already used for scheduled jobs at `BackgroundWorkers/index.js:315,355` — mirror it.)
4. **Unbounded upfront work in the request thread.** Endpoint materializes *all* `toEmbed` synchronously
   (2 SPARQL + a JSON write per file, `workspaces.js:459`) before embedding starts; bounded only if `limit`
   is passed.
5. **Non-GNOME dormancy.** On a non-GNOME box inotify doesn't fire; the endpoint reads a stale index unless
   LocalSearch is poked/restarted first. Not handled today.

**Design decision: keep it async + SSE, finalize state on confirm.** The established pattern
(upload-and-embed, today's gnome-sync) is async + SSE progress, not a blocking request. A safe batch can
run for *hours* (the #1 RULE case), so we must NOT hold the HTTP request open. Respond immediately with the
*plan*; a listener finalizes state per confirmed doc — which gives durability for free (un-confirmed files
reappear in the next delta and retry).

**The change set:**
1. **`jobs/embedding-worker.js`** — after each doc (success or fail) `await sleep(cooldownMs)` before the
   next (skip after the last); read `cooldownMs` from the `embed`/`add_files` message (default ~750ms;
   0 = off for dev). Add a `stop` message type: clear `queue`, set a stopping flag the loop checks between
   items, emit `stopped`, `process.exit(0)` (belt-and-suspenders with the parent `kill`).
2. **`utils/EmbeddingWorkerManager.js`** — `embedFiles(slug, files, wsId, userId, hooks?)` gains optional
   in-process hooks `{onDocComplete(docpath), onDocFailed(docpath,err), onComplete(summary)}` invoked from
   the existing `worker.on("message")` switch (`:113`) — no protocol change for other callers. Thread
   `cooldownMs` (env `EMBED_COOLDOWN_MS`) into the payloads. Add `stopWorkspace(slug)` and `stopAll()`:
   send `{type:"stop"}` then `worker.kill("SIGTERM")`, clear `runningWorkers`+`eventHistory`, emit `stopped`.
3. **`endpoints/workspaces.js` (gnome-sync)** — dryRun path unchanged. Execute path: (a) `removeDocuments(toDelete)`;
   (b) **persist a pending baseline immediately** — `saveState` with each `toEmbed` url as `docpath:null` +
   deletes applied (durable: crash here → those files look un-embedded next run); (c) materialize → build a
   `urlByDocpath` map, **bounded by default** (if `limit` is 0/unset apply a sane cap, e.g. 200, and report
   `remaining`); (d) `embedFiles(..., {onDocComplete: set nextFiles[url]={docpath,mtime} + debounced saveState;
   onComplete: final saveState})`; (e) respond **202** with the *plan* `{mode, queued, deleted, indexed, remaining}`
   — NOT `added`. Progress over the existing SSE channel.
4. **`utils/GnomeBridge/index.js`** — `ensureIndexer({restart})`: if `!available()` (or `restart`), run the
   documented `systemctl --user set-environment XDG_SESSION_CLASS=user` + `start`/`restart localsearch-3.service`,
   poll `available()` with a timeout; try/catch → degrade to the current 503. Gated by a `reconcile` body flag
   (off by default; UI requests it). Closes Gap 5. *(Note: [[k-base-ingest-safety]] deprioritizes this to a
   later explicit "Re-index" button — keep it behind the flag, don't auto-restart silently.)*
5. **Global STOP endpoint** — `POST /workspace/:slug/embedding-stop` → `stopWorkspace(slug)`; and
   `POST /system/stop-all` → `stopAll()`. The #1 RULE kill switch for *ingest* (not in-flight chat).

**Out of scope (NEXT item #3 / UI):** folder picker, the upfront banner (calls gnome-sync `dryRun:true`
first → confirm → real run; the dryRun contract is the seam, already supported), STOP-button binding, and
the launch/periodic cadence scheduler (the cadence is what *resumes* pending files on relaunch — enabled by
the finalize-on-confirm work here).

**Decisions to confirm before building:** (1) default cool-down value + per-doc vs per-N (proposing 750ms
per-doc, env-overridable, 0 on dev); (2) default batch cap when `limit` unset (proposing 200 + a `remaining`/
continue contract); (3) STOP scope — per-workspace + system-wide (lean: build both, UI uses system-wide).

**Verification when built:** unit (cool-down skips last item; `stop` clears queue+exits; `computeDelta`
retries a file whose pending state never confirmed); E2E on `/mnt/space/teaching_docs` (the existing
NEW→CHANGED→DELETED cycle, **plus** kill the server mid-batch → next sync re-embeds exactly the un-confirmed
files, **plus** hit STOP mid-batch → worker child dies and state stays truthful).

## Strategy

Fork the **AnythingLLM** engine (MIT) for the hard parts (ingestion, OCR, embeddings, vector
store, RAG) and build a **purpose-built simple UI + Electron wrapper + bundled local LLM** on
top. We are *integrators/packagers*, not reinventing the RAG stack. The product value is
ruthless simplicity for non-technical users.

## Architecture

```
┌─────────────────────────── AMAdocs (Electron app) ───────────────────────────┐
│  Electron main process (main.js)                                              │
│    └─ on launch: spawns child processes, shows splash, health-checks, loads UI│
│                                                                               │
│  AMAdocs UI (ui/index.html)  ──HTTP──► Engine API (localhost:3001)            │
│    drop zone · chat · doc viewer · collections                                │
│                                                                               │
│  Child processes (all local, spawned by Electron):                            │
│    • Ollama        :11434   local LLM runtime (GPU) — model: phi3.5 (MIT)      │
│    • Server        :3001    AnythingLLM server: RAG, chat, LanceDB, SQLite     │
│    • Collector     :8888    document parsing + OCR (tesseract.js)              │
│                                                                               │
│  Embeddings: native ONNX (all-MiniLM-L6-v2)   Vector DB: LanceDB (per-collection table) │
└───────────────────────────────────────────────────────────────────────────────┘
```

Each **collection** = an AnythingLLM "workspace" = its own LanceDB table (isolated, scoped search).

## Repo layout (`/mnt/space/k-base/`)

- `anythingllm-upstream/` — forked engine (server / collector / frontend). We use server+collector.
- `amadocs-desktop/` — the Electron app. `main.js`, `loading.html`, `ui/index.html`.
- `tooling/` — dev helpers:
  - `ollama/bin/ollama` — userspace Ollama 0.30.7 (no sudo). Models in `tooling/ollama-models/`.
  - `amadocs-ui/index.html` — **source of truth for the UI** (copied into `amadocs-desktop/ui/`).
  - `start-stack.sh` — runs the 3 services as dev servers; logs in `tooling/logs/`. **Now pins
    `nvm use 22`** (was EOL 18.18.0). `yarn` under Node 22 comes from **`corepack enable`** (one-time;
    pulls yarn 1.22.22) — without it the stack dies with "yarn: command not found". It expects
    Ollama already serving on :11434 with `OLLAMA_MODELS=tooling/ollama-models` (start it separately:
    `tooling/ollama/bin/ollama serve`).
  - `cdp.js` / `ask.js` / `leakscan.js` — dev-run drivers (added 2026-06-14). `cdp.js` drives the
    live Electron UI over the DevTools port (`--remote-debugging-port=9222`) via Node 22's global
    `WebSocket`. `ask.js`/`leakscan.js` hit `stream-chat` to capture raw model output / scan for the
    phi3.5 leak. **Both send a fresh `sessionId` per call** — without it, the non-thread chat path
    accumulates `api_session_id:null` history and replays it, ballooning the prompt to 3800+ tokens
    and slowing every subsequent call (a test-harness footgun, and live proof that the UI's
    per-launch `SESSION_ID` scoping matters for perf, not just memory).
  - `test-docs/` — sample files. `dept-reports.pdf` (10 pages, unique prose + one buried fact
    per page) is the citation/jump-to-page test asset; `test-curriculum.pdf` is image-only
    (no text layer — useless for text/citation tests).

## Prerequisites

- **Node 22** (via nvm). `nvm install 22`. Electron spawns the engine with the bundled Node
  binary, which is now Node 22.
  - **Migrated off Node 18 (EOL) to Node 22 — DONE, packaged AppImage rebuilt + verified
    end-to-end, 2026-06-14.** The "doesn't build on Node 26" lore is about *source* builds —
    every native module the engine ships (`@lancedb/lancedb`, `sharp`, `canvas`,
    `onnxruntime-node`, `@prisma/client`) is a **prebuilt N-API binary**, ABI-stable across Node
    majors. All five load *and run* unchanged on Node 22 (**and 24**) with **no rebuild**, and a
    full server+collector boot + ingest + retrieval + grounded chat passed end-to-end on the
    **packaged Node 22 AppImage** with no problems. So the EOL-18 exit was just "swap the bundled
    binary," not a rebuild project. See `PACKAGING.md` → Node 18 EOL.
- Ollama (bundled in `tooling/`), with `phi3.5` pulled.

## Run it

**As the desktop app (the real thing):**
```bash
cd /mnt/space/k-base/amadocs-desktop
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
export WAYLAND_DISPLAY=wayland-1 DISPLAY=:1
setsid nohup ./node_modules/.bin/electron . > /mnt/space/k-base/tooling/logs/electron.log 2>&1 < /dev/null &
```
Electron cold-boots the whole engine (~8s) and opens the window. If a dev stack is already
running, it reuses it.

**As a dev stack (for fast UI iteration in a browser):**
```bash
bash /mnt/space/k-base/tooling/start-stack.sh          # server/collector/frontend
cd /mnt/space/k-base/tooling/amadocs-ui && python3 -m http.server 8080   # the AMAdocs UI
# open http://localhost:8080
```

## Engine config (`anythingllm-upstream/server/.env.development`)

`LLM_PROVIDER=ollama` · `OLLAMA_MODEL_PREF=phi3.5` · `EMBEDDING_ENGINE=native` ·
`VECTOR_DB=lancedb` · `DISABLE_TELEMETRY=true`. Changing server code/config needs an Electron
restart (server runs as plain `node`, not nodemon).

## Custom changes to the fork

- `server/models/systemSettings.js`: rewrote `saneDefaultSystemPrompt` into a **hard-grounded
  default** (answer ONLY from provided context, no outside/general knowledge, say so if the
  answer isn't in the docs, be concise). Goal: stop chatty/generic answers and training-data
  fallback. **Wiring gotcha:** `chatPrompt()` uses `workspace.openAiPrompt ?? saneDefault`, and a
  workspace bakes `openAiPrompt` into its DB column at creation (`workspace.js:211`). So editing
  this default only affects *newly created* workspaces, not existing ones — to retest against an
  existing workspace, update its `openAiPrompt` (API/sqlite). Status: **in progress, uncommitted.**
  Live-tested on a fresh `grounding-check` workspace (David Copperfield PDF — a book the model
  knows): answers stayed grounded in the excerpt but phi3.5 still (a) named the work from outside
  the text (may be reading the filename via the `<document_metadata>` header) and (b) stayed
  verbose. phi3.5 verbosity is the core remaining issue.
- **Hard answer-length cap (2026-06-13) — settled product decision: AMAdocs is a *search tool*,
  not a chatbot; answers are ~one paragraph (~120 words), never an essay.** Enforced in 3 layers:
  (1) **Engine hard stop** — `server/utils/AiProviders/ollama/index.js` sets `num_predict: 200`
  (~120 words) in the `options` of BOTH `getChatCompletion` and `streamGetChatCompletion`. This
  is the real guarantee: the model physically cannot ramble, applies to every workspace/prompt.
  (2) **Prompt** — appended a concision clause to `saneDefaultSystemPrompt` ("search tool, not a
  chat… at most a short paragraph (~120 words), lead with the direct answer, don't pad/hedge").
  Subject to the same openAiPrompt-baking gotcha (existing workspaces need their `openAiPrompt`
  updated; `vision-test` was updated live). (3) **UI trim** — `capAnswer()` in both UI copies
  trims the final answer to ≤120 words ending on the last full sentence, so a token-level cut
  never shows mid-word. **Verified live:** robot-photo Q → engine stopped phi3.5 at 125 words
  (was a multi-page essay); `capAnswer` → clean 109-word paragraph. **Still phi3.5-limited:**
  within the cap it wastes budget on meta-scaffolding and leaks the internal `CONTEXT 0/1` chunk
  labels into the answer — a quality/prompt issue separate from length.
  - **✅ FIXED (2026-06-14 PM) — `stripScaffolding()` UI guard is the real fix.** Measured on the
    dev stack: phi3.5 leaks **4/12** answers, almost all the `Context 0/1/2` chunk-label parroting
    (worst on vague "tell me about the documents" queries; specific-fact questions stayed clean).
    - **Prompt clause (tried, INEFFECTIVE on phi3.5):** appended to `saneDefaultSystemPrompt` a
      *"never refer to 'the context', 'Context 0/1', chunk/document numbers"* instruction. Re-measured
      with it **baked into a fresh workspace → still 4/12.** phi3.5 ignores it. Kept as a cheap belt
      (and a stronger model may honour it), but it is NOT the fix. (Still subject to the openAiPrompt
      baking gotcha — new workspaces only; the packaged app makes `my-documents` fresh on first run.)
    - **UI guard (the guarantee):** new `stripScaffolding()` called inside `capAnswer()` (both UI
      copies) cuts the answer at the first hallucinated marker (`## Instruction/Task/Additional`,
      `Context \d`, `In your response:`, `(Increased difficulty)`, fake `System:/User:/Assistant:`
      turns) **and backs up to the last full sentence** so it never dangles. Catches a short leak that
      fits inside the 120-word cap (the exact failure the live AppImage showed). Unit-tested vs. the
      real leak text + clean/legit answers; the `Context \d` marker requires a digit, so no false
      positive on the word "context". **Still TODO: eyeball the strip in the live UI** (it's only been
      unit-tested + applied to captured raw model output, not watched in the browser).
    - **✅ EYEBALLED LIVE + a UX cost found (2026-06-17):** watched in the running UI, the strip *works*
      but the user found it **confusing** — phi3.5 leaks the scaffolding into the stream, then the guard
      retroactively trims it, so text **appears and then visibly disappears mid-answer**, which erodes
      trust in the answer. By contrast **Granite (`granite4.1:3b`) "sticks to the source text much more
      cleanly"** (user's words) and mostly doesn't leak at all → nothing to claw back, the answer just
      streams straight through. **Lesson: fixing the leak at the source (a cleaner model) is strictly
      better UX than the post-hoc UI strip.** Strong argument for promoting Granite from candidate to the
      bundled default; the `stripScaffolding()` guard stays as a belt for whatever model is loaded, but it
      is a band-aid, not the answer. See [[k-base-granite-eval]] in product memory.
- `server/endpoints/workspaces.js`: added `GET /workspace/:slug/doc-view?path=<docpath>` →
  returns a document's extracted text **plus per-page char ranges** (`pages:[{page,start,end}]`)
  for the viewer and the citation jump-to-page (uses `fileData()`, path-traversal safe).
- `GET /workspace/:slug/doc-original?path=` → streams the **retained original file** with its
  content-type (powers the "Text and images" PDF/image/docx/xlsx render).
- `collector/utils/files` + `processSingleFile`: retain originals (stash → commit under
  `server/storage/originals/<docId><ext>` → discard on failure); `asPDF` writes the per-page
  ranges. `update-embeddings` deletes the matching original on doc removal.
- **API auth gate (2026-06-14) — `server/index.js`.** A single-secret middleware on the
  `/api` router: when `AMADOCS_API_TOKEN` is set, every request must present it
  (timing-safe compare; `Authorization: Bearer <t>` or `?token=<t>` for the export
  download anchor, which can't send a header); `OPTIONS` preflight passes through.
  **Token unset => passthrough**, so the dev stack is unchanged (mirrors the engine's own
  `validatedRequest` dev-passthrough convention). The packaged app mints the token per
  boot in `main.js` and threads it to both the engine env and the renderer (preload
  `window.amadocs.apiToken`); the UI attaches it via a `fetch` shim + `apiUrl()`. Closes
  the open-localhost hole (Fable review #3). See `PACKAGING.md`.
- `server/endpoints/workspaces.js`: **model picker + download** (added 2026-06-13). A curated
  `AMADOCS_MODEL_CATALOG` (MIT/Apache only — the single source of truth for what's offered)
  drives `GET /system/model-catalog`; `POST /system/pull-model` proxies `ollama /api/pull` as an
  SSE progress stream and **refuses any model not in the catalog** (licensing guard — keeps the
  non-commercial `qwen2.5` out). Swapping uses the existing per-workspace lever.
  **Gotcha:** the swap is the workspace's `chatModel` column, NOT `OLLAMA_MODEL_PREF`. A pinned
  `chatModel` overrides the env default, so `update-env` silently no-ops against an existing
  workspace (verified live). The UI sets `chatModel` (+ `chatProvider:"ollama"`) via the normal
  `/workspace/:slug/update`.
- **Chat-memory model (2026-06-13) — session-scoped for docs, none for images.** Symptom: the AI
  "regurgitated previous conversations even in a different session." Root cause: the non-thread
  `/workspace/:slug/stream-chat` path fetched history by **workspace only** (`recentChatHistory`
  filters `user_id:null, thread_id:null, api_session_id:null`) and stored turns with
  `api_session_id:null`, so the last `openAiHistory||20` turns in `workspace_chats` replayed into
  every prompt **forever, across app restarts**. The AMAdocs UI had no session/new-chat concept at
  all. Fix (all runtime, so **NOT subject to the openAiPrompt-baking gotcha** — applies to every
  existing workspace immediately):
  - **Session scoping** — UI generates a per-launch `SESSION_ID` (`crypto.randomUUID`, held in
    memory, NOT localStorage → new every relaunch) and sends it in the `stream-chat` body. The
    non-thread endpoint (`endpoints/chat.js`) reads `sessionId` and threads it into
    `streamChatWithWorkspace(…, sessionId)`, which passes `apiSessionId` to BOTH `recentChatHistory`
    and every `WorkspaceChats.new`. Result: a fresh launch never sees an earlier sitting; the old
    `api_session_id:null` rows are simply never matched again (orphaned, harmless — no DB surgery).
    The threaded endpoint already scoped by `thread_id`, left untouched.
  - **Images get NO memory** — `streamChatWithWorkspace` computes `imageGrounded = sources.length>0
    && sources.every(amadocsIsImageSource)` (helper matches an image file-ext on the source `title`
    OR the `Image description:` / `Text found in image:` markers `asImage` writes; the per-chunk
    `title` is the reliable signal since every image chunk carries its filename). When
    image-grounded: history is dropped from the prompt (`promptRawHistory`/`promptChatHistory` → []),
    AND the turn is **not persisted** (`!imageGrounded` guard on the final `WorkspaceChats.new`) so
    it can't pollute a later text question in the same session. Rationale (user call): a photo has
    limited metadata and "nothing to discuss," and the model can't see it anyway.
  - **Image "you can't see it" clause** — when image-grounded, `AMADOCS_IMAGE_PROMPT` is appended to
    the system prompt in-flight: the context is an *automated text description*, the model CANNOT
    view the image, relay the description/detected text, don't claim to look at it or invent visual
    detail. Injected at runtime (not in `saneDefaultSystemPrompt`), so no baking gotcha.
  - Files: `server/utils/chats/stream.js`, `server/endpoints/chat.js`, `tooling/amadocs-ui/index.html`
    (→ synced to `amadocs-desktop/ui/`). **Verified:** image-detection unit cases pass; engine
    syntax-checks; clean cold boot; `stream-chat` with `sessionId` returns valid SSE (no 500).
    **Not yet eyeballed live:** the in-UI behaviour with real photos/docs (mixed-source retrieval
    falls to the doc/session-memory path by design — tune the all-images rule after watching it).

## Headline feature — grounded visual citation loop

The differentiator (see `K-base.md` / product memory): an answer's citation chip jumps to the
**original document, scrolls to the cited passage, and highlights it** in the in-app PDF viewer.

- UI-only logic in `tooling/amadocs-ui/index.html`: `resolveCitations` → `matchPage`
  (chunk→page via the `pages` ranges) for the chip's `p.N` label; on click,
  `renderPdf` renders the **PDF.js text layer** over the page-window canvases and highlights the
  spans of the cited chunk (`findPassageRegion` + `owner[]` span map), scrolling to the first hit.
- **Known limitation:** the chip's page number maps to where the retrieval *chunk starts*, so on
  sparse pages (chunk spans 2–3 pages) it can read 1–2 pages early — the passage highlight covers
  the real fact's page regardless, which is why highlighting (not the number) is the source of
  truth. Page jump is **PDF-only**; other types fall back to plain open. Matcher validated in Node
  against real PDF.js extraction. **✅ EYEBALLED LIVE (2026-06-14 PM):** in the running packaged
  app, clicking a citation chip opened the PDF, scrolled to the cited page, and highlighted the
  passage with **pixel-accurate** word-by-word alignment (PDF.js text layer over the canvas).
  Screenshots in `tooling/logs/live-*.png`. The #1 standing "needs a human eyeball" item is closed.

## Retrieval pipeline & tuning (2026-06-13)

Audited the fork's retrieval path for the "re-find a specific fact in a messy pile" use
case (the real product objective — extractive recall, not chat/synthesis). The semantic
"concept→wording" bridge is the **embedder**'s job, not the LLM's; the LLM only runs after
retrieval. So retrieval quality is the lever, and the LLM can stay small.

**What the fork already has (`utils/vectorDbProviders/lance/index.js`):**
- Pure vector search — `vectorSearch(queryVector).distanceType("cosine").limit(topN)`.
  `topN` default **4**, `similarityThreshold` **0.25** (`schema.prisma`).
- **A real cross-encoder reranker, but OFF by default.** `rerankedSimilarityResponse()`
  over-fetches 10–50 candidates and re-scores them with `Xenova/ms-marco-MiniLM-L-6-v2`
  (`utils/EmbeddingRerankers/native`) down to topN. Gated behind
  `workspace.vectorSearchMode === "rerank"`; schema default is `"default"` (off). The class
  is mis-named "EmbeddingReranker" — ms-marco-MiniLM is a genuine cross-encoder. ~1.6s/18docs
  on CPU per the in-code benchmark.
- **Embedder is a config swap, not an integration.** Default `Xenova/all-MiniLM-L6-v2`
  (384-dim, 256-tok); `nomic-embed-text-v1` (768-dim, 8192-tok) is already supported, with
  `queryPrefix`/`chunkPrefix` (asymmetric query-vs-doc) plumbing present. Upgrading the bridge
  = pick the model + re-ingest, no new code.
- **Chunking:** LangChain `RecursiveCharacterTextSplitter`, chunkSize **1000**, chunkOverlap
  **20** (effective default — no `text_splitter_chunk_overlap` row existed). 20 chars is tiny;
  a fact at a chunk boundary can be split out of any retrievable chunk.

**What's missing:** **hybrid search.** Retrieval is pure-vector; there's no keyword/BM25/FTS
lane even though LanceDB supports it. So the *exact-anchor* case (part numbers, codes, a
literal `XXX`) — which vectors smear — is unaddressed. NOTE: a quick reranker smoke test showed
the cross-encoder is strongly *anchor-aware* (it ranked the sentence containing the literal
token above a better concept match), so the reranker may already recover many exact-anchor
misses — measure on a real pile before deciding hybrid is worth building.

**Changes applied to the dev DB (config, not committed code — like the strict prompt):**
- `vectorSearchMode='rerank'` on all 3 workspaces → reranker now on. Applies to **existing
  embeddings immediately** (no re-ingest needed). Reranker model (`ms-marco-MiniLM-L-6-v2`,
  23 MB) pre-fetched into `storage/models/` so it works offline / no first-query stall.
- `text_splitter_chunk_overlap = 200` system setting (20→200, ~20% of chunk size). **Only
  affects newly-ingested docs** — existing docs keep old chunking until re-dropped.
- DB backed up first: `storage/anythingllm.db.bak-*`.

**Test-from-scratch gotcha — the vector cache.** `addDocumentToNamespace` reuses
`storage/vector-cache/<content-digest>.json` if present, so re-dropping the *same file* reuses
the **old chunks** and silently ignores a new overlap/chunk-size setting. To genuinely re-chunk,
clear `storage/vector-cache/` (moved aside to `vector-cache.bak-*` on 2026-06-13) **and**
delete+re-import the doc. Lever ranking by effort-vs-payoff: reranker (free toggle, done) >
chunk overlap (setting, done) > stronger embedder (config + re-ingest) > hybrid keyword (real
build, not started).

## API the UI uses (unauthenticated in dev single-user mode)

- `POST /api/workspace/new` `{name}` — create a collection
- `POST /api/workspace/:slug/update` `{chatMode:"query"}` — docs-only answering (anti-hallucination)
- `POST /api/workspace/:slug/upload-and-embed` (multipart `file`) — drag-and-drop ingest; **catalogs** the file (embeds only its ~120-word summary card, `mode:"summary"`) — full-text is opt-in via `doc-deep-search` (our reframe, 2026-06-15)
- `POST /api/workspace/:slug/doc-deep-search` `{path}` — upgrade ONE cataloged file to **full-text** semantic search: re-embeds the whole file in place under the same docId, flips `metadata.amadocsSearchMode` to `deep` (our addition)
- `POST /api/workspace/:slug/stream-chat` `{message}` — SSE chat
- `GET  /api/workspace/:slug` — list documents
- `GET  /api/workspace/:slug/doc-view?path=` — document text + per-page ranges + `aiSummary` (our addition)
- `POST /api/workspace/:slug/doc-summarize` `{path,force}` — on-demand ~120-word doc summary (right-click "Summarize"); caches to `aiSummary` (our addition)
- `GET  /api/workspace/:slug/doc-export-embedded?path=` — download a COPY with the FULL metadata (summary + AI description + OCR + provenance + EXIF) embedded in the file's own native metadata via a shared `amadocs:` XMP namespace (PDF/jpg/png) + `docProps/custom.xml` (office); source untouched (our addition)
- `GET  /api/workspace/:slug/doc-original?path=` — stream the retained original file (our addition)
- `GET  /api/workspace/:slug/doc-export?path=` — zip of the original photo + a JSON sidecar (AI description, OCR text, original EXIF, source/provenance) (our addition)
- `POST /api/workspace/:slug/update-embeddings` `{deletes:[docpath]}` — remove docs from a collection
- `POST /api/system/custom-models` `{provider:"ollama"}` — list installed local models (built-in)
- `GET  /api/system/model-catalog` — curated permissive models offered for download (our addition)
- `POST /api/system/pull-model` `{model}` — SSE download progress; catalog-only allowlist (our addition)

## Notable UI behaviours (`amadocs-ui/index.html`)

- **Viewer toggle**: `🔤 Text only` ↔ `🖼️ Text and images` (extracted text vs. rendered original).
- **Deep search affordance**: a *cataloged* file (summary-only) shows a hover **"🔍 Deep search"** pill
  in the sidebar and a right-click **"🔍 Deep search this file"** item; once full-text it reads
  **"✓ Deep searched"**. See "THE SWAP" above.
- **Stop button**: while an answer streams, the send button (➤) becomes a red ⏹ that aborts the
  request (`AbortController`) and keeps the partial answer. Reverts when done.
- Filenames are escaped before going into `innerHTML` (`esc`/`escAttr`) — no markup injection.
- **Model picker** (topbar `🧠 <name> ▾`): lists installed models (friendly labels via
  `KNOWN_MODELS`; non-commercial `qwen2.5` filtered by `HIDDEN_MODELS`), one-click swap. A
  "Get another model…" entry opens a **download modal** (catalog rows with size/licence, live
  progress bar over the `pull-model` SSE); on completion it auto-switches to the new model.

## Performance (dev machine: GTX 1650 Ti, 3.5 GB VRAM)

- Model runs 100% on GPU. Cold start (first query / model load) ~30–70 s; warm queries ~1 s.
- Mitigation: `OLLAMA_KEEP_ALIVE=30m` (set in `main.js`) + a "warming up" hint on first question.
- **AMAdocs is a GPU app (decided): a GPU is recommended; we make no CPU-only performance
  claim and don't benchmark/target a CPU-only path.** It still runs on CPU via Ollama's
  fallback — just not advertised or measured as a supported experience. All numbers here are GPU.

## Known gotchas

- **Don't** use `pkill -f` / `pgrep -f` with the electron path in automation — it matches the
  controlling shell and kills it. Use explicit PIDs (`ss -ltnp`) or `setsid` to launch.
- New workspaces default to chatMode `automatic`, which routes tool-calling models into agent
  mode; the UI forces `query` mode.
- Phi-3.5 is verbose — a strict/concise system prompt (see "Custom changes" →
  `saneDefaultSystemPrompt`) reduces but does not eliminate it; in progress.

## ✅ BUILT (2026-06-15) — THE SWAP: catalog-by-default + opt-in Deep search — *the librarian reframe, made real*

The reframe ([[k-base-alpha-simplification]] in product memory; `K-base.md` §3) flips what happens at
ingest. **Default is now "catalog," not "full scan."** Dropping a file gets it a ~120-word summary and
embeds **only that summary card** as the file's searchable content — cheap, bounded, one tiny chunk —
so the AI librarian can find any file the instant it's dropped, even on weak hardware. **Full-document
embedding (the old default) is now opt-in per file**, via a right-click **"🔍 Deep search"** action.

**The mechanism (a genuinely small swap — `upload-and-embed` does two things, and we split them):**
1. **Catalog at ingest.** `Document.addDocuments(workspace, additions, userId, {mode})` gained a 4th
   arg. `upload-and-embed` now passes `mode:"summary"`, which embeds `catalogText(data)` (the doc's
   `title` + `aiSummary`, falling back to a 2000-char leading slice when there's no summary — covers
   images, whose short vision caption *is* their gist, and the case where the summarizer was down).
   The on-disk document JSON keeps its **full** `pageContent` (viewer/citations unchanged); only the
   *embedded* text is the card. The chosen mode is tagged on `workspace_documents.metadata` as
   **`amadocsSearchMode`** (`"summary"` | `"deep"`). Summaries themselves now generate **by default**
   at ingest — `DOC_SUMMARY_ENABLED` default flipped to **true** (`#attachOptions` `?? "true"
   !== "false"`; start-stack.sh / packaged main.js / collector/.env). Other `addDocuments` callers
   keep the `"deep"` default, so only the AMAdocs drop path is cataloged.
2. **Deep search on demand.** New `POST /workspace/:slug/doc-deep-search {path}` re-embeds the full
   file **in place under the same docId**: `deleteDocumentFromNamespace` → `prisma.document_vectors.
   deleteMany({docId})` (the namespace delete doesn't clear the DB mapping) → `addDocumentToNamespace(
   …, skipCache=TRUE)` → flip `metadata.amadocsSearchMode` to `"deep"`. The `workspace_documents` row
   and the retained original are untouched, so deletion / viewer / "Save copy" all keep working.
   ⚠️ **`skipCache=true` is mandatory:** the vector cache is keyed on the **docpath**
   (`uuidv5(filename)`), *not* the content, so without it the re-embed would just restore the cached
   summary chunks instead of embedding the full text. (`storeVectorResult` then overwrites the cache
   entry with the full chunks, which is what we want.)
3. **UI** (`amadocs-ui/index.html` → synced to desktop). `loadDocuments` reads `amadocsSearchMode`
   from each doc's metadata into `docModeByPath` (legacy pre-reframe docs have no flag → treated as
   `"deep"`, since they *were* fully embedded). Cataloged rows show a hover **"🔍 Deep search"** pill;
   the right-click menu shows **"🔍 Deep search this file"** or a disabled **"✓ Deep searched"**.
   `deepSearchDoc()` POSTs behind a timer status bubble ([[k-base-status-feedback]]) then reloads.
   Upload copy now reads "Cataloged N documents… Right-click any file → 🔍 Deep search…".

**Behaviour note:** a cataloged doc's citations **won't page-jump** (the AI-written summary isn't
verbatim in the doc, so `matchPage` finds nothing → the chip just opens the doc — graceful). Deep
search restores the full **passage-highlight** citation loop. That's by design and is *why* you'd
deep search a file. **Not yet wired** to the safe serial/durable ingest queue
([[k-base-ingest-safety]]) — summarization runs per-file at ingest as before, just on by default;
when the queue lands, summaries + the global STOP ride on the same worker.

**Verified:** all 6 server/UI files syntax-check; extracted UI JS parses; `catalogText` branch
unit-test **6/6**; only the drop path is cataloged. **NOT yet live-E2E'd** in the running app (the
"needs a human eyeball" class) — drop → catalog (1-chunk embed) → librarian find → Deep search →
full-passage citation.

---

## ✅ BUILT (2026-06-14) — Per-document AI summary (catalog card) — *the `aiSummary` mechanism (now the catalog default — see "THE SWAP" above)*

A document can be given a short (~120-word) factual "catalog card" summary, stored as a new
**`aiSummary`** field on the document JSON. It's metadata *about* the file — what it is and what
it covers. Reuses the same ~120-word standard as the chat answer cap. **As of 2026-06-15 this is the
catalog DEFAULT** (the summary is what gets embedded for a freshly dropped file — see "THE SWAP").
The on-demand right-click "Summarize" path below still exists (e.g. to (re)generate a summary for a
deep-searched or legacy doc).

**Trigger history:** originally **ON DEMAND** (right-click "Summarize"), with auto-at-ingest behind
`DOC_SUMMARY_ENABLED=true` (default **false**) — auto-summarising every upload adds a ~25-30s LLM call
per document. **The reframe flipped this:** `DOC_SUMMARY_ENABLED` now defaults **true** and the summary
is embedded as the catalog card. The on-demand `doc-summarize` endpoint remains for explicit
(re)summarise.

**On-demand path (the default):**
- **Server endpoint** `POST /workspace/:slug/doc-summarize` `{path, force?}` (`endpoints/workspaces.js`,
  next to `doc-view`): loads the doc via `fileData()` (path-traversal safe); returns the cached
  `aiSummary` immediately unless `force`; else generates with **the workspace's `chatModel`**
  (the model the user picked, falling back to `OLLAMA_MODEL_PREF`), writes `aiSummary` back onto the
  doc JSON, and returns it. Best-effort: a null summary (e.g. model still downloading) returns
  `{summary:null, error:…}`, never a 500.
- **Server-side `server/utils/DocSummary/index.js`** — twin of the collector util (same leading-slice
  + prompt + `num_predict:200` + `trimToSentence`), used here because the server knows the workspace
  and so can use the exact chat model.
- **UI** (`amadocs-ui/index.html` → synced): a **"🧠 Summarize"** item added to the doc-row
  right-click menu (`showDocMenu`; hidden for images via `isImageName` — their vision caption already
  is their summary). `summarizeDoc()` shows a live **status bubble with a timer** (`addSystemMsg`,
  the proof-of-life pattern [[k-base-status-feedback]]) while the model works, then drops the summary
  into chat as an assistant bubble. `loadTextView()` also renders a persistent **"🧠 AI summary"**
  panel at the top of a document's text view whenever `aiSummary` exists.

**Auto-at-ingest path (opt-in, `DOC_SUMMARY_ENABLED=true`).** Generated at the single funnel every
file drop passes through: `collector/processSingleFile/index.js`. After the converter returns,
`attachDocumentSummary()` summarises each `result.documents[*]`, strips the runtime-only fields
(`location`/`isDirectUpload`), writes `aiSummary` back onto the on-disk JSON, and reflects it on
the returned object. Covers every current + future converter automatically (no per-converter edits).

- **`collector/utils/DocSummary/index.js`** (new, mirrors `VisionCaption`) — POSTs the document's
  **leading slice** to Ollama `/api/generate` with a librarian "catalog card" prompt,
  `num_predict: 200` (~120 words out), `temperature: 0.2`. **Leading slice = first 5 pages when
  per-page char ranges exist (PDF), else first ~8000 chars (~2000 tokens)** — "summarise the first
  few pages, not a 200-page novel," and it bounds the per-file cost on a big drop. Output is
  `trimToSentence()`-trimmed (last full sentence) so a token-level cut never dangles — mirrors the
  UI's `capAnswer`. **Best-effort**: any failure (no model pulled, runtime down, timeout, <200 chars
  of input) returns `null` and **never breaks ingestion**.
- **Model (auto-at-ingest path):** the chat model, threaded via a new
  `summary:{enabled,model,ollamaBasePath}` block in the server's `#attachOptions`
  (`server/utils/collectorApi/index.js`), mirroring the `vision` block. `enabled` defaults to
  **false** (`DOC_SUMMARY_ENABLED ?? "false") === "true"`). `SUMMARY_MODEL_PREF` →
  `OLLAMA_MODEL_PREF` → `phi3.5`. **No extra model to download** — same model as chat.
- **Skipped for:** images (their vision caption already *is* their summary — `VisionCaption.SUPPORTED`
  in the collector path, `isImageName` in the UI menu), parse-only/direct uploads.
- **Env knob `DOC_SUMMARY_ENABLED`** (default **false** = on-demand only) in `collector/.env`,
  `start-stack.sh`, and packaged `main.js` `packagedEngineEnv`. Optional `SUMMARY_MODEL_PREF` override.
- **Exposed to the UI** via `doc-view` (`endpoints/workspaces.js` now returns `aiSummary`) and the
  `doc-summarize` POST endpoint — the APIs the semantic file browser will read/drive.

**Verified live (2026-06-14, phi3.5, running dev stack):**
- **On-demand (the default UX), full E2E through the running engine:** uploaded `dept-reports.pdf`
  with `DOC_SUMMARY_ENABLED` unset → upload took **1s, zero `DocSummary` calls** at ingest,
  `doc-view` `aiSummary: null` (confirms default-off). `POST /doc-summarize` → generated a 98-word
  card with the workspace `chatModel` (30s); `doc-view` then returned the stored summary; a **second
  call returned `cached:true` instantly (0s)**; on-disk JSON persisted.
- **Auto-at-ingest path (opt-in):** `DocSummary.summarize()` on the 11,610-word IGCSE syllabus →
  accurate 127-word card; full `processSingleFile` run on a synthetic report → `aiSummary` on both
  the returned object and the on-disk JSON, clean sentence end. Slicing + sentence-trim unit-tested
  (page-cap stops at page 5, char-cap == 8000, tiny input → null, mid-sentence trimmed).
- **Caveat:** phi3.5 still embellishes within the cap (invented "Duke University" once) — known
  small-model issue, not wiring; mitigated by `temperature:0.2` + bounded input. **Not eyeballed
  live:** the right-click menu item / status bubble / summary panel *in the actual UI* (same
  "needs a human eyeball" class as the citation render). **Not built:** the file browser that
  consumes `aiSummary`; back-filling pre-existing docs (null until summarized — graceful).

### ✅ BUILT (2026-06-14, EXPANDED 2026-06-15) — Embed the FULL metadata INTO a copy of the file (right-click "Save copy with info")

Take a document back **out** of AMAdocs with **everything AMAdocs understands about it** — the AI
summary, the AI vision description, any OCR'd text, and source/provenance — written into the file's
**own native metadata**, so that understanding travels inside the file (visible in OS file managers /
other tools), not just in AMAdocs' store. **The user's source file is NEVER touched** — the server
reads its retained *copy* into a buffer, embeds, and streams a brand-new download. (Mirror of the
never-modify-originals stance; complements the photo-export *sidecar*, which keeps the full record in
a separate JSON — see below for why both exist.)

**Originally embedded only the summary (one flat field per format). Expanded 2026-06-15 to the full
payload via a shared schema** (user direction: "put the metadata into their own metadata formats").
The key realisation: there's no universal metadata model, **but XMP (Adobe's RDF/XML packet) is
natively carried by PDF, JPEG and PNG**, so those three share **ONE schema** — a custom `amadocs:`
namespace (+ standard `dc:description`) — and differ only in *how the packet is injected*. Office
(OOXML) doesn't use XMP; its native home for structured app metadata is **custom document properties**
(`docProps/custom.xml`). For every family we write **both** a standard slot (so generic tools show
something) **and** the full `amadocs:` payload, including a complete JSON blob in `amadocs:data` for a
lossless round-trip back into AMAdocs.

- **`server/utils/MetadataEmbed/index.js`** — `embedMetadata({buffer, ext, metadata})` (the old
  `embedSummary({…,summary})` is now a thin back-compat wrapper; `metadata` may be the full
  sidecar-shaped object OR a bare summary string):
  - **PDF** → injects an **XMP metadata stream** (`/Metadata` in the catalog) + sets Info `/Subject`
    (the slot file managers show) + `/Keywords` tag. Metadata-only, no re-render.
  - **PNG** → two hand-rolled **iTXt** chunks before `IEND`: `XML:com.adobe.xmp` (the full XMP) +
    `Description` (the display line). UTF-8, computed CRC32, no dep, no re-encode.
  - **JPEG** → an **APP1 XMP segment** (`http://ns.adobe.com/xap/1.0/\0` + packet) inserted after SOI
    + EXIF `ImageDescription`/`Software` via `piexifjs`. **No pixel re-encode.**
  - **Office (.docx/.xlsx/.pptx)** → `jszip` writes `docProps/custom.xml` (registers the Override in
    `[Content_Types].xml` + a relationship in `_rels/.rels`) + sets `core.xml <dc:description>`.
- **Three robustness limits handled (all surfaced by live testing on real files):**
  1. **JPEG APP1 64 KB cap** — `buildXmpFitting()` sheds the heaviest field first (trim
     `extractedText` in halves → drop it → drop the JSON blob) so the segment always fits ≤65535.
     (PNG/PDF/Office have no such cap.)
  2. **No re-embedding a doc's own text** — `EMBED_TEXT_CAP = 16000` chars on `extractedText` for the
     embed path. Without it, embedding a 500-page PDF's extracted text **doubled the file** (4 MB →
     8.5 MB) for no gain (the text is already inside it). The **sidecar keeps the complete text**;
     the in-file copy is capped with a "full text in the sidecar export" note. Small photo OCR is far
     under the cap, so images embed their full OCR.
  3. **Control-char / encoding hygiene** — `deepSanitize()` strips XML-1.0-illegal control chars
     (LLMs occasionally emit stray bytes). **The real live bug:** pdf-lib, given the XMP as a JS
     *string*, re-encodes it with single-byte **PDFDocEncoding**, silently corrupting every non-Latin1
     char (em-dash U+2014 → byte `0x14`, curly quote U+2019 → `0x19`, ☕/café mangled). Fix: pass
     **`Buffer.from(xmp, "utf8")`** to `context.stream` so the exact UTF-8 bytes are stored. (PNG/JPEG
     paths already passed UTF-8 buffers, which is why only PDF was affected — and why it cost a long
     debug to find: the "control chars" were never in our data, they were mis-encoded Unicode.)
- **Shared extractor** — `amadocsExtractMetadata({data, slug, originalFile, ext})` in
  `endpoints/workspaces.js` is now the **single source of truth** for the payload (summary, AI
  description split out of `pageContent`, OCR text, provenance, EXIF via `exifr`, image facts via
  `sharp`). **Both** `doc-export` (sidecar JSON) and `doc-export-embedded` (native embed) call it, so
  the two exports can never drift.
- **Sidecar vs. embed — why BOTH stay:** the native embed carries the *gist* visible in
  Explorer/Finder/Office/`exiftool`; the **sidecar (`doc-export` zip) remains the lossless full
  record** — it survives JPEG's size cap, covers formats with no embed writer (HEIC/TIFF/txt/…),
  and survives tools that strip embedded metadata.
- **No new deps** — reuses `pdf-lib`/`jszip`/`piexifjs`/`exifr`/`sharp` already in the tree.
- **Server endpoint** `GET /workspace/:slug/doc-export-embedded?path=`: finds the retained original,
  415s an unsupported ext, **generates+caches `aiSummary` on the fly** if missing, builds the full
  metadata via the shared extractor, embeds, streams the copy as **`…-with-info.<ext>`** (`?token=`).
- **UI** (`amadocs-ui/index.html` → synced): **"💾 Save copy with summary"** item in the doc-row
  right-click menu (`canEmbedSummary`, supported formats only). `saveWithSummary()` fetches as a blob
  behind a timer status bubble, then downloads. *(UI label still says "summary" — rename to "info" is
  a trivial follow-up, batched with the inspect/edit UI below.)*

**Verified live end-to-end (2026-06-15, running dev stack):** standalone suite **26/26**
(PNG/JPEG/PDF/DOCX: XMP round-trips incl. Unicode ☕/café/em-dash, JPEG APP1 ≤65535 even with a huge
OCR, custom.xml registered, every file stays valid, input bytes untouched). Over HTTP against real
docs: **PNG/JPEG/PDF all 200**, `amadocs:data` parses, full payload present (docId, summary, AI
description, EXIF + image facts on the JPEG), PDF `extractedText` capped at 16 KB (4 MB original stays
4 MB), and the XMP packet validates as **well-formed XML**. **Not eyeballed live:** the actual
right-click → download in the UI (human-eyeball class). Standalone test: `tooling/test-metadata-embed.js`.

**⬜ Next (user-requested, not started): inspect + edit the metadata before export.** Let the user
**review the summary/description/OCR/provenance** in a panel before "Save copy with info" / sidecar
export, and **edit** fields (e.g. fix a phi3.5 embellishment) before they're written. The data path is
ready — `doc-summarize` (regenerate/cache) and the shared `amadocsExtractMetadata` already produce the
exact payload; this is a UI panel + a "save edited summary back to `aiSummary`" write.

**Cost note:** this adds one chat-model generation per non-image document at ingest (consistent
with vision running a model per image). For a big drop it's serial + best-effort; turn it off with
`DOC_SUMMARY_ENABLED=false`. When the queued/background ingest (the "dump 100 files" item) lands,
summaries ride along on the same worker.

**⬜ Follow-up idea (2026-06-14): surface summaries in the OS file manager (Nautilus).** The dev
box runs ML4W Hyprland → **Nautilus (GNOME Files) 50.2.2** (GTK4; launched via
`~/.config/ml4w/settings/filemanager`, Super+E). A `nautilus-python` extension (needs the
`python-nautilus` package, not yet installed) could add a right-click **"Summarize with AMAdocs"**
action + an **"AI Summary" column / tooltip / Properties tab** (`MenuProvider` / `ColumnProvider` /
`InfoProvider` / `PropertyPageProvider`). Engine seam already exists: the collector's
`parseDocument` (`/parse`, takes **absolutePath**, parses WITHOUT embedding) → `DocSummary.summarize`
→ cache the result as a `user.amadocs.summary` **xattr** on the file; the column reads the cached
xattr (fast, no recompute). **Guardrails:** must be **pull, not push** — inference only on explicit
right-click; the column reads **cached xattrs only, never auto-runs the model on directory view**
(auto-summarising everything you browse to = the exact lock-up/OOM/background-inference footgun that
PARKED [[k-base-folder-index]] / AI Finder). Note the existing `aiSummary` is keyed by AMAdocs docId
in private storage, NOT by disk path, so this is a *separate, in-place* data path, not a reuse of
those. Caveat: a Nautilus extension is **GNOME-only**, outside the cross-platform Electron bundle —
a Linux/GNOME power-user companion, not part of the shippable app.

## ✅ BUILT (2026-06-13) — AI image analysis (vision captioning) — *v2 feature #1*

Image-only files (photos, whiteboards, receipts, screenshots with no clean text layer) are now
**searchable by content**, not just OCR'd text. A local vision model describes the image; its
output is plain text, so it flows through the existing text→embed→retrieve→cite pipeline with
**zero engine/embedding/search changes**.

**What was the gap:** `asImage.js` ran tesseract OCR *only* and **rejected the file when OCR
found no text** — text-less images were dropped and never indexed.

**What was built:**
- **`collector/utils/VisionCaption/index.js`** (new) — POSTs the image (base64) to Ollama
  `/api/generate` (`images:[…]`, describe-in-detail prompt, `stream:false`). Best-effort:
  any failure (no model pulled, runtime down, timeout, 404) returns `null` and **never breaks
  ingestion**. Resolves the Ollama URL via `OLLAMA_BASE_PATH` → `OLLAMA_HOST` → local default,
  so it works in both the dev stack and the packaged app.
- **`asImage.js` rewritten** — runs OCR **and** caption in parallel, combines them into
  `pageContent` ("Image description:" caption + "Text found in image:" OCR). **Only fails if
  BOTH are empty** — text-less images are no longer dropped.
- **`collectorApi/#attachOptions()`** — added a `vision: { model, ollamaBasePath }` block
  (server env → collector), mirroring the existing `ocr` block. `VISION_MODEL_PREF` (default
  `moondream`) + `OLLAMA_BASE_PATH` added to `collector/.env` and `start-stack.sh`.
- **Catalog + picker** — `moondream` (Apache-2.0, `~1.7 GB`, `type:"vision"`) added to
  `AMADOCS_MODEL_CATALOG`. It's **downloadable** but kept **out of the chat picker** (added to
  `HIDDEN_MODELS`: `moondream`/`llava`/`bakllava`) and the download flow **does not switch the
  chat model to it** (`pullModel` branches on `m.type==="vision"`). LLaVA / Llama-3.2-Vision
  remain excluded — Llama-licensed, breaks the permissive-only stance.

**Verified live (2026-06-13, GTX 1650 Ti):** `moondream` pulled; `VisionCaption.caption()`
produced an accurate description of `test-docs/test-graphic.png` (~10 s cold, <1 s warm);
`asImage` returned `success:true` with combined caption+OCR `pageContent` for that text-less
graphic (previously it would carry only OCR garbage).

**Full data-path E2E verified (2026-06-13, GTX 1650 Ti).** Fresh `vision-test` workspace
(query mode, ollama/phi3.5): `upload-and-embed test-graphic.png` (text-less shapes graphic)
→ collector ran caption (moondream, 12.84s, 334 chars) + OCR (0.61s) in parallel and indexed
combined `pageContent` (OCR alone yielded only `® I`, so the file is answerable *only* via the
caption). `stream-chat` "what shapes and colours appear and where?" returned a grounded answer
naming the yellow circle / green rectangle / red triangle and **cited `test-graphic.png` as its
one source** — proving caption→embed→retrieve→cite end-to-end. (The answer faithfully echoed
moondream's caption quirks — "blue sky with clouds," triangle "top right" — confirming grounding
in the caption text, not the raw image.) **Still not run:** the literal in-browser click +
citation-highlight *render* — but that's the same separate "needs a human eyeball" item already
open for the citation loop, not a vision-specific gap.

**Open / next:** the "dump 100 photos" user still needs **background/queued ingest with
progress** (today uploads are serial with a per-row spinner). Vision inference is heavier than
text, so it especially wants a GPU — consistent with AMAdocs being a GPU app (we don't
benchmark or claim a CPU-only path).

## ✅ BUILT (2026-06-13) — OCR quality (engine-side) — *v2 feature #2 (partial)*

Raised scanned-document OCR accuracy with two well-established prep techniques, applied to
**both** OCR paths (`collector/utils/OCRLoader/index.js`). No new deps — `sharp` and
`tesseract.js` were already in the pipeline. All changes tagged `AMAdocs:`.

**What was built:**
- **Rasterization DPI bumped + made tunable.** `PDFSharp` hard-coded **70 DPI** (a slight
  *shrink* vs the 72 baseline — tuned for speed/memory, bad for small print). Now the default
  is **150** and it reads `OCR_PDF_DPI`, clamped to **[72, 300]** (below loses detail; above
  mostly bloats memory/time — and a 3.5 GB-VRAM-class box can OOM on huge pages, so the ceiling
  is a guard, consistent with the safety-first stance). `OCRLoader.parseDpi()` does the clamp;
  threaded into `PDFSharp` via a `dpi` constructor option.
- **Image preprocessing before `recognize`** — `OCRLoader.preprocessImage()`: `grayscale()` +
  `normalize()` (contrast stretch — recovers faded/low-contrast scans; Tesseract binarizes
  internally so we deliberately stop short of a hard threshold that wrecks uneven lighting), plus
  a **2× upscale for small images** (longest side < 1500px) so glyphs are big enough to read.
  Best-effort: any `sharp` failure returns the original input so OCR still runs. Wired into the
  standalone-image path (`ocrImage`); the scanned-PDF path gets the same grayscale+normalize
  inside `PDFSharp.pageToBuffer`.
- **Env knob documented** — `OCR_PDF_DPI` added to `collector/.env` (commented default) and
  `tooling/start-stack.sh` (`=150`). Lower it on low-RAM machines, raise it for tiny print.

**Verified (2026-06-13, Node 18):** module loads; DPI clamp correct (`70→72`, `150→150`,
`999→300`, unset→`150`); `preprocessImage` runs incl. the small-image upscale branch and is
**non-destructive** — a synthetic faded+blurred "Invoice 4471…" scan OCR'd **47/47 chars
identically** raw vs. preprocessed at both large and small sizes (no regression). **Honest
limit:** could **not** demonstrate a quantitative accuracy *gain* here — modern Tesseract LSTM
reads crisp *synthetic* text even when degraded, and real OCR failures (scanner noise, skew,
paper texture, JPEG artifacts) can't be convincingly synthesized. grayscale+normalize+DPI are
standard, well-founded prep; the payoff needs **real scanned documents** to quantify — same
"needs real-world test data" gap already open elsewhere in the project. No degraded-scan asset
exists in `tooling/test-docs/` (the PNGs are text-less shape graphics; `test-curriculum.pdf`
rasterizes but OCRs to nothing).

**Confidence noise-gate (added 2026-06-14) — the real fix for OCR artefacts on photos.**
A text-less portrait photo was producing ~1,200 words of Tesseract glyph garbage
("PEER EEE HEE EE Spey 11 ¢…") that got embedded and polluted retrieval. The earlier
`looksLikeText` char-heuristic in `asImage.js` let it through (fake uppercase runs satisfy
its "3+ four-letter words" + high letter-ratio test). Replaced it with Tesseract's own
**mean per-word confidence**, which separates the two cleanly (measured: text-less photos
score **~28-40**, genuine text **~85-95 even when blurred**):
- `OCRLoader.ocrImage()` now uses the default `recognize()` output (so `data.confidence`
  is populated — dropped the `"text"`-only restriction) and **returns
  `{text, confidence, reliable}`** instead of a bare string (its only caller is `asImage`).
- New env knob **`OCR_MIN_CONFIDENCE`** (default **50**, clamped [0,100], `0` disables;
  `parseConfidence()`). Added to `collector/.env`, `start-stack.sh`, and the packaged
  `main.js` `packagedEngineEnv`.
- `asImage` drops unreliable OCR **only when a caption exists**; with no caption it keeps
  low-confidence OCR rather than drop the file (never-drop guarantee). `looksLikeText` removed.
- **Verified live (2026-06-14):** re-ingested the offending photo → `pageContent` went
  **1264 → 41 words** (caption only); collector logs `-- Working unnamed.jpg -- (caption:
  yes, ocr: dropped-as-noise@28)`.

**Deferred (post-build-1):** surface OCR **language** as a UI setting. **Build 1 is
English-only (decided 2026-06-13)**, so this is parked, not unfinished. When wanted it's
**UI-only** plumbing in `amadocs-ui/index.html` (a language multi-select) — the engine already
honors it end-to-end (`TARGET_OCR_LANG` → server `#attachOptions` `ocr.langList` → `OCRLoader`);
no engine change. The default is already `eng`, so English-only needs zero work. Bigger
DPI/preprocessing wins are done — **feature #2 is complete for build 1.**

## 🎯 Post-build-1 priority (decided 2026-06-14): OCR + text analysis quality

Once build 1 ships, the **main focus is improving OCR and text analysis** — it's the core of the
product's value (reading real-world, messy documents well), and it's where the headroom is.

**State of the art (the plateau is narrow):** per-character accuracy on *clean printed Latin
text* is near-maxed — Tesseract (what we use via `tesseract.js`, LSTM) is at the ceiling there
and won't improve much by tuning. **Everything else is wide open:** layout/tables, handwriting,
degraded/photographed docs, reading order, math/formulas, charts, non-Latin scripts.

**Feasible improvement axes, ranked by effort-vs-payoff for our users (non-technical, dumping
real-world docs/photos), licensing-aware (keep the MIT/Apache-only stance):**
1. **More preprocessing — lowest-risk, biggest real-world win, stays light.** We already do
   DPI/grayscale/normalize/upscale + a confidence noise-gate (see OCR-quality section). Still on
   the table, all classic OpenCV-grade + permissive: **deskew, dewarp (curved book pages),
   perspective-crop / document-detection, adaptive binarization (Sauvola), denoising,
   super-resolution.** These move the needle most on the "snap a receipt/letter" case.
2. **Route hard docs to a deep-learning OCR engine via ONNX** — we already run onnxruntime.
   **PaddleOCR** (Apache-2.0; `PP-Structure` for tables/layout) exported to ONNX (RapidOCR/
   OnnxOCR), or **docTR**/**EasyOCR** (Apache-2.0). Better layout + multilingual without a VLM.
   (Watch **Surya**'s license — more restrictive/revenue-gated than Apache; vet before use.)
3. **VLM-as-deep-OCR for the worst cases (handwriting, tables→markdown, formulas→LaTeX)** — we
   already bundle a VLM path (moondream for captions); a doc-OCR-tuned small VLM (e.g. GOT-OCR2.0,
   Qwen2.5-VL-class, Apache where applicable) could be an **opt-in "deep read."** Collides with
   the 8 GB / zero-config / GPU-app constraints, so it's a power-user/GPU option, NOT the default.
4. **Structured extraction (tables/forms)** — high value for the records-search use case
   (invoices), and the part classic OCR doesn't do.

**The standing tension:** accuracy vs. footprint/simplicity. Tesseract's whole appeal is tiny +
CPU-fine + Apache-2.0 + no GPU; heavier engines/VLMs trade that away. Default stays light;
anything heavy is opt-in / config escape-hatch (consistent with [[k-base-modes-direction]]).
Tie-in: "text analysis" here also means the **retrieval/embedding** side ([[k-base-retrieval-tuning]]:
hybrid/keyword search still absent, stronger embedder is a config swap) — better OCR feeds better
text feeds better search.

## ✅ BUILT (2026-06-13) — Export photo with metadata

Lets the user take a photo back **out** of AMAdocs with everything the app understands about
it attached, so the AI's understanding travels *with* the file into other tools. **Sidecar
form** (decided with user): export a ZIP of the **original file (untouched)** + a readable
**JSON sidecar** — chosen over embedding into EXIF/XMP because it's format-agnostic
(PNG/JPG/HEIC/…) and robust. Build 1 scope addition (before packaging).

**Sidecar contents** (user-selected): `aiDescription` (moondream caption), `extractedText`
(OCR), original camera **EXIF**, and `source` provenance (filename, collection, ingest date,
docId, wordCount) + basic `image` facts (dimensions/format/space/density from sharp).

**What was built:**
- **Server** `GET /workspace/:slug/doc-export?path=` (`endpoints/workspaces.js`, next to
  `doc-original`): resolves the doc via `fileData()` (path-traversal safe), finds the retained
  original by uuid-prefix, splits `aiDescription`/`extractedText` back out of the combined
  `pageContent` (the `"Image description:"` / `"Text found in image:"` labels `asImage` writes;
  non-image docs carry their text as-is), reads EXIF (`exifr`, best-effort) + image facts
  (`sharp`, best-effort), and streams an **`archiver` zip** (original under its real name +
  `<base>.amadocs.json`) as an attachment. Originals are never modified — it's a copy.
- **One new dep:** `exifr@7` (pure-JS, **no native build** → dodges the Node-18 native-module
  fragility) — installed with `--legacy-peer-deps` (the tree's standard workaround). `archiver`
  was already present. (Added AMAdocs runtime deps: `exifr` here + later `piexifjs@1.0.6` for the
  embed-summary feature — both pure-JS, no native build. That's the full added-dep list.)
- **UI** (`amadocs-ui/index.html` → synced to `amadocs-desktop/ui/`): a `⬇️ Export with info`
  button in the viewer header, shown **only for images** (`curDoc.isImage`). Click builds an
  anchor to the endpoint; `Content-Disposition: attachment` makes a plain navigation download
  the zip — works in both the browser dev stack and Electron, no folder-picker needed.

**Verified live (2026-06-13):** real phone photo `IMG_5127.jpg` (`amadocs-test` ws). Restarted
the server with the new route; `GET …/doc-export` → **HTTP 200 `application/zip`**, bundle =
`IMG_5127.jpg` (309 KB original) + `IMG_5127.amadocs.json` (1.3 KB). Sidecar carried the correct
moondream caption, the OCR text, sharp image facts, and **real parsed EXIF** (`Software: Google`,
`DateTimeOriginal: 2025-11-22`) — confirming `exifr` reads genuine camera metadata. Standalone
zip/unzip round-trip also checked. **Not exercised:** the literal in-browser button click (same
"needs a human eyeball" class as the citation render) — the data path is fully proven via HTTP.

## v2 feature wave (decided 2026-06-13)

Three features, built in this order; packaging stays parked (these slot into the existing
pipeline and don't force a release first). Two packaging deltas to remember when packaging
un-parks: the **vision model** now belongs in the bundle/first-run catalog, and **AI Finder**
will need the **Electron folder picker** (a packaged-app capability).

1. ✅ **Image analyser (vision captioning)** — BUILT 2026-06-13 (see section above).
2. ✅ **OCR quality** — engine-side levers BUILT 2026-06-13 (see "OCR quality" section
   below). The UI **language** picker is **deferred** — build 1 is **English-only** (decided
   2026-06-13), so it's a post-build-1 nicety, not unfinished scope. "Never drop a file" is
   already covered by #1's caption fallback for images.
3. 🅿️ **AI Finder — one-shot folder index** — **PARKED / off the AMAdocs roadmap (2026-06-14,
   user's call: "too many pitfalls").** Not deferred-behind-build-1 anymore — dropped from this
   project. The lock-up/OOM risk, the idle-aware + durable-queue machinery, and the entanglement
   with heavy on-device inference (even on a GPU) make it a different problem shape than AMAdocs' focused
   drop-and-ask tool; if revisited it should be its own product. The settled design below is kept
   as the starting point for whenever/wherever it resumes.

## AI Finder (#3) — settled design (2026-06-13; PARKED 2026-06-14, not built)

**Guiding principle: cautious and responsible — NEVER risk locking up the user's machine,
even at the cost of speed.** For non-technical users a frozen laptop reads as "this app broke
my computer"; that reputation would kill a zero-config product. So folder indexing
*deliberately underperforms* to stay safe. Anything aggressive is a **config-only escape
hatch** for power users (consistent with the config-as-intent stance, [[k-base-modes-direction]]),
never a UI default.

**Seams that exist:** Electron folder picker `dialog.showOpenDialog({properties:["openDirectory"]})`
(+ preload bridge; Electron-only, won't run in the browser dev stack); per-file ingest via the
proven upload-and-embed path (parse→OCR→vision-caption→originals-retain→embed); SSE progress
template = the `pull-model` endpoint (`workspaces.js:1320`); Electron `powerMonitor.getSystemIdleTime()`
for idle detection.

**Correction to an earlier note:** in-place ingest is NOT `collectorApi.processDocument` +
absolutePath — `processDocument` (`collectorApi/index.js:111`) hits `/process` off the hotdir and
takes no absolutePath. The absolutePath seam is `parseDocument` (`:331`, hits `/parse`), which
*parses without processing* and **bypasses the originals-retention path the citation→viewer loop
depends on**. So v1 leans **copy-into-Library** (reuse the normal drop path per file): consistent
with the existing "AMAdocs keeps its own private copy" model, keeps citations/vision working;
cost is disk duplication. In-place is a later optimization if big folders make duplication hurt.

**Safe-by-default execution (the whole point):**
- **Strictly serial** — one file in flight, ever. Never parallelize.
- **Durable per-file checkpoint queue** — process one file → embed → commit `done` → next.
  Crash/force-quit mid-file just re-runs that one file on resume (idempotent: content-digest
  vector-cache skips the rest instantly). Survives app close (background indexing spans sessions).
  Needs a small job table (folder, filepath, status pending/done/failed, timestamps).
- **Idle-aware (the honest "background")** — throttling alone does NOT fix lock-up: each vision/OCR
  call is an indivisible GPU/CPU burst, so spacing files just spreads the spikes. The real fix is
  to process only when the user is away (idle > ~30–60s via `powerMonitor`) and auto-pause the
  instant input resumes — how Spotlight/Windows Search get away with it. Plus a cool-down between
  files so nothing stays pinned.
- **Memory/VRAM guard** — the real crash vector (3.5GB GPU + vision + chat model can OOM; huge PDF
  spikes RAM). Per-file size cap (skip + report oversized), don't start next file on low headroom.
- **Per-file watchdog** — a hung caption/OCR past a timeout → skip + report, don't wedge the run.
- **Never blocks the app** — user can keep searching already-indexed docs while the rest trickles in.
- **Pause semantics** = finish current file, then stop (don't abort mid-Ollama-call → no partial
  state). Progress + pause/resume live as an **in-chat status bubble** (`addSystemMsg`, see
  [[k-base-status-feedback]]), not floating chrome.
- **Up-front expectation** — scan first, show a by-type tally + plain warning ("92 files incl. 40
  images; images are AI-described, the slow part; this may take a while — pause anytime"). During:
  a **running ETA** that refines from observed per-file timing (honest, vs a static guess).

**v1 scope:** one safe mode in the UI (no "Fast" footgun); idle-aware + durable queue + pause +
guards. Aggressive/full-speed = config escape hatch only. Whole-drive and live file-watcher stay
out. Even on a GPU, a big image folder is the worst case this design protects against
(sustained vision inference pinning the machine).

> **PARKED 2026-06-14 — off the AMAdocs roadmap.** The above is a preserved design, not active
> scope. See the "v2 feature wave" note for the parking rationale ("too many pitfalls"; likely a
> separate project).

## Next steps

1. Package: `electron-builder` → **AppImage BUILT & verified end-to-end (2026-06-14)** —
   boots offline, ingest + vision + chat all work. Full status + the two non-obvious fixes
   in **`PACKAGING.md`**: (a) ⚠️ Ollama needs its whole `lib/ollama/` runtime
   (`llama-server` + GPU/CPU libs, ~2.1 GB) bundled, not just the binary, or all inference
   404s; (b) the collector's `hotdir`/`tmp` must be relocated to writable `userData` (it
   runs from the read-only mount). Proactive first-run model download ✅ **BUILT (2026-06-14)**
   — a "Welcome to AMAdocs" setup overlay pulls the AI (+ opt-in vision) over the `pull-model`
   SSE before first use (shared `streamModelPull()` helper; see `PACKAGING.md`). Node-18 EOL
   exit ✅ **DONE (migrated to Node 22, AppImage rebuilt + verified end-to-end, 2026-06-14)**.
   Still open: icon, Windows/macOS builds. (API session token ✅ BUILT
   2026-06-14 — per-boot token gate on every `/api` request; see `PACKAGING.md`.
   Collector :8888 auth is the remaining open piece, internal-only/lower-risk.)
2. UI polish: collections switcher, About/Licenses screen. *(Concise answers: DONE — settled
   as a hard ~120-word cap, not a toggle; see "Custom changes" → answer-length cap.)*
   - ⬜ **Chat avatars: show text labels "AI" / "ME", not icons.** Today `addMessage`
     renders `🙂` (user) and `A` (assistant) in the `.av` circle (`amadocs-ui/index.html`,
     `addMessage`). Swap to the literal text "ME" / "AI". Minor: tighten `.av` font-size so
     two characters fit the 30px circle. *(requested 2026-06-13, not started)*
   - **Image viewer: metadata under the image + mouse zoom.** *(requested 2026-06-13.)*
     - ✅ **Caption + OCR panel under the image — BUILT 2026-06-13.** `renderImage()` now calls
       `loadImageMeta()` (`amadocs-ui/index.html` → synced to desktop): fetches `doc-view`, splits
       the combined `pageContent` on the `Image description:` / `Text found in image:` markers via
       `sliceSection()`, and renders a `.vmeta` panel (`🖼️ AI description` + `🔤 Text found in
       image`) beneath the `<img>`. Best-effort (fetch/parse failure leaves the image as-is) and
       race-guarded (ignores a late fetch if the user switched docs). Parsing unit-tested (both /
       caption-only / ocr-only / non-image → empty). **Not yet eyeballed live in the UI.**
     - ⬜ **EXIF/source facts (stretch).** NOT in `doc-view` — computed only inside the
       `doc-export` zip route (`exifr` + `sharp`). Add a light JSON variant (e.g.
       `doc-export?format=json` returning just the sidecar object, reusing the same extraction)
       and append a third `.vmeta` section. *(deferred to next session)*
     - ⬜ **Mouse zoom/pan on `.vimg`.** Pure UI: wheel → CSS `transform: scale()` with
       `transform-origin` at the cursor, drag-to-pan when zoomed, double-click/Esc to reset.
       Scope to the image viewer only (don't touch the PDF canvas path). No engine change.
       *(deferred to next session)*
3. ✅ **Generate `LICENSE` (MIT) + `THIRD_PARTY_LICENSES` — DONE (2026-06-14).** Both at repo
   root + bundled via electron-builder `extraResources`; regen with
   `node tooling/gen-third-party-licenses.js`. Audited clean (all permissive, no copyleft). See
   `PACKAGING.md`.
4. GitHub repo + releases + download page. *(parked)*
5. Cross-platform builds (Windows/macOS) — need those OSes or CI runners.
