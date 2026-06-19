---
name: k-base-answer-cap
description: "settled decision — AMAdocs is a search tool, AI answers hard-capped at ~120 words (one paragraph)"
metadata: 
  node_type: memory
  type: project
  originSessionId: ddb0585f-84a8-4f1d-b704-d461b66f9602
---

**Settled product decision (2026-06-13):** AMAdocs is primarily a **search tool, not a chatbot** — people want the point, not an essay on their docs/photos. AI answers are hard-capped at **~one paragraph (~120 words).** User considered this "perhaps the final decision on the ai stream." (User originally said "450 words" but equated it to "a paragraph"; clarified down to ~120 words = an actual paragraph.)

**Why:** the live look at the vision feature surfaced phi3.5 producing multi-paragraph hedging essays on a simple "what's in this photo" question — the user stopped the stream mid-answer. Length, not just verbosity, is the UX problem for a search tool.

**How to apply:** enforced in 3 layers (all tagged `AMAdocs:`):
1. Engine hard stop — `num_predict: 200` (~120 words) in `server/utils/AiProviders/ollama/index.js`, in the `options` of both `getChatCompletion` + `streamGetChatCompletion`. The real guarantee; model physically can't ramble, applies regardless of workspace/prompt.
2. Prompt — concision clause appended to `saneDefaultSystemPrompt` (subject to the openAiPrompt-baking gotcha, see [[k-base-strict-prompt]]).
3. UI — `capAnswer()` in BOTH UI copies trims final answer to ≤120 words ending on last full sentence (token cut never shows mid-word).

Verified live: robot-photo Q → engine stopped at 125 words (was an essay) → capAnswer → clean 109-word paragraph. **Still phi3.5-limited within the cap:** leaks internal `CONTEXT 0/1` chunk labels + meta-scaffolding into answers — a quality issue separate from length; candidate next fix is prompt ("never mention CONTEXT") or model swap via the picker. Relates to [[k-base-strict-prompt]], [[k-base-image-analyser]], [[k-base-modes-direction]].
