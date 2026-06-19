---
name: k-base-ingest-safety
description: "The 'won't trash your machine' model (decided 2026-06-15) — bounded-by-default + serial durable queue + cool-downs + upfront banner + hard global STOP. The #1 rule."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3669b097-88d3-4bff-a732-68e9e19dd0e1
---

**Decided 2026-06-15 (design, NOT built yet). The #1 product rule: DON'T KILL THEIR MACHINE — locking up a user's machine (esp. small hardware) is unethical/irresponsible.** This is the safety model that makes "drop large numbers of files" responsible, and the reason the AI-librarian reframe ([[k-base-alpha-simplification]]) works.

**Why it's needed:** with summary-as-default, every dropped file triggers an LLM burst (OCR + caption + ~120-word summary). Each call is bounded, but *volume* (e.g. 200 files) is sustained inference that can pin the GPU for hours = "this app killed my computer." Bounding per-file is necessary but not sufficient; the path itself must be gentle.

**The model:**
1. **Bounded by default** — per file: ~120-word summary on the first **8000 chars** (or first ~5 pages) for docs; one caption per image. NO unbounded full-document embedding unless explicitly requested (full-doc semantic search = per-file opt-in, e.g. right-click "Deep search"). The 8000-char cap is the real win — it kills the huge-PDF RAM spike, the worst lock-up vector. (Mechanism already exists: [[k-base-doc-summary]] DocSummary leading-slice; flip default-on.)
2. **Strict serial queue** — one file in flight, EVER. Never parallel.
3. **Deliberate cool-down between items** — GPU breathes between files; never pinned flat-out.
4. **DURABLE queue — resumes at relaunch.** Drop 200, quit at 50, resume at 51 next launch. (User chose durable over in-memory.) Per-file checkpoint; idempotent re-run (content-digest vector-cache skips done work, see [[k-base-retrieval-tuning]]).
5. **Honest upfront banner** on a big drop: e.g. "92 files queued. Large batches can keep your machine busy for hours. You can stop anytime." Prominent, not a buried tooltip.
6. **Hard global STOP button** — suspends ALL AI activity instantly (aborts in-flight inference too, releases the GPU), for when the machine is struggling. **Hard, not graceful** — a "finish current file" pause is useless if the machine is already dying on that file. Safe to be aggressive: aborting mid-file just re-runs that one file on resume (idempotent). A softer "pause after this file" can come later; the panic valve hits now.

**Guards carried from the parked AI-Finder design** ([[k-base-folder-index]]): per-file watchdog (hung caption/OCR → skip+report, don't wedge), memory/VRAM headroom guard (don't start next file on low headroom). **Idle-awareness deliberately LEFT OUT** — this is foreground work the user initiated and is waiting on, not background folder-watching. Progress/pause/stop live as an in-chat status bubble ([[k-base-status-feedback]]), not floating chrome.

**Relationship to parked AI Finder:** this IS most of that safety design, but now in-scope and tractable — the parking rationale ("too many pitfalls") was about *unbounded* folder indexing; bounding the work to 8000 chars/file removes the worst pitfalls. **Framing angle:** for the technical-early-adopter audience, "responsible by design + a kill switch" is a TRUST feature worth saying out loud in the README, not a chore. AMAdocs is a GPU app ([[k-base-gpu-app-decision]]) so this matters even more.

---

## ✅ BUILT + LIVE-E2E VERIFIED (2026-06-16) — `gnome-sync` wired into this safety model. THE #1 RULE now proven on the running stack, not just logic-checked.

**✅ LIVE E2E PASSED (2026-06-16, dev stack on `/mnt/space/teaching_docs`, EMBED_COOLDOWN_MS=2000 for an observable window).** Both failure paths verified end-to-end:
- **Hard `kill -9` mid-batch (durable resume / no over-claim):** fired a `limit:25` index, killed the server at 4-confirmed. State listed **exactly 4** (docpath set); the 21 in-flight files were **absent entirely** (not falsely marked done); **no orphan embedding-worker survived** (killing the parent took the inference child). On restart the workspace had **exactly 4** embedded docs (state matched reality), and re-sync's dryRun showed `mode:sync, queued:21` → the un-confirmed files came back and finished to **25/25, all-distinct URLs+docpaths, zero double-embeds**. (Title-level "dupes" were genuinely distinct past-paper files sharing PDF-title metadata — URL is the identity key.)
- **`POST /system/stop-all` mid-batch (hard STOP):** returned `{stopped:["stop-test"]}`, the worker child died instantly, the **server stayed up + responsive** (ingest-only, no crash), state was truthful (4 confirmed == 4 embedded), and resume dryRun re-saw the 21 un-confirmed → STOP is durable too.

Net: no over-claim, no silent file loss, no double-embed, no runaway inference process, server survives STOP. The "live-stack human-eyeball" item is **closed**. NEXT is **item #3 = UI** (folder picker + banner + STOP button + launch/periodic cadence).

### Earlier this session — coded + unit/logic-verified (now superseded by the live E2E above)

**All 5 gaps closed.** Full write-up in `AMAdocs-DEV-NOTES.md` → "✅ BUILT … `gnome-sync` wired into the safe ingest queue (NEXT item #2)". Changes (all tagged `AMAdocs:`):
- **Cool-down** between docs in `jobs/embedding-worker.js` (between items, skips first/last); knob **`EMBED_COOLDOWN_MS`** in `EmbeddingWorkerManager.js` (default **750ms**, **0** in `.env.development`).
- **Hard STOP**: worker `{type:"stop"}` (clear queue + flag + emit `stopped` + exit); manager **`stopWorkspace(slug)`** + **`stopAll()`** (stop msg + `worker.kill("SIGTERM")`); exit handler tells deliberate-stop from crash. Endpoints **`POST /workspace/:slug/embedding-stop`** + **`POST /system/stop-all`** (ingest only; chat untouched).
- **Durable, no over-claim**: gnome-sync persists a pre-embed baseline with the about-to-embed files **absent**, finalizes per **confirmed** doc via new `embedFiles(...)` hooks `{onDocComplete,onComplete}`; crash → un-confirmed files retry next delta. Responds **202** with the *plan* (not `added`).
- **Bounded**: default cap **`GNOME_SYNC_CAP`=200** + `remaining` continue-contract; explicit `limit` keeps dormant-baseline semantics.
- **Non-GNOME dormancy**: `GnomeBridge.ensureIndexer({restart})` behind a `reconcile` flag (off by default — no silent service restart).

**Decisions taken** (the 3 flagged): 750ms/0-dev cool-down; cap 200 + remaining; build BOTH stop scopes (UI uses system-wide). **Remaining (live-stack human-eyeball):** E2E on `/mnt/space/teaching_docs` — kill server mid-batch → exact un-confirmed files retry; STOP mid-batch → child dies, state truthful. Then **NEXT item #3 = UI** (folder picker + banner + STOP button + launch/periodic cadence — all explicitly out of scope of this build).

Goal of the session: take the proven `POST /workspace/:slug/gnome-sync` endpoint ([[tinysparql-integration]]) and make it safe + honest. **Key discovery: most of the serial machinery ALREADY EXISTS — build ON it, don't rebuild.**

**What's already there (`server/jobs/embedding-worker.js` + `server/utils/EmbeddingWorkerManager.js`):** embedding runs in an **isolated child process** (OOM contained — kills worker not server), **serial** (one `addDocumentToNamespace` at a time), with **granular per-file SSE progress** (`doc_starting/doc_complete/doc_failed/all_complete`, per-slug `addSSEConnection`/`emitProgress`) and **per-file cancel** (`remove_file`). `embedFiles(slug,files,...)` is **fire-and-forget** (returns after dispatch). Child env propagates via Bree `spawnWorker` so `process.env` knobs reach it.

**The actual gaps (what to build):**
1. **No cool-down between files** (back-to-back bursts) and **no HARD global STOP** (only per-file cancel) — in the worker. Fixing here protects ALL ingest paths (drop, deep-search, gnome-sync), not just gnome. STOP must be **HARD** per the rule above → maps cleanly to **killing the embedding-worker child process** (`worker.kill`), which is idempotent-safe to resume.
2. **`gnome-sync` over-claims completion** (`endpoints/workspaces.js` ~L386–509): because `embedFiles` is fire-and-forget, the endpoint `saveState()` + returns `added: adds.length` **before embedding finishes** → a crash/STOP mid-run leaves state lying that those files are done → silent gaps. Needs honest non-blocking response + **durable finalize**: only mark a file "done" in GnomeBridge state once its embed is **confirmed** (worker writes the `workspace_documents` row per-file on success), so crashed/stopped files stay "new" and retry next sync.

**Planned build phases:** (1) worker: `INGEST_COOLDOWN_MS` inter-file sleep + hard STOP (kill child) + report embedded/failed/stopped lists; (2) manager: `stopWorker(slug)` + optional per-invocation completion callback; (3) gnome-sync: non-blocking honest status + durable finalize-on-confirm + a stop endpoint + a coverage/status endpoint; (4) UI: progress + STOP button.

**Product decisions locked this session:**
- **Prioritize universal safety over the non-GNOME-only freshness fix.** The inotify-dormant / indexer-restart-reconcile problem (see [[tinysparql-integration]]) is **non-GNOME-desktop-only** (a real GNOME session is warm + live) and bites *every delta-sync* there, NOT just first run. It is **deprioritized** to a later **explicit "Re-index" button (pull, never silent auto-restart)**.
- **"Inform the user" framing = progressive/limited coverage, NOT a hard "not ready" gate.** Partial semantic search is still real grounded search; show "indexing N/M — searchable now, improving" + "indexed as of <time>". Honest about coverage (consistent with the silent-blind-spot honesty stance), and it sidesteps the auto-restart complexity.
- These two asks **force the architecture**: gnome-sync must be **non-blocking + STOP + live progress** (you can't show progress or honor STOP inside a blocking multi-hour request) → reuse the existing per-slug embedding SSE.
