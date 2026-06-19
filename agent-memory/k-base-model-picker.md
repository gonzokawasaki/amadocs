---
name: k-base-model-picker
description: "K-base model swap + download feature; the swap lever is per-workspace chatModel, not env"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4adc935d-de35-4b51-90f1-885d846e54d1
---

K-base/AMAdocs ships an in-app **AI model picker + downloader** (built 2026-06-13). Topbar
`🧠 <name> ▾` lists installed Ollama models and swaps with one click; a "Get another model…"
modal downloads more with a live progress bar.

**Key gotcha (verified live):** the swap lever is the **workspace's `chatModel` column**, NOT
`OLLAMA_MODEL_PREF`. A pinned `chatModel` overrides the env default, so `POST /system/update-env`
silently no-ops against an existing workspace (`newValues:{}`). The UI switches via the normal
`/workspace/:slug/update` with `{chatProvider:"ollama", chatModel:<id>}`. Connects to
[[k-base-strict-prompt]] (the same openAiPrompt-vs-default per-workspace baking pattern).

**Licensing:** server-side `AMADOCS_MODEL_CATALOG` (MIT/Apache only) is the single source of
truth; `GET /system/model-catalog` + `POST /system/pull-model` (SSE proxy over ollama `/api/pull`)
**refuse any model not in the catalog**, keeping non-commercial `qwen2.5` out. UI also filters
`qwen2.5` from the installed list via `HIDDEN_MODELS`. New endpoints live in
`server/endpoints/workspaces.js` (tagged `AMAdocs:`); UI in `tooling/amadocs-ui/index.html`
(synced to `amadocs-desktop/ui/`). Enables the model bake-off the Fable review wanted
([[k-base-product-direction]]). qwen3:1.7b was pulled to the dev box during testing.
