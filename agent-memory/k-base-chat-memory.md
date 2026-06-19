---
name: k-base-chat-memory
description: "AMAdocs chat-memory model — session-scoped for docs, none for images; fixes cross-session regurgitation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 74034476-552b-430c-8f7f-2a8bc24c3d21
---

AMAdocs chat-memory model, settled 2026-06-13 (built same day).

**Decision:** docs get **session-scoped** memory (follow-ups work within one app launch, never
across launches); images get **NO memory at all** (a photo has thin metadata, "nothing to
discuss," and the model can't see it). Cross-session memory is OUT — it caused the AI to
"regurgitate previous conversations even in a different session" (the bug that triggered this).

**Why it happened:** the non-thread `/workspace/:slug/stream-chat` path fetched/stored history by
**workspace only** (`api_session_id:null`), so the last ~20 `workspace_chats` turns replayed into
every prompt forever, surviving restarts; the UI had no session concept.

**How it was fixed (all RUNTIME — bypasses the openAiPrompt-baking gotcha, applies to all existing
workspaces immediately):** UI sends a per-launch in-memory `SESSION_ID` (not localStorage); engine
threads it as `apiSessionId` into `recentChatHistory` + every `WorkspaceChats.new`. Image answers
(`imageGrounded = sources.every(amadocsIsImageSource)`, matched by image file-ext on source title
or the `Image description:`/`Text found in image:` markers) drop history AND aren't persisted, plus
get a runtime `AMADOCS_IMAGE_PROMPT` clause ("you CANNOT see the image, relay the description").
Files: `server/utils/chats/stream.js`, `server/endpoints/chat.js`, `tooling/amadocs-ui/index.html`.

**Status:** verified by unit test + clean boot + SSE smoke; NOT yet eyeballed live with real
photos/docs. Open tuning knob: mixed image+text retrieval falls to the doc/session-memory path by
design (all-images rule) — revisit after watching real behaviour. Full detail in
`AMAdocs-DEV-NOTES.md` "Custom changes to the fork". Relates to [[k-base-answer-cap]] (search-tool,
not chatbot), [[k-base-image-analyser]], [[k-base-strict-prompt]].
