---
name: tinysparql-integration
description: "⭐PROVEN E2E (2026-06-16) — AMAdocs rides on GNOME's TinySPARQL/LocalSearch: bridge → embed → grounded semantic answers + [tinysparql] sources; INCREMENTAL delta-sync (new/changed/deleted) BUILT+verified; LanceDB schema bug fixed; ⚠️inotify dormant on non-GNOME → must restart indexer to reconcile. ✅EYEBALLED+FIXED 2026-06-17: bridged-doc PDF citation RENDERS live; highlight mis-targeted boilerplate past page 5 (targetPage=null → search capped to pages 1–5) → FIXED via locatePassagePage scan-all-pages + cluster-hardened findPassageRegion (re-verified: 10 spans of real passage). Only p.N label still missing (poppler follow-up). ✅UI/Electron folder-sync flow BUILT + EYEBALLED LIVE 2026-06-17 (sidebar 'Sync a folder' → native picker → pick existing/new collection → dryRun banner w/ real counts → embed-progress SSE counter + Continue + inline STOP; mid-sync STOP halts batch & keeps only confirmed docs = THE #1 RULE proven thru UI; dormant→reconcile checkbox); NEXT = cadence scheduler (resume on relaunch)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4c0077e-b599-4d27-81ee-315c46cfe769
---

**The new bet (decided 2026-06-16):** AMAdocs' real value = an LLM/semantic layer that
*exploits what GNOME already silently does* (full-text + metadata extraction via
LocalSearch/TinySPARQL), then adds embeddings + the grounded LLM-answer/citation loop on top.
Phase = whole-folder **semantic search FROM AMAdocs**, starting on the test corpus
**`/mnt/space/teaching_docs`** (1.1G, 805 extractable docs: 424 pdf, 101 docx, 57 xlsx, 191 md).

**Architecture chosen = "Ride on TinySPARQL (hybrid)":** read `nie:plainTextContent` from the
GNOME index for the digital-text majority (no re-parsing); only run AMAdocs' own
parser/OCR/vision for the **blind spots**. Couples to GNOME/Linux (fine — Arch-first pivot,
[[k-base-platform-focus]]).

**Machine reality (this Arch+ML4W/Hyprland box):** `tinysparql` + `localsearch` 3.11.1 installed
but **DORMANT** — never ran, no index existed. Cause: the user unit
`localsearch-3.service` has `ConditionEnvironment=XDG_SESSION_CLASS=user`, unset in the systemd
--user manager (no gnome-session), so it never auto-starts. **Woke it manually:**
`systemctl --user set-environment XDG_SESSION_CLASS=user` then `systemctl --user start
localsearch-3.service`. ⚠️ KEY THESIS CAVEAT: outside a real GNOME session the OS index is doing
**nothing** — AMAdocs must *enable & own* LocalSearch, not just read a populated index.

**Eval results on teaching_docs (woke daemon, scoped index to just that folder via
`gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories
"['/mnt/space/teaching_docs']"` — OLD value was `['$HOME']`, saved in
`/tmp/localsearch-old-recursive.txt`, restore when done):**
- Crawled 1.1G in **seconds** (idle-aware, no strain). **648 docs got extracted full text
  (~19.8M chars)**: 424 PDF + 191 md + 17 txt + 16 html. PDF extraction is excellent (whole
  novels ~1M chars each; forms; resource packs). Rich metadata too (pageCount/wordCount/dates/
  generator/author). FTS5 keyword search instant.
- **3 blind spots = where AMAdocs earns its place:** (1) ⚠️ **Office docs silently dropped** —
  **WPS Office** installed user mime defs in `~/.local/share/mime/` (`application/wps-office.docx`
  etc.) that win content-sniffing; LocalSearch's OOXML extractor rule only matches the *standard*
  mime → **all 164 docx/xlsx/pptx (20% of corpus) skipped with NO error**. (The extractor MODULE
  works — `localsearch extract <file>` on a docx yields perfect text+metadata; only the daemon's
  content-type routing fails.) (2) **No OCR/vision** — scanned PDFs (~3%) + 26 jpegs come back
  empty (AMAdocs' existing OCR+moondream fills this). (3) **Lexical only** — FTS is keyword-OR,
  no concept→wording bridge (the embedding layer is AMAdocs' job).

**Division of labor (now evidence-based):** GNOME owns crawl/monitor/extract digital text+meta
(the "don't melt the laptop" problem, [[k-base-folder-index]], already solved by the OS).
AMAdocs owns embeddings + semantic retrieval + LLM-answer/citation loop + backstop extraction for
the 3 blind spots.

**How to query the index:** `tinysparql query --dbus-service=org.freedesktop.LocalSearch3 -q '…'`.
GOTCHA: `nie:url` is on the file (DataObject) node, `nie:plainTextContent`+`nie:mimeType` on the
linked content (InformationElement) node — join via `?ie nie:isStoredAs ?do . ?do nie:url ?u`.

**BUILT the bridge: `tooling/tinysparql-bridge.js`** — queries the live LocalSearch daemon over
D-Bus (file-based `-f` queries; CONCAT w/ U+001F delim + newline sentinel; CLI has no JSON output,
and a standalone HTTP endpoint over the on-disk meta.db sees an empty view bc the daemon holds the
WAL → must use D-Bus), pulls `nie:plainTextContent`+meta for files under a folder, writes
AnythingLLM-shaped doc JSONs to `server/storage/documents/tinysparql-teaching/` + manifest
`tooling/tinysparql-adds.json` → feed `POST /workspace/:slug/update-embeddings {adds}` (native ONNX
embed, NO Ollama needed). Verified writes correct JSON w/ real full text. ⚠️ TinySPARQL text is
FLAT (no per-page ranges) → bridged docs lose the citation page-NUMBER label; passage HIGHLIGHT
still works (text-match in rendered PDF).

**Staying fresh = INCREMENTAL (verified), never re-embed all:** GNOME keeps its store live via
inotify (`enable-monitors true`); per-file `nfo:fileLastModified` (on all 2,995 files) → delta
query `FILTER(?m > "<last-sync>"^^xsd:dateTime)` (tested). Optional push = `TrackerNotifier` D-Bus
events. AMAdocs re-embeds only changed files (the doc-deep-search re-embed-in-place path) + deletes.
Cadence: delta-sync on launch + light tick + occasional path-set reconcile, all via the safe serial
queue. Caveat: GNOME store only live while `localsearch` runs → AMAdocs must start it & let it catch
up before reading the delta.

**Clarified for user (2026-06-16):** semantic search needs AMAdocs' OWN vector embeddings (GNOME
only does lexical FTS, no embeddings); what we reuse from GNOME is the TEXT EXTRACTION (the
expensive parse), not its index. We build a complementary vector index, not a duplicate of GNOME's.

**✅ PROVEN E2E (2026-06-16).** Booted the dev stack (Node 22), `teaching` workspace (query mode +
reranker), bridged a **100-doc real-teaching slice**, embedded all 100 via `update-embeddings`, ran
real semantic queries → grounded phi3.5 answers **with source attribution tagged `[tinysparql]`**
(IGCSE FLE syllabus, score 0.998; a concept→wording query bridged to the syllabus' R1/R2/R4
objectives + specimen mark scheme — the lift FTS can't do; a schedule query even pulled a tiny
`*.md` note). The whole "ride on GNOME" thesis works on OS-extracted text.

**⚠️ BUG FOUND + FIXED — a custom doc-JSON producer MUST emit an identical field set across ALL
docs.** LanceDB fixes the collection's Arrow schema from the **first** embedded doc. The bridge
emitted `pageCount: undefined` for non-paged docs (markdown) → `JSON.stringify` drops the key → those
single-chunk batches `.add()` a row missing a column the first PDF defined → LanceDB-node builds a
malformed 0-byte Utf8 buffer and throws `LanceError(Arrow): Need at least 4 bytes in buffers[0] in
array of type Utf8, but got 0`. Symptom: only 14/100 embedded (the multi-chunk PDFs/HTML); every tiny
md note silently failed. **Fix:** emit `pageCount: 0` (always a number). Re-embed → 100/100. Also
added bridge knobs: `env EXCLUDE` (default `/novels/`, skips corpus-filler books) + `ORDER BY ?u`
(deterministic LIMIT). Reproduced/fixed directly against the live LanceDB table.

**✅ INCREMENTAL delta-sync BUILT + verified E2E (2026-06-16).** `tooling/tinysparql-sync.js` (shares
`tooling/lib/tinysparql-lib.js` with the now-thin bridge) keeps a workspace fresh **without
re-embedding the corpus**. State file `tinysparql-sync-state.<slug>.json` maps `sourceUrl→{docpath,
mtime}`; first run bootstraps (adopts the embedded set, baselines the rest, no embed). Diff →
one `update-embeddings {adds,deletes}`: NEW→embed, CHANGED (mtime advanced)→delete-old+add-fresh
(new docpath ⇒ fresh vector-cache key, no skipCache needed), DELETED→drop. Full NEW→CHANGED→DELETED
cycle proven live on a throwaway file with planted facts (retrieval tracked each state; dry-run showed
**exactly 1 changed, not 630** — truly incremental). Knobs: `SYNC_NEW=0`, `DRY_RUN=1`.

**⚠️ KEY non-GNOME finding (matters for the product):** despite `enable-monitors=true`, **inotify
live-updates did NOT fire on this Arch/Hyprland box** — a new/changed/deleted file stayed invisible to
the daemon until `systemctl --user restart localsearch-3.service` forced a reconcile crawl (which
**preserves real file mtimes**, so only genuinely-changed files re-embed). So on non-GNOME desktops the
freshness flow must actively **poke/restart the indexer (or run our own watcher)** before reading the
delta — can't rely on GNOME's monitors outside a real GNOME session. Also: `nfo:fileLastModified` is
stored with 2 identical values/file → `queryFileList` uses `GROUP BY ?u` + `MAX(?m)`.

**Bridged-doc viewer/citation FIXED (2026-06-16):** bridged docs have no retained original (never went
through the collector), so `doc-original` 404'd → viewer + citation PDF-jump were broken. Fixed in
`endpoints/workspaces.js`: `doc-original` now falls back to streaming the real file via `data.sourcePath`
when `amadocsSource==="tinysparql"` (gated on `statSync().isFile()`). doc-view returns full text with
`pages:null` (graceful). So bridged docs are first-class for the citation loop except the page-NUMBER
chip label (flat text).

**✅ PRODUCTIONIZED into the engine (2026-06-16):** `POST /workspace/:slug/gnome-sync` +
`server/utils/GnomeBridge/index.js` move bridge+sync off the CLI into the server. Body
`{folder, exclude?, limit?, dryRun?}`: first call full-indexes the folder (embeds up to `limit`, rest
dormant baseline), later calls delta-sync (same `computeDelta`); embeds via the engine's own
`embedFiles`/`Document.addDocuments`, deletes via `Document.removeDocuments`; `available()` → 503 if
LocalSearch down. Docs in `storage/documents/gnome-<slug>/`, state in `storage/gnome-sync/<slug>.json`.
Verified: dryRun read-only, `limit:30` → 30 distinct real docs + grounded query, follow-up sync
idempotent. ⚠️ **Build gotcha:** the U+001F separator char was lost on file-write → `US=""` →
`split("")` exploded rows into single chars → declare separators as `\uXXXX` escapes in source, never
literal control chars.

**✅ SAFETY WIRING BUILT (2026-06-16):** `gnome-sync` is now wired into the safe ingest queue
([[k-base-ingest-safety]]) — cool-down, hard STOP, durable finalize-on-confirm (responds **202 + plan**,
no longer over-claims `added`), bounded batches, and `ensureIndexer` behind a `reconcile` body flag.
So the endpoint body is now `{folder, exclude?, limit?, dryRun?, reconcile?}`. See that memory for detail.

**⚠️ EYEBALLED LIVE 2026-06-17 — render works, but found a real bridged-doc HIGHLIGHT BUG.** Drove the
running Electron app (CDP harness `tooling/eyeball-cite.js` — raw DevTools, no puppeteer;
`Page.captureScreenshot`; shots in `tooling/logs/cite-*.png`) against the `teaching` slice. ✅ Chip
resolves (no `p.N` label — graceful, as designed); clicking opens the **real PDF** via the
`doc-original`→`sourcePath` fallback; PDF.js renders **pixel-accurately**, scrolls, paints a highlight.
❌ BUT the highlight **latched onto recurring page boilerplate (a footer line), not the cited passage,**
whenever the passage was past page 5. ROOT CAUSE (`amadocs-ui/index.html` `renderPdf` ~L864–875): bridged
docs have `targetPage=null` (no page ranges), so the highlight search window defaulted to **pages 1–5
only** (`startP=1,endP=startP+4`); a deep passage (~p.15) was never searched, and the only needle fragment
matching in 1–5 was the every-page footer → silent MIS-highlight (worse than no highlight). Dropped-in docs
unaffected (their `pages` ranges anchor `targetPage`).

**✅ FIXED SAME DAY (2026-06-17) — chose scan-all + cluster-harden (fix opts 1+3); poppler page-ranges
(opt 2) left as the `p.N`-label follow-up.** UI-only, both copies synced. New **`locatePassagePage(pdf,
needle)`** does a cheap **text-only scan over ALL pages** (`getTextContent`, no canvas raster) and picks the
page with the **largest contiguous fragment-match cluster** (require `>=3`, so a lone footer scoring ~1–2
can't win); `renderPdf` calls it only when `targetPage` is null (anchored dropped-docs unchanged).
**`findPassageRegion`** rewritten to return `{lo,hi,score,count}` and highlight the **largest contiguous
cluster** (not the union of all hits) so a far-away footer can't balloon the region. RE-VERIFIED LIVE: the
syllabus citation now highlights **10 spans of the real R1–R5/W1–W4 passage** on the correct deep page (was
1 footer span). Harness `tooling/eyeball-cite.js`; shot `tooling/logs/cite-3-viewer.png`. Bridged-doc
citation loop now trustworthy; only the `p.N` chip label is still missing (needs poppler). Detail in
`AMAdocs-DEV-NOTES.md` → "⚠️ FINDING (2026-06-17)" → "✅ FIXED".

**✅ UI/Electron folder-sync flow BUILT + EYEBALLED LIVE (2026-06-17).** Wires the whole backend into the
app (it was CLI/CDP-only before). Sidebar **"📂 Sync a folder"** button (desktop-only, gated on
`window.amadocs.pickFolder`) → native picker (`main.js` `ipcMain.handle("pick-folder")` →
`dialog.showOpenDialog`, exposed in `preload.js`) → modal that picks an existing OR new collection
(`WS_SLUG`/`WS_NAME` made mutable + new `setActiveWorkspace()` so a just-synced folder is visible) →
**`dryRun:true` banner** with honest counts ("N now, M more, K removed; stop anytime") → real
`gnome-sync` → progress via the **`embed-progress` SSE** (opened before the POST; `doc_complete` drives an
"Indexed X of Y" counter — worker `docIndex` is 0-based, display `+1`) in an `addSystemMsg` bubble with an
inline **STOP** button (`POST /system/stop-all`) + a **Continue** action when `remaining>0`. `openSyncModal`
split into picker + **`showSyncModalFor(folder)`** so the flow is CDP-testable without the native dialog
(`window.amadocs` is a frozen contextBridge obj — can't monkeypatch `pickFolder`). Dormant-indexer
(non-GNOME) UX: dryRun→503 auto-ticks a "Re-scan the disk first" checkbox that sets `reconcile:true` on the
real run (deliberate, explicit re-index per [[k-base-ingest-safety]]). No engine changes.

**✅ EYEBALLED LIVE (2026-06-17)** — running Electron app vs. the real 648-doc OS index under
`/mnt/space/teaching_docs` (harnesses `tooling/eyeball-sync.js` + `eyeball-stop.js`, raw DevTools; shots in
`tooling/logs/sync-*.png` + `stop-final.png`): dryRun banner showed real counts (200 now / 429 more); sync
embedded 200 into a new collection with the progress counter advancing; the app **switched to the new
collection (200 docs visible in sidebar)**; with cooldown+small-cap the **STOP button rendered live mid-sync
("Indexed 3 of 40…") and clicking it halted the batch → err-toned "Sync stopped…" with exactly 3 docs kept**
(THE #1 RULE durable/no-over-claim proven through the UI). Gotcha (harness, not product): CDP
`Page.captureScreenshot` is flaky DURING active embedding (renderer busy) → shoot after settle / retry. Test
workspaces cleaned up. Detail in `AMAdocs-DEV-NOTES.md` → "✅ BUILT + EYEBALLED LIVE (2026-06-17)".

**NEXT:** (1) the launch/periodic **cadence scheduler** (resume pending files on relaunch — still open; the
finalize-on-confirm durability already supports it). (2) optional: poppler page-ranges for bridged docs →
restores the `p.N` citation label (the last flat-text gap). Connects to parked [[k-base-folder-index]] (AI
Finder) — GNOME solves the crawl/watch problem that parked it.
