# Coracle — Recommendations (Fable review, 2026-06-12)

Project evaluation by Claude (Fable 5) of the build and the idea, as of Phase 0
(engine proven end-to-end, packaging parked). Companion to `K-base.md` and
`Coracle-DEV-NOTES.md`. Use this as a working checklist — tick items off or strike
them out as they're addressed or rejected.

---

## Overall verdict

A well-executed Phase 0. The strategy — fork AnythingLLM for the hard RAG parts,
wrap it in a purpose-built simple UI — is right, and the execution shows discipline:
the entire engine diff is ~215 lines across 4 files, every change tagged `Coracle:`,
the custom UI is one dependency-free HTML file with vendored libs. Maintainable by
one person, rebasable on upstream.

The idea is sound but lives or dies on one thing the current build hasn't fully
proven in-browser: **the citation loop**. (CPU-only performance is no longer chased
— Coracle is positioned as a GPU app; see Risk 1.)

---

## On the idea

The space is crowded (AnythingLLM Desktop, GPT4All, Jan, Msty, Khoj). "Zero
configuration" alone is a thin moat — AnythingLLM Desktop already ships a one-click
installer with a bundled LLM. What's genuinely rare is the **grounded visual
citation loop**: click a citation → see the actual page of the actual document.
None of the local tools do that well. **That should be the product.**

### Risk 1 — RESOLVED by decision: Coracle is a GPU app, no CPU-only claim
All benchmarks (~1 s warm, 100% GPU) come from a GTX 1650 Ti. A 4B model on CPU
would be noticeably slower with a worse cold start, and we won't publish a number we
can't stand behind. **Decision:** Coracle is positioned as a GPU app — a discrete
GPU is recommended; we make **no CPU-only performance claim** and don't market to
no-dGPU laptops. (It will still *run* on CPU via Ollama's fallback; we simply don't
advertise, target, or benchmark that as a supported experience.)

> ~~⬜ Action: run the full stack on a CPU-only machine and measure.~~ **Dropped** —
> CPU-only is no longer a target, so there's nothing to prove here.

### Risk 2 — the two use cases differ in difficulty
- *"Explain photosynthesis from chapter 4"* — classic RAG, a 4B model handles it. ✅
- *"Find the March invoice"* — retrieval + aggregation across many files; vector
  RAG with a small model does this poorly. ⚠️

> ⬜ **Action:** lead marketing with the student/reading use case; treat
> records-search as aspirational (may eventually need metadata/structured search,
> not just vector RAG).

### Model choice
Phi-3.5-mini is a mid-2024 model. Better permissive options exist:
- **Phi-4-mini** — also MIT, meaningfully better.
- **Qwen3-4B** — Apache-2.0 (unlike the non-commercial Qwen2.5).

> ⬜ **Action:** bake-off before freezing the bundled model. *(Now easy — the in-app
> model picker + downloader, built 2026-06-13, swaps between installed models and pulls
> new ones; see `Coracle-DEV-NOTES.md`. `phi4-mini` / `qwen3:4b` are in the download catalog.)*
> ✅ **Done:** non-commercial models can no longer end up in front of the user — the download
> catalog is an MIT/Apache allowlist (`pull-model` refuses anything else) and the picker filters
> `qwen2.5` out (`HIDDEN_MODELS`). `qwen2.5` may still sit in `tooling/ollama-models` for dev but
> is never offered or pullable through the app.
> ✅ **Bake-off resolved (2026-06-20):** the blessed default is **`granite4.1:3b`** (IBM, Apache-2.0),
> not phi3.5 — it stays on-source without the `Context N` scaffolding leak phi3.5 exhibits. Now the
> default in the packaged env + summary fallback + catalog lead (`default:true`); phi3.5 demoted but
> kept available. phi4-mini sits second as the sharper MIT option.

---

## On the build

### What's good
- `main.js` small and sensible: health-checked boot, reuses a running dev stack,
  `OLLAMA_KEEP_ALIVE` mitigation, clean child shutdown.
- Preload bridge minimal, `contextIsolation: true`.
- Originals-retention design (stash → commit under docId → discard on failure)
  cleanly solves "converter trashes the source."
- UI copy has real user empathy; both UI copies in sync.

### Issues, in priority order

#### 1. ✅ v1 BUILT (2026-06-12) — jump-to-page citation loop
**Verify-first question answered: no re-embedding needed.** Each chat `source`
already carries its retrieved chunk text (`lance/index.js:375` stores
`metadata.text = textChunks[i]`; `curateSources` preserves it). So a citation maps
to a page purely from data the engine already returns.

**Implemented (UI only, in `tooling/amadocs-ui/index.html` → synced to
`amadocs-desktop/ui/`):**
- `resolveCitations()` / `matchPage()` — locate a source's chunk text inside the
  document's extracted text (via cached `doc-view`), map its char offset onto the
  per-page `pages` ranges. Strips the `<document_metadata>` header the splitter
  prepends; prefers a slice that occurs **exactly once** to survive repeated
  headers/footers (exam papers etc.).
- Citation chips now show `📄 name · p.N` and **jump to that page** in the viewer
  (opens PDF "pretty" mode, scrolls, briefly flashes the page). Falls back to
  page-less open when no match / non-PDF / pre-`pages` documents.
- "Open in file explorer" links retain the old reveal-in-OS behaviour.

**Verified:** `doc-view` returns real `pages` for freshly-ingested PDFs (13-page
exam doc); `matchPage` resolved **13/13** pages correctly against real content
(12/13 before the unique-slice hardening, fixed). Live end-to-end chat click-through
not run because the *running* server process lacked `OLLAMA_BASE_PATH` (see note
below) — the citation→page data path itself is fully verified.

**Still open / v2 (optional hardening):**
- ⬜ Store each chunk's `start` offset at embed time (`lance/index.js`) to remove
  string-matching entirely. Only helps docs re-ingested after the change.
- ⬜ Page ranges are **PDF-only** (`asPDF`). DOCX/PPTX get no page jump yet.
- ⬜ Documents ingested *before* the `pages` collector code have no ranges → no
  page number (graceful: chip just opens the doc). Re-ingest to enable.

#### ✅ v2 BUILT (2026-06-12) — passage highlighting (fixes "lands a page early")
Live-testing surfaced a real flaw in v1: `matchPage` maps a citation to the page
where its retrieval **chunk begins**, not where the cited sentence is. When a doc's
pages hold less text than a ~1000-char chunk, the chunk spans 2–3 pages and the chip
lands 1–2 pages early (verified: fact p9 → chip p7). Fine for text-dense pages
(the 13/13 exam doc had ≥1 chunk per page), wrong for sparse ones.

**Fix (UI only, `tooling/amadocs-ui/index.html` → synced):** the PDF viewer now
renders the **PDF.js text layer** over the canvas for the cited page window and
**highlights the spans of the cited passage** (yellow), scrolling to the first
highlight. Citation chips carry their chunk text via a `CITES[]` registry
(`data-cite=<idx>`, kept out of the DOM to avoid re-opening the XSS hole). Matching:
`normWS` + sliding-fragment `findPassageRegion`, char-range→span via an `owner[]` map
from the rendered spans. **Validated** by running the verbatim matcher in Node over
4 real-query chunks against real PDF.js extraction — the highlight covers the fact's
page in all 4 cases. **Still unverified:** the actual in-browser render
(text-layer alignment / scroll) — needs a human eyeball.

> **Config issue found while testing:** the `my-documents` workspace had
> `chatProvider: null`, so chat fell back to a misconfigured system provider and
> aborted ("No OpenAI API key" / "No Ollama Base Path"). The UI's `ensureWorkspace`
> only sets `chatMode`, not the provider — in a packaged build, pin the workspace
> to `chatProvider: "ollama"` (and ensure `OLLAMA_BASE_PATH` is set, which
> `main.js`/`start-stack.sh` do but the manually-started server didn't). I pinned
> the dev workspace to `ollama`/`phi3.5` during testing.

#### 2. ✅ FIXED (2026-06-12) — filename XSS in the renderer
`addDocRow()` interpolated the raw filename into `innerHTML` (both the `.nm` text and
`title=`) — a file named `<img src=x onerror=…>.pdf` would execute script. Now uses
the existing `esc`/`escAttr` helpers (the one spot that had missed them). Synced to
both UI copies.

#### 3. ✅ FIXED (2026-06-14) — open localhost API
The server on :3001 was unauthenticated with permissive CORS (the UI fetches from
`file://`). Any webpage in the user's regular browser could call it — read documents,
upload, delete. Awkward headline for a privacy-first product.

**Fix:** Electron mints a per-boot token (`crypto.randomBytes(32)`), passes it to the
engine (`AMADOCS_API_TOKEN`) and to the renderer (preload bridge →
`window.amadocs.apiToken`). The engine gates **every** `/api` request on it
(`server/index.js`; timing-safe; Bearer header or `?token=` for the download anchor);
**token unset => passthrough, so the dev stack is unchanged.** UI auths via a `fetch`
shim + `apiUrl()`. Verified with a 6-case gate test; a live packaged launch still wants
an eyeball. See `PACKAGING.md`. *(Remaining: collector :8888 is also open — internal-only,
lower risk, follow-up.)*

#### 4. ✅ Node 18 EOL — DONE (migrated to Node 22, 2026-06-14)
Bundling an end-of-life runtime undercut the privacy/security story, so this needed doing
before ship — and it turned out **much smaller than originally scoped.** No native-module
rebuild was needed: every native module the engine ships (`@lancedb/lancedb`, `sharp`,
`canvas`, `onnxruntime-node`, `@prisma/client`) is a **prebuilt N-API binary** (ABI-stable
across Node majors), so all five load + run unchanged. We staged a **Node 22** binary in
`vendor/node/node`, bumped `.nvmrc`, and **rebuilt the packaged AppImage**. Verified end-to-end
with **no problems** (packaged app: boot → ingest → retrieval → grounded chat). Node 24 also
runs unchanged on the dev stack; 22 was chosen as the more conservative LTS. `engines` is only
`>=18` (no upper bound). `ELECTRON_RUN_AS_NODE` was a fallback that wasn't needed.

Still open: Electron 31 is a year+ old — bump before ship.

#### 5. Smaller things
- ⬜ Original-file paths keyed by bare filename in `localStorage` — two files with
  the same name from different folders collide ("reveal" opens the wrong one).
- ⬜ Uploads are serial with only a per-row spinner — the "dump a pile of
  documents" user will drop 100 files and want a queue with overall progress.
- ⬜ The originals-folder path is resolved independently in **three** places
  (collector utils, `doc-original` endpoint, delete cleanup); one drifting silently
  breaks the viewer. Centralize when next touched.

---

## Feature backlog

### ⬜ AI search-scope selector (the Library chip) — *idea captured 2026-06-12, not started*
**What the user wants:** turn the top Library/privacy note into a **scope selector**
so the chat always shows what the AI is reading.
- Default = **whole Library**: top chip reads e.g. `🔒 Searching all your documents ·
  100% on this computer` — folds search scope + the privacy reassurance into one control.
- **Left-click a doc** in the sidebar → scope narrows to that doc; chip becomes
  `📄 Searching: <doc> · ✕` (✕ returns to the whole Library). Doc still opens in
  the viewer as today.

**Open decision (was being asked when parked):** does selecting a doc *actually
limit* the AI's retrieval to that doc, or is the chip *just a focus indicator*?
User was leaning toward **actually limiting** ("ai search selection").

**Effort — NOT much harder than the cosmetic version; contained:**
- Retrieval today searches the whole workspace; the only filter is **exclude-only**
  (`filterIdentifiers`), applied as a post-filter in the search loop
  (`server/utils/vectorDbProviders/lance/index.js:140` and `:201` — skip a chunk if
  its `sourceIdentifier` is in the list).
- To scope to one doc, mirror that with an **include/scope filter** threaded through
  the existing path: chat endpoint (`endpoints/chat.js`) → `utils/chats/stream.js`
  (`performSimilaritySearch` call) → lance post-filter (keep only chunks whose
  `sourceIdentifier` matches the selected doc). ~3 files, low risk, reversible.
- Watch: `topN` may need a small over-fetch since filtering shrinks results.
- `sourceIdentifier` is defined at `server/utils/chats/index.js:116` — that's the
  identity the UI must send to name the selected doc.
- Cosmetic-only version (focus chip, no retrieval change) is UI-only if scope turns
  out to be unwanted.

**Next step when resumed:** confirm scope-vs-indicator, then build chip UI + (if
scoping) the include-filter plumbing above.

---

## Next three moves

1. ✅ ~~Close the jump-to-page citation loop~~ — **v1 + v2 (passage highlighting)
   built 2026-06-12**; matcher validated against real PDF.js extraction (build item
   #1). Remaining: a human needs to eyeball the in-browser highlight alignment/scroll.
2. ✅ ~~**Run the stack on a CPU-only laptop and measure**~~ — **dropped (see
   Risk 1): Coracle is a GPU app and makes no CPU-only claim, so there's nothing to
   measure.**
3. ✅ ~~Fix the filename XSS~~ (done, build item #2). ✅ ~~Node-18 EOL exit (#4)~~ —
   **migrated to Node 22, packaged AppImage rebuilt + verified, 2026-06-14.**
   *(API session token #3 ✅ done 2026-06-14.)*

---

*Bottom line: the foundation is genuinely good — small, legible, honest about
what's borrowed vs. built. The risk isn't in the code; it's that the one thing that
would make this a product rather than a nicer AnythingLLM skin — visual citations —
still wants an in-browser eyeball. (CPU performance is no longer on the hook:
Coracle is a GPU app and makes no CPU-only claim.)*
