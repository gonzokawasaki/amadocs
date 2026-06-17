# AMAdocs — Developer Notes

Technical companion to `K-base.md`. Status as of 2026-06-12.

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

### ⚠️ BUG — OPEN (2026-06-17) — drag-drop uploads FAIL in a workspace that has bridged (gnome-sync) docs: incompatible LanceDB Arrow schemas

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

**Durable fix (NOT yet done — design call):** make the two producers emit an **identical** column set so
bridged + dropped docs can coexist in one workspace. Cleanest option = the normal collector/embed path
always writes `amadocsSource/sourceMime/sourcePath` as `""` and `pageCount` as `0` (mirroring the
bridge's "always a number, never undefined" rule), OR have `GnomeBridge` stop emitting the extra columns
and stash that metadata elsewhere. Until then: don't mix bridged and drag-drop docs in the same
collection. See [[tinysparql-integration]].

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
