# Coracle — Packaging (AppImage)

Status as of 2026-06-14. Target: a single-file **AppImage** (Linux first; the machine
we develop on). Goal: one download → double-click → runs, fully local, no setup.

## 🅿️ AppImage rebuild is ON HOLD (2026-06-14)

**Decision (user): do NOT rebuild the AppImage yet.** It's not a blocker for anything —
all active work happens on the dev stack (source). The rebuild is the final ship step and
waits until much more testing is done; it is not a tracked task. Rebuild only when we
explicitly decide we're ready to ship. (When that day comes, one `yarn dist` folds in all
the source work at once — see the staleness note below for what that includes.)

## ⚠️ The shipped `dist/` AppImage is STALE (verified live 2026-06-14 PM) — rebuild WHEN shipping

The on-disk AppImage was built **~06:54 on 2026-06-14**, *before* that afternoon's source work
landed. Confirmed by a live run of the actual bundle: `window.amadocs` exposes no `apiToken`, the
API answers **HTTP 200 with no token** (gate in passthrough — `AMADOCS_API_TOKEN` never set), and
the bundled engine's `workspaces.js` has **0** `doc-summarize`/`doc-export-embedded` routes. So the
running bundle is **missing**: the API-token gate (the "open-localhost" fix), the right-click
**summariser** (UI + endpoints), the embed-summary export, the **phi3.5 leak guard**, and the
current UI. **All of it exists in source** — the bundle just predates it. One `yarn dist` ships
everything at once. Until then, the dev stack is the source of truth; the `dist/` artifact is not.

## Status: BUILT & verified end-to-end ✅ *(of the 06:54 build — see staleness warning above)*

`yarn dist` produces `amadocs-desktop/dist/Coracle-0.1.0-x86_64.AppImage` (**~2.3 GB**).
Verified live on the dev box (GTX 1650 Ti, 2026-06-14): boots fully offline from the
read-only AppImage mount, seeds a clean writable `userData` on first run, and the whole
stack works — **document ingest, image vision-captioning, and grounded chat** all
confirmed. The bundle ships **no Ollama models** (chat/vision models are a first-run
download — see "Remaining for a shippable build").

## How to build

```bash
cd amadocs-desktop && yarn dist     # → dist/Coracle-0.1.0-x86_64.AppImage (~2.3 GB)
```

All prerequisites below are already staged in the repo. To rebuild from scratch on a new
machine, re-do the "Prep (one-time)" steps first.

## How to run / smoke-test

```bash
cd amadocs-desktop/dist
./Coracle-0.1.0-x86_64.AppImage --no-sandbox
```

State lives in `~/.config/Coracle/` (storage, ollama-models, secrets.json). Delete that
dir to test a true first run. The bundle has no LLM, so to actually chat/caption, pull
models into the running app (or pre-seed `~/.config/Coracle/ollama-models`):

```bash
curl http://127.0.0.1:11434/api/pull -d '{"name":"granite4.1:3b"}'  # chat (~2.1 GB) — the default
curl http://127.0.0.1:11434/api/pull -d '{"name":"moondream"}'     # vision (~1.7 GB)
```

## What's bundled (electron-builder `extraResources` + `files`)

- **Engine** `engine/server` + `engine/collector` (the AnythingLLM fork incl. node_modules;
  `storage/**`, `.env*`, logs filtered out).
- **Node 22** binary (`node/node`) — the engine's native modules are prebuilt N-API (ABI-stable
  across Node majors), so they load + run unchanged on it.
- **Ollama runtime** `ollama/bin/ollama` **plus `ollama/lib/ollama/`** (llama-server +
  CUDA/CPU/Vulkan runner libs — see the ⚠️ note below; this is ~2.1 GB and the bulk of
  the payload).
- **Model seed** `storage-seed/models` (embedder + OCR + reranker, ~51 MB) and a clean
  pre-migrated **empty** `storage-seed/anythingllm.db`, seeded into `userData` on first run.
- **UI** `ui/**` (packed into `app.asar`).

`npmRebuild:false` — we run the engine on the bundled Node 22, NOT Electron's Node; do not
rebuild native modules to Electron's ABI.

## Payload

~2.3 GB AppImage (squashfs of a ~4.7 GB unpacked tree). Dominated by the **Ollama runtime
libs (~2.1 GB: cuda_v12 1.2 G + cuda_v13 807 M + vulkan 56 M + CPU core 27 M)** and the
engine node_modules (~1.5 G). **Ollama models (~3.8 G for granite4.1:3b + moondream) are NOT
bundled** → first-run download. Size wins available later: prune to a single CUDA major
(driver-dependent), prune the duplicate onnxruntime web/node builds in server node_modules.

## Prep (one-time, all DONE — recorded for rebuild/reference)

### 1. Prisma DB path → env-driven ✅
`server/prisma/schema.prisma` datasource is now `url = env("DATABASE_URL")`;
`server/.env.development` sets `DATABASE_URL="file:../storage/anythingllm.db"` (dev
identical); `npx prisma generate` regenerates the client. The packaged app overrides
`DATABASE_URL` to the `userData` DB via `main.js packagedEngineEnv`.

### 2. Clean seed DB → `amadocs-desktop/vendor/anythingllm.db` ✅
Pre-migrated EMPTY db so the AppImage never runs Prisma migrations at runtime:
```bash
cd anythingllm-upstream/server
TMP=$(mktemp -d)
DATABASE_URL="file:$TMP/seed.db" npx prisma migrate deploy
mkdir -p ../../amadocs-desktop/vendor && cp "$TMP/seed.db" ../../amadocs-desktop/vendor/anythingllm.db
```

### 3. Stage vendor binaries — node + the FULL ollama dir ✅
```bash
cd amadocs-desktop
mkdir -p vendor/node && cp "$(nvm which 22)" vendor/node/node && chmod +x vendor/node/node
# ⚠️ ollama: copy the WHOLE dir (bin/ + lib/), not just the binary — see note below
cp -a ../tooling/ollama vendor/ollama
```

### 4. Model assets
Bundled straight from `anythingllm-upstream/server/storage/models` (no separate staging).

## ⚠️ Critical: bundle the whole Ollama runtime, not just the binary

The first builds staged only `vendor/ollama/ollama` (the 38 MB binary). Modern Ollama
(0.30.7) runs inference through a **separate `llama-server` executable + ~2.1 GB of runner
libraries in `lib/ollama/`** (cuda_v12, cuda_v13, vulkan, CPU ggml variants). Without them
**every model 404s** (`error starting llama-server: llama-server binary not found`) — chat
AND vision are dead; only native-ONNX embedding works, which masks the problem. Fix:
bundle the dev `tooling/ollama/` dir wholesale (bin/ + lib/) → `vendor/ollama` →
`resources/ollama/`, and point `main.js OLLAMA_BIN` (packaged) at
`resources/ollama/bin/ollama` so ollama auto-finds `../lib/ollama`. electron-builder
preserves the lib symlinks (verified — not dereferenced).

## ⚠️ Collector writable dirs (read-only mount)

The collector runs from the read-only AppImage mount, so its `hotdir` (upload landing
zone) and `tmp` scratch must live in writable `userData`. Fixed (all tagged `Coracle:`):
`collector/utils/constants.js` exports `WATCH_DIRECTORY` + `TMP_DIRECTORY`, both
`NODE_ENV`-gated → packaged = `STORAGE_DIR/hotdir` & `STORAGE_DIR/tmp` (dev unchanged);
server `utils/files/multer.js` writes uploads to the same `STORAGE_DIR/hotdir`;
`main.js ensurePackagedStorage` creates both (multer won't); `wipeCollectorStorage` got a
missing `return` on its readdir-error path (was crashing the collector at boot on the
absent dir).

## Remaining for a shippable build (works, but not yet ship-ready)

- ✅ **Proactive first-run model download — BUILT (2026-06-14).** On boot, if the engine
  answers `custom-models` with no installed *chat* model (hidden/vision models excluded;
  a network error is treated as "engine warming up", not first-run), Coracle shows a full-screen
  **"Welcome to Coracle"** setup overlay (`#firstRun`, `amadocs-ui/index.html` → synced to
  desktop). One button downloads the default AI (granite4.1:3b) with a live progress bar, plus an
  opt-in (checked) "Let Coracle read images & scans" that pulls the vision model (moondream)
  afterwards — both over the existing `pull-model` SSE endpoint. The chat model pulled is the
  catalog's `default:true` entry (now **granite4.1:3b**, Apache-2.0). Sizes come from the catalog
  (best-effort, with fallbacks). On success it refreshes the model picker and dismisses; on
  failure it offers "Try again"; "Set up later" dismisses and falls back to the reactive prompt.
  The SSE-reading loop is now a shared `streamModelPull()` helper used by both the first-run
  screen and the download modal. **Still unbuilt:** an in-chat status bubble when a *feature*
  (e.g. vision) needs a model the user skipped. *(Static/syntax-verified + UI copies synced;
  the live overlay render and a true model-less-install download still want a human eyeball —
  same class as the citation-render item.)*
- ✅ **API session token — BUILT (2026-06-14).** Closed the open-localhost hole: `main.js`
  mints a per-boot secret (`crypto.randomBytes(32)`), passes it to the engine as
  `AMADOCS_API_TOKEN` (in `packagedEngineEnv`) and to the renderer via the preload bridge
  (`webPreferences.additionalArguments` → `preload.js` → `window.amadocs.apiToken`). The engine
  (`server/index.js`) gates **every** `/api` request on it (timing-safe compare; `Authorization:
  Bearer <t>`, or `?token=<t>` for the one download anchor that can't send a header); **unset =>
  passthrough, so the dev stack is unchanged.** The UI attaches it via a one-line `fetch` shim
  (auto-auths all `${API}` calls) + `apiUrl()` on the `doc-export` anchor. Gate logic verified
  with a 6-case standalone test (no-token/wrong→401, bearer/?token=→200, OPTIONS preflight→200).
  **Not yet eyeballed:** a live packaged launch (same human-eyeball class as the other packaged
  items). **Still open:** the **collector :8888** is also unauthenticated (server→collector is
  internal, the UI never calls it directly, so lower risk) — a follow-up if we want defense in depth.
- ✅ **Node 18 EOL — DONE (migrated to Node 22, 2026-06-14).** No native-module rebuild was
  needed: every native module the engine ships (`@lancedb/lancedb` 0.15, `sharp` 0.32.6,
  `canvas` 3.2.1, `onnxruntime-node` 1.14, `@prisma/client` 5.3.1) is a **prebuilt N-API
  binary** — ABI-stable across Node majors — so all five load + run unchanged. We staged a
  **Node 22** binary into `vendor/node/node`, bumped `.nvmrc`, and **rebuilt the packaged
  AppImage**. Verified end-to-end with **no problems**: the packaged app boots, ingests
  `dept-reports.pdf` → ONNX embed → lancedb retrieval → grounded phi3.5 chat (2 sources cited).
  Node 24 (current Active LTS) also loads + runs unchanged on the dev stack; 22 was chosen as
  the more conservative LTS jump. The `ELECTRON_RUN_AS_NODE` route remains an option but was not
  needed. `engines` is only `>=18` (no upper bound), so nothing in the engine pinned 18.
- ✅ **`LICENSE` + `THIRD_PARTY_LICENSES` — DONE (2026-06-14).** Root `LICENSE` (MIT) and a
  generated `THIRD_PARTY_LICENSES` (curated Part A bundled components + Part B runtime-downloaded
  models + Part C: 1628 unique npm packages, full notices). Audited clean — all permissive
  (MIT 1118 / Apache 297 / ISC / BSD / BlueOak); no strong copyleft; dual-licensed elected to
  the permissive side; LGPL `libvips` (via sharp) and MPL `web-push`/`dompurify` noted as
  permitted-with-attribution. Regenerate with `node tooling/gen-third-party-licenses.js`
  (reads `tooling/_tpl-header.txt`). Both files ship in the bundle via electron-builder
  `extraResources`. **Polish TODO:** copy Ollama's + llama.cpp's verbatim upstream LICENSE
  files into `vendor/ollama/` (currently their MIT terms are reproduced + sourced, not the
  upstream files); add the in-app **About → Licenses screen** (the shipped text file already
  satisfies the legal obligation — the screen is a nicety).
- **App icon** — default Electron icon currently (electron-builder warns).
- **Cross-platform** (Windows `.exe` / macOS `.dmg`) — needs those OSes or CI runners.
