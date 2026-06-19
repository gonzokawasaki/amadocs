# AMAdocs — Handover (for Claude on the Ubuntu/GNOME machine)

You are picking up an in-progress project that was developed on an **Arch + Hyprland** box and
moved to **Ubuntu (standard GNOME)** — deliberately, because the core bet rides on GNOME's desktop
indexer (LocalSearch/TinySPARQL), which is **dormant on non-GNOME** but **runs warm** on real GNOME.

**Read these first, in order** — they are the source of truth and far more detailed than this file:
1. `K-base.md` — what the product is, the 2026-06-15 "AI librarian" reframe, and the "ride on GNOME" direction.
2. `AMAdocs-DEV-NOTES.md` — architecture, every custom change, current phase, open bugs. **Start at "🧭 CURRENT PHASE".**
3. `PACKAGING.md` — the AppImage build (on hold) and packaging gotchas.
4. `AMAdocs-FABLE-RECOMMENDATIONS.md` — an external review / checklist.

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

`anythingllm-upstream/` was a shallow clone of `Mintplex-Labs/anything-llm` with the AMAdocs changes
**uncommitted** in its working tree. To make the handover a single clean clone, the nested `.git`
was **removed** and all files committed directly into this repo. Consequences:
- All custom work is here as plain files; every change is tagged **`AMAdocs:`** in-code (grep for it).
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
cd tooling/amadocs-ui && python3 -m http.server 8080   # the real AMAdocs UI → http://localhost:8080
```
**Or run the Electron desktop app** (`amadocs-desktop/`) — see `AMAdocs-DEV-NOTES.md` → "Run it".
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

---

## Current state / where to pick up

Fully built + eyeballed live (on the old box): the "ride on GNOME" loop end-to-end, incremental
delta-sync, the `gnome-sync` engine endpoint, the safe ingest queue (cool-down + hard STOP + durable
resume — "THE #1 RULE"), the **UI folder-sync flow** (picker → dryRun banner → progress + STOP), and
the grounded visual citation loop.

**Open items (from DEV-NOTES, most important first):**
1. **⚠️ OPEN BUG — incompatible LanceDB Arrow schemas.** Drag-drop uploads **fail** in a workspace
   that already holds bridged (gnome-sync) docs: the two doc producers write different column sets.
   Workaround: don't mix bridged + dropped docs in one collection. Durable fix (make both producers
   emit an identical column set) **not yet done**. See DEV-NOTES → "⚠️ BUG — OPEN (2026-06-17)".
2. **Cadence scheduler** — resume pending sync on relaunch + a light periodic tick. Not built.
3. **Promote Granite to default** — `granite4.1:3b` (Apache-2.0) stays on-source far more cleanly
   than phi3.5 (which leaks `Context N` scaffolding that the UI then visibly claws back). `.env`
   already points the default at granite; this is about making it the bundled/blessed default.
4. Cosmetic `p.N` citation label for bridged (flat-text) docs — needs poppler page-ranges.
5. Packaging: AppImage builds but the `dist/` artifact is stale; app icon + Windows/macOS pending.

## Gotchas (the ones that cost real time — full list in DEV-NOTES)

- **Don't** `pkill -f`/`pgrep -f` the electron path — it matches the controlling shell and kills it.
  Use explicit PIDs (`ss -ltnp`) or `setsid`.
- **Vector cache** is keyed on docpath, not content — re-dropping the same file reuses old chunks.
  Deep-search re-embed uses `skipCache=true` for exactly this reason.
- **`openAiPrompt` baking** — editing `saneDefaultSystemPrompt` only affects *newly created*
  workspaces; existing ones keep their baked prompt.
- **Custom doc-JSON producers must emit an identical field set** across all docs, or LanceDB's
  `.add()` throws (root of open bug #1).
