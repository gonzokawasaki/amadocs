---
name: k-base-status-feedback
description: "K-base activity/status feedback goes through one in-chat status bubble, not floating chrome"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ffcb6f67-5d45-4c78-a09c-7d0c408f17aa
---

For AMAdocs/[[k-base-project]], surface activity + app status through **one in-chat
"system" bubble in the conversation flow** — not a floating pill/banner or other
chrome. Built 2026-06-13 as `addSystemMsg` in `amadocs-ui/index.html`: a centered
status bubble showing a spinning dial + live elapsed timer while a job runs, then
✓ done (fades) / ⚠ error (stays). Used for document indexing; meant as the general
channel for other app status too. The answer-bubble "thinking" indicator (timer +
escalating reassurance for cold first answers) is the same idea, in the AI bubble.

**Why:** user judged the chat bubble "simpler and more direct" than an earlier
floating activity pill, and wants it reusable for other status/app info. Driver was
the "silent app, fan spinning for minutes → user thinks it crashed" problem — the
ticking timer is deliberate proof-of-life.

**How to apply:** for new long/async operations or app messages, prefer extending
`addSystemMsg` over adding new floating UI. Keep small in-place spinners (doc-row
spinner, chat typing dots). Pending polish: chat avatars should read "ME"/"AI" text,
not the `🙂`/`A` icons (noted in AMAdocs-DEV-NOTES.md, not started).
