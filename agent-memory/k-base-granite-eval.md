---
name: k-base-granite-eval
description: Granite-4 Micro (3B) evaluated as phi3.5 replacement — wins on grounding refusal + no scaffolding leak
metadata: 
  node_type: memory
  type: project
  originSessionId: 4cfdd0d6-f8c2-45e0-bee9-30820a1d76f1
---

Granite-4 Micro (`granite4.1:3b`, IBM, Apache-2.0, 2.1GB, 128K ctx) evaluated 2026-06-17 as a candidate to replace phi3.5 as the default chat model. Pulled into `tooling/ollama-models`; added to `AMADOCS_MODEL_CATALOG` (passes the MIT/Apache `pull-model` allowlist).

**Finding (raw `ask.js` output vs phi3.5 on the `teaching` 100-doc IGCSE slice):** Granite does out-of-the-box the two things we hand-rolled guards for — (1) **refuses out-of-scope questions** ("no relevant information in this workspace") instead of answering from training knowledge = the core grounding fight; (2) **no `Context 0/1` scaffolding leak** on the vague "tell me about the documents" query that triggers phi3.5's leak ~⅓ of the time (the failure `stripScaffolding()` exists for). Also naturally concise (~respects the ~120-word cap unprompted) and fits the 1650 Ti; ~21s cold incl. load. Uses a bit more markdown than phi3.5 (handled by `capAnswer`/`stripScaffolding`).

**Why:** directly relevant to the model-choice thread [[k-base-model-picker]] and the anti-hallucination/leak work in [[k-base-strict-prompt]].

**✅ User live impression (2026-06-17):** running the dev stack with Granite as the dev default, the user said it "feels snappy and concise" and that it "sticks to the source text much more cleanly." Crucially they contrasted it with phi3.5: phi3.5 **leaked scaffolding into the stream, then the leak got cleaned up and disappeared mid-answer — which the user found CONFUSING** (text appears, then `stripScaffolding()`/`capAnswer()` retroactively trims it → visibly vanishes). Granite mostly doesn't leak at all, so there's nothing to claw back. Lesson: **fixing the leak at the source (a cleaner model) is strictly better UX than the post-hoc UI strip** — the visible retroactive cleanup itself erodes trust. Reinforces adopting Granite as the default swap (and means the UI guard, while still a needed belt, is a band-aid, not the answer).

**How to apply:** strong default-swap candidate; NOT yet adopted as the bundled default (still phi3.5 — see [[k-base-llm-delivery]]). Catalog entry only appears in the in-app picker after a server restart. To use now: set a workspace `{chatModel:"granite4.1:3b",chatProvider:"ollama"}`. Granite Guardian (groundedness scorer) is the un-explored follow-up idea.

**⚠️ Uncommitted dev-state left on disk 2026-06-17 (survives machine restart; not git-committed):**
- `granite4.1:3b` (2.1GB) pulled into `tooling/ollama-models`.
- `server/endpoints/workspaces.js` — Granite added to `AMADOCS_MODEL_CATALOG` (KEEP — intended).
- `server/.env.development` — `OLLAMA_MODEL_PREF` flipped `phi3.5` → `granite4.1:3b` (dev default now Granite; revert if reverting the experiment).
- `my-documents` + `teaching` workspace `chatModel` pinned to `granite4.1:3b` (DB-persisted).
- 🔧 `tooling/amadocs-ui/index.html` — `WS_SLUG`/`WS_NAME` default changed to `teaching` as a **DEMO convenience** (browser dev stack has no collection switcher; the desktop UI copy `amadocs-desktop/ui/` was left on `my-documents`). **REVERT BEFORE SHIP** — comment marks the spot.

**To relaunch after restart:** start Ollama (`tooling/ollama/bin/ollama serve` with `OLLAMA_MODELS=tooling/ollama-models`), then `bash tooling/start-stack.sh`, then serve the UI: `cd tooling/amadocs-ui && python3 -m http.server 8080` → open localhost:8080. (Unresolved: user reported "can't see it anywhere" at localhost:8080 — likely a remote-access / localhost-mismatch issue, not yet diagnosed.)
