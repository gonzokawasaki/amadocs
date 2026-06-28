# Coracle — Handover (for Claude on the Ubuntu/GNOME machine)

You are picking up an in-progress project that was developed on an **Arch + Hyprland** box and
moved to **Ubuntu (standard GNOME)** — deliberately, because the core bet rides on GNOME's desktop
indexer (LocalSearch/TinySPARQL), which is **dormant on non-GNOME** but **runs warm** on real GNOME.

**Read these first, in order** — they are the source of truth and far more detailed than this file:
1. `K-base.md` — what the product is: a private, local AI file browser that rides on the GNOME indexer.
2. `Coracle-SPEC.md` — the canonical product spec (three-panel semantic file manager).
3. `Coracle-DEV-NOTES.md` — architecture, every custom change, current state, open items. **Start at the top header.**
4. `PACKAGING.md` — the AppImage build (on hold) and packaging gotchas.
5. `Coracle-FABLE-RECOMMENDATIONS.md` — an external review / checklist.

**Agent memory** — `agent-memory/` holds a snapshot of the previous Claude Code session's persistent
memory (the distilled decision log + the `[[wikilinks]]` the docs reference). Read `agent-memory/MEMORY.md`
as an index. To make it auto-load into your sessions, follow `agent-memory/README.md` (it copies into
`~/.claude/projects/<slug>/memory/`, where `<slug>` is this repo's absolute path with `/`→`-`).

---

## ⚠️ FIRST: absolute paths must be rewritten

> **✅ DONE on this machine (2026-06-18).** `/mnt/space/k-base` → `/home/user/claude/amadocs-main` already applied to all 6 affected files.

The repo was developed at `/mnt/space/k-base` (an SSD mount). On this machine it will live on a
**different path** (local drive). `tooling/start-stack.sh` was made **self-locating** (derives the
project root from its own path — no edit needed). Everything else with a hardcoded path is a
**dev/test harness**, not on the critical path to run the app, but fix them before using them:

```bash
# from the repo root, after cloning. Replace OLD/NEW with the real paths.
OLD=/mnt/space/k-base
NEW="$(pwd)"            # or wherever the repo now lives
grep -rl "$OLD" tooling/*.js tooling/lib/*.js 2>/dev/null \
  | xargs -r sed -i "s#$OLD#$NEW#g"
```

Files affected (all under `tooling/`): `diag.js`, `look.js`, `test-metadata-embed.js`,
`eyeball-cite.js`, `eyeball-sync.js`, `eyeball-stop.js`. They reference `…/tooling/logs` and
`…/server` (repo-relative — the sed fixes them).

Separately, the **test corpus** lived at `/mnt/space/teaching_docs` (NOT in this repo — see below).
`tinysparql-bridge.js` / `tinysparql-sync.js` take the folder as an argv (default
`/mnt/space/teaching_docs`); `eyeball-sync.js` / `eyeball-stop.js` hardcode `FOLDER` — point these
at whatever folder you index on this machine.

---

## What is and isn't in this repo

**In the repo (everything you need as source):** the flattened AnythingLLM fork
(`anythingllm-upstream/` — see "The engine is flattened" below), the Electron app
(`amadocs-desktop/`), the dev tooling + the **source-of-truth UI** (`tooling/amadocs-ui/index.html`),
all the docs, and the working dev config (`.env` files are committed — this is a **private** repo).

**NOT in the repo (gitignored — you must provide on this machine):**
| Thing | Where it lived | How to get it here |
|---|---|---|
| `node_modules/` (all 4 trees) | each package | `yarn install` (prebuilt native modules; see setup) |
| Ollama runtime + binary | `tooling/ollama/`, `amadocs-desktop/vendor/ollama/` | install Ollama, or copy the dir |
| Ollama models (granite, moondream) | `tooling/ollama-models/` (8.7G) | `ollama pull` (see setup) |
| Native embedder/OCR/reranker models | `…/server/storage/models/` | auto-download from HuggingFace on first use (needs internet once) |
| Engine state/data (LanceDB, SQLite, originals) | `…/server/storage/` (588M) | **rebuilt from scratch** — re-index from GNOME on this box. Not worth copying (paths inside reference the old machine). |
| Vendor packaging binaries | `amadocs-desktop/vendor/` | only needed to build the AppImage (`PACKAGING.md`) |
| The test corpus | `/mnt/space/teaching_docs` (805 docs) | external — bring your own folder to index |

If you want to preserve the *old* embeddings/work, you'd `rsync` `server/storage/` over manually —
but the intended path is to re-index this machine's own GNOME corpus fresh.

---

## The engine is flattened (no submodule)

`anythingllm-upstream/` was a shallow clone of `Mintplex-Labs/anything-llm` with the Coracle changes
**uncommitted** in its working tree. To make the handover a single clean clone, the nested `.git`
was **removed** and all files committed directly into this repo. Consequences:
- All custom work is here as plain files; every change is tagged **`Coracle:`** in-code (grep for it).
- The upstream-rebase link is preserved as artifacts in `tooling/`:
  `amadocs-engine-base-commit.txt` (the upstream base commit `6442ea9` + upstream URL),
  `amadocs-engine.patch` (the tracked-file diff), `amadocs-engine-changed-files.txt`.
  To rebase on upstream later: clone upstream at/after that commit, re-apply the patch + the
  net-new dirs (`collector/utils/DocSummary/`, `collector/utils/VisionCaption/`, etc.).

---

## Setup on Ubuntu (one-time)

> **✅ DONE on this machine (2026-06-18).** All steps below are complete. Jump to "Run the dev stack" to start working.

```bash
# 1. Toolchain
nvm install 22 && nvm use 22        # or install Node 22 however you like
corepack enable                      # provides yarn 1.22.x (the stack dies without it)
sudo apt install build-essential git # belt-and-braces for any native module that needs it

# 2. Dependencies (prebuilt N-API binaries fetch the linux-x64-gnu variants on Ubuntu)
cd anythingllm-upstream/server   && yarn install
cd ../collector                  && yarn install
cd ../../amadocs-desktop         && yarn install
# (frontend/ is the upstream React app — we don't ship it; install only if you want it)

# 3. Prisma client + a fresh dev database (storage/ is gitignored, so the DB doesn't exist yet)
cd ../anythingllm-upstream/server
./node_modules/.bin/prisma generate
# ⚠️ GOTCHA: prisma migrate deploy does NOT pick up .env.development — pass DATABASE_URL inline:
mkdir -p storage
DATABASE_URL="file:../storage/anythingllm.db" ./node_modules/.bin/prisma migrate deploy
# Also: use the project's OWN prisma binary (./node_modules/.bin/prisma), not npx prisma —
# npx pulls the latest Prisma 7 which has breaking schema changes incompatible with this project.

# 4. Ollama + models  (granite4.1:3b is the configured default; moondream for image vision)
#    Install Ollama: curl -fsSL https://ollama.com/install.sh | sudo sh
#    (The install script needs sudo; the daemon starts automatically as a systemd service.)
ollama pull granite4.1:3b            # default chat model (.env OLLAMA_MODEL_PREF)
ollama pull moondream                # vision captioning (optional)
```

**Run the dev stack:**
```bash
bash tooling/start-stack.sh          # server :3001, collector :8888, frontend :3000
cd tooling/amadocs-ui && python3 -m http.server 8080   # the real Coracle UI → http://localhost:8080
```
**Or run the Electron desktop app** (`amadocs-desktop/`) — see `Coracle-DEV-NOTES.md` → "Run it".
The native embedder model downloads from HuggingFace on the **first embed** (needs internet once).

---

## Coexisting with the stock AnythingLLM already installed on this machine

This box already has **AnythingLLM + Ollama (with a qwen model)** installed. They coexist fine, with
one caveat:

- **Ollama — shared, no conflict.** Both use the one daemon on `127.0.0.1:11434`. Our stack does NOT
  start its own Ollama (`start-stack.sh` expects one running), and the Electron app **pings 11434 and
  only spawns its own if nothing answers** (`amadocs-desktop/main.js`). So the existing system Ollama
  is reused. Just `ollama pull granite4.1:3b` (+ `moondream`) into that shared daemon. The qwen model
  sitting alongside is harmless — our workspaces pin their own model. *(Licensing note: Qwen**2.5** is
  non-commercial and our model picker hides it via `HIDDEN_MODELS`; Qwen**3** is Apache-2.0 and fine.
  Neither causes a runtime conflict.)*
- **⚠️ Ports — the one real conflict. Do NOT run both AnythingLLMs at once.** Our stack binds
  **3001 (server)** and **3000 (frontend)** — which are **AnythingLLM's own defaults** — plus
  **8888 (collector)**. If the installed AnythingLLM is running, those ports are already taken and our
  server won't bind. **Quit the stock AnythingLLM before launching ours** (or remap `SERVER_PORT` in
  `server/.env.development` + the collector/frontend ports — simpler to just not run both).
- **Storage/data — separate, no conflict.** Our fork uses a repo-local DB
  (`DATABASE_URL=file:../storage/anythingllm.db`) and its own `storage/`. The stock app keeps its own.
  Workspaces, embeddings, and settings do not cross over.

---

## GNOME indexer (the whole reason for the move)

On this GNOME box, LocalSearch/TinySPARQL should be installed and **running warm** (unlike the Arch
box, where it was dormant and had to be force-started/restarted). Verify and scope it:

```bash
# Is the indexer alive?
tinysparql status 2>/dev/null || localsearch status
# Scope what it indexes (example: a single folder). SAVE the old value first.
gsettings get  org.freedesktop.Tracker3.Miner.Files index-recursive-directories
gsettings set  org.freedesktop.Tracker3.Miner.Files index-recursive-directories "['<your-folder>']"
```
The bridge queries the **live daemon over D-Bus** (`tooling/tinysparql-bridge.js`, or the engine
endpoint `POST /workspace/:slug/gnome-sync`). On real GNOME the "must restart localsearch to force a
re-crawl" caveat from DEV-NOTES should no longer apply, and the `TrackerNotifier` push-sync path
becomes viable. **Verify this assumption early** — it's the core bet.

> **🔎 First look on this box (2026-06-20):** daemon is up + D-Bus reachable, but the index is **sparse
> so far** — `localsearch status` = *idle*, only **32 files / 72 folders** indexed and **just 14 with
> extractable text** (a tiny fraction of `$HOME`; the crawl is incomplete, not warm yet). ~169 extraction
> failures (155 `.mts` video = benign; **9 `.docx`** with a parser error = a real blind spot, and
> `teaching_docs/` is docx-heavy). Left the machine idling to let the idle-aware crawl deepen; re-check
> `localsearch status` + the text-bearing count later. Full detail in DEV-NOTES → "🔎 OBSERVED (2026-06-20)".

---

## Current state / where to pick up

Fully built + eyeballed live (on the old box): the "ride on GNOME" loop end-to-end, incremental
delta-sync, the `gnome-sync` engine endpoint, the safe ingest queue (cool-down + hard STOP + durable
resume — "THE #1 RULE"), the **UI folder-sync flow** (picker → dryRun banner → progress + STOP), and
the grounded visual citation loop.

**Open items (from DEV-NOTES, most important first):**
1. ✅ **Cadence scheduler** — DONE + VERIFIED LIVE (2026-06-20). Resume-on-relaunch + periodic delta
   tick, server-side (`utils/GnomeBridge/cadence.js`), wired into boot. Shares the durable sync path via
   the extracted `GnomeBridge.runSync()`; respects the global STOP latch. Proven live on this GNOME box:
   boot-start logs clean, drained 11 real files 3-at-a-time across ticks, STOP stays stopped until an
   explicit re-sync (throwaway ws, torn down). Only the packaged-Electron path is still un-eyeballed.
2. ✅ **Promote Granite to default** — DONE (2026-06-20). `granite4.1:3b` (Apache-2.0) stays on-source
   far more cleanly than phi3.5 (which leaks `Context N` scaffolding the UI then claws back). Beyond
   `.env.development`, the **packaged** default (`amadocs-desktop/main.js` → `packagedEngineEnv`) and the
   doc-summary fallback (`collectorApi`) now both read granite, and the download catalog leads with
   granite (`default:true`); phi3.5 demoted, no longer labelled "the default".
3. ✅ **Collector backstop for GNOME's extraction blind spots** — DONE + VERIFIED LIVE (2026-06-20 PM).
   Files GNOME can't extract text for (docx/xlsx/pptx OOXML-routing failures, scanned PDFs, images) now
   run through Coracle' own collector extractors and embed: office docs + scanned PDFs **automatically
   during folder sync**, images **on-demand via right-click "analyse with AI"** (which previously
   dead-ended on images). Engine: `GnomeBridge.queryBlindSpots`/`materializeViaCollector`/`backstopFile`
   (idempotent by `sourcePath`), `POST /workspace/:slug/analyse-file`, generalized `doc-original`
   fallback. ⚠️ Needs `ollama pull moondream` for image *captioning* (else only OCR text). See DEV-NOTES
   top entry "✅ DONE (2026-06-20 PM) — Collector backstop".
4. ✅ Cosmetic `p.N` citation label for bridged docs — DONE (2026-06-21, backstop PDFs only).
   `buildDoc` now carries the per-page char ranges `asPDF` already computes through
   `materializeViaCollector`, so collector-backstop PDFs (scanned/OCR/empty-text) + right-click-analysed
   PDFs get `p.N` labels. `pages` is a disk-only doc-JSON field (read by `doc-view`), not in the LanceDB
   schema. GNOME-text PDFs stay label-less by design (labeling them would mean re-parsing every PDF →
   abandons ride-on-GNOME). Verified live in the Electron app on the 83-page scanned "Year 6 ICT
   Translated KNTT" book → chips `p.11`/`p.18`, click jumps to the page. See DEV-NOTES top entry.
5. ✅ `gnome-sync` dryRun over-count — FIXED (2026-06-21). `queryFileList` now requires non-empty
   `nie:plainTextContent`, and `queryBlindSpots` treats empty-text backstop-ext files as blind spots —
   so files GNOME stored an empty text for (an `.xlsx` + a scanned `.pdf` on the test corpus) route to
   the collector backstop and actually embed instead of being counted-but-never-embedded. dryRun preview
   now matches what executes. See DEV-NOTES top entry.
6. Packaging: AppImage builds but the `dist/` artifact is stale; app icon + Windows/macOS pending.

(The earlier LanceDB Arrow-schema bug — drag-drop vs. bridged docs writing different column
sets — is **fixed** as of 2026-06-19 via `withAmadocsSchema()`; see DEV-NOTES.)

## Gotchas (the ones that cost real time — full list in DEV-NOTES)

- **Don't** `pkill -f`/`pgrep -f` the electron path — it matches the controlling shell and kills it.
  Use explicit PIDs (`ss -ltnp`) or `setsid`.
- **Vector cache** is keyed on docpath, not content — re-dropping the same file reuses old chunks.
  Deep-search re-embed uses `skipCache=true` for exactly this reason.
- **`openAiPrompt` baking** — editing `saneDefaultSystemPrompt` only affects *newly created*
  workspaces; existing ones keep their baked prompt.
- **Custom doc-JSON producers must emit an identical field set** across all docs, or LanceDB's
  `.add()` throws (root of open bug #1).
