---
name: k-base-search-scope-feature
description: Planned AMAdocs feature — Library chip as an AI search-scope selector (whole library vs single doc)
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e8b3cd1-af0c-471b-8967-e7fdb1c34137
---

Planned but NOT started (idea captured 2026-06-12). The user wants the top
Library/privacy note to become an **AI search-scope selector**: default = whole
Library (chip also reinforces the "100% on this computer" privacy message),
left-clicking a doc narrows scope to that doc with a chip in the chat
(`📄 Searching: <doc> · ✕`, ✕ restores the whole library).

**Open decision:** does selecting a doc *actually limit* AI retrieval to that doc,
or is the chip just a focus indicator? User leaned toward actually limiting.

**Effort is contained** (confirmed in code): retrieval's only filter today is
exclude-only (`filterIdentifiers`, post-filtered at
`anythingllm-upstream/server/utils/vectorDbProviders/lance/index.js:140` & `:201`).
Add an include/scope filter mirrored through chat endpoint → `utils/chats/stream.js`
→ lance. `sourceIdentifier` (`server/utils/chats/index.js:116`) is the doc identity
the UI sends. Full design + effort notes are in
`/mnt/space/k-base/AMAdocs-FABLE-RECOMMENDATIONS.md` under "Feature backlog".

Relates to [[k-base-product-direction]] (grounded, in-app doc experience) and the
[[k-base-project]] zero-config goal.
