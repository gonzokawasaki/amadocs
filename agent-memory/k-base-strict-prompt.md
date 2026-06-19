---
name: k-base-strict-prompt
description: "AMAdocs strict-grounding system prompt experiment — status, wiring gotcha, test result (2026-06-12)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 477de7b8-8ee2-41c2-9588-74f883052d28
---

Experiment (in progress, uncommitted, 2026-06-12): make the LLM stop giving chatty/generic
answers and stick strictly to the provided document context. See [[k-base-project]].

**The change:** `anythingllm-upstream/server/models/systemSettings.js` — `saneDefaultSystemPrompt`
rewritten from the generic AnythingLLM default to a hard-grounded one ("Answer using ONLY the
context… no outside/general knowledge… if not in context, say you could not find it… answer
directly and concisely"). Uncommitted git diff.

**Wiring gotcha (important):** `chatPrompt()` (`server/utils/chats/index.js:96`) resolves to
`workspace.openAiPrompt ?? saneDefaultSystemPrompt`. A workspace's `openAiPrompt` is captured
into its DB column at *creation* time (`server/models/workspace.js:211`). So editing the
saneDefault in the file does NOT change existing workspaces — only newly-created ones and the
packaged default. Existing `amadocs-test` / `my-documents` still hold the OLD prompt in DB.
To iterate the prompt against a workspace, update its `openAiPrompt` directly (API update
endpoint or sqlite). `grounding-check` is the fresh test workspace that already has the strict
text in its `openAiPrompt` column.

**Test asset:** David Copperfield PDF embedded into `grounding-check` workspace — a book phi3.5
clearly knows from training, so it probes whether the model stays inside the excerpt vs. falling
back on training data.

**Result (probe: "Who is Mr. Micawber and what is his relationship to David?"):** answer was
grounded in the actual excerpt (social meal, Mrs./Uriah Heep, "never desert him", leaving
London) BUT two leaks remain: (1) still names the work from outside the text — "from David
Copperfield by Charles Dickens" — though this may be the model reading the filename via the
`<document_metadata>` header the splitter prepends, not pure training recall; (2) still very
verbose (4 padded paragraphs of "this suggests/hints/indicates"), ignoring "concisely". phi3.5
verbosity is the core issue (see [[k-base-project]] dev notes "Phi-3.5 is verbose").

**✅ phi3.5 instruction/Context-label leak — FIXED 2026-06-14 PM (the real fix is a UI guard, NOT the prompt).**
Measured on the dev stack: phi3.5 leaks **4/12** answers, almost all the internal `Context 0/1/2`
chunk-label parroting (worst on vague "tell me about the documents" queries; specific-fact Qs stayed
clean). The live AppImage also showed a hallucinated `## Instruction:` follow-up block leaking into a
bubble.
- **Prompt clause: TRIED, INEFFECTIVE on phi3.5.** Appended to `saneDefaultSystemPrompt` a "never refer
  to 'the context'/'Context 0/1'/chunk numbers — answer as if you simply know it" instruction.
  Re-measured with it **baked into a fresh workspace → still 4/12.** Small model ignores it. Kept as a
  cheap belt; not the fix. (Still subject to the baking gotcha above.)
- **UI guard = the guarantee:** new `stripScaffolding()` inside `capAnswer()` (both UI copies) cuts the
  answer at the first hallucinated marker (`## Instruction/Task/Additional`, `Context \d`, `In your
  response:`, `(Increased difficulty)`, fake `System:/User:/Assistant:` turns) **and backs up to the
  last full sentence**. Catches a short leak that fits inside the 120-word cap (the exact live failure).
  Unit-tested vs. real leak text + clean/legit answers; `Context \d` needs a digit so no false positive
  on the word "context". **TODO: eyeball the strip in the live browser UI** (only unit-tested + run on
  captured raw model output so far).

**Earlier next-ideas (superseded for the leak, may still help quality):** tighten wording, lower
temperature, confirm whether the title leak comes from the filename metadata header.

**To run the stack** (power-loss recovery): start bundled Ollama first
(`OLLAMA_MODELS=…/tooling/ollama-models OLLAMA_HOST=127.0.0.1:11434 setsid nohup
tooling/ollama/bin/ollama serve &`), then `bash tooling/start-stack.sh`. start-stack.sh does
NOT launch Ollama (only main.js does). Chat via SSE `POST /api/workspace/:slug/stream-chat`
(the non-stream `/chat` is 404 in dev). See [[k-base-dev-environment]].
