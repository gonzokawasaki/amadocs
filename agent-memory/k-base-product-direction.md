---
name: k-base-product-direction
description: "AMAdocs differentiation strategy — consumer-grade experience, grounded visual document loop"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6d52f89f-83a3-4f9c-bf74-b38497a159a1
---

For [[k-base-project]] (AMAdocs). **Product bar set by user 2026-06-12: this must be a polished CONSUMER experience, NOT an "open-source DIY kit."** Forking AnythingLLM + a nice installer + a lick of paint is the delivery vehicle, not the value — the user explicitly worried about that and wants real differentiation. Treat rough/technical UX as a bug (reinforces the 10-second-rule north star in [[k-base-project]]).

**Chosen differentiator = the "grounded visual document loop":** AI answer → click the citation → the ORIGINAL document opens to the exact page with the cited passage highlighted. Serves both target users (students = trust/learning; admin archives = verification). Incumbents (AnythingLLM/GPT4All/Khoj) only do weak text-only citations, so this is the moat. Two other directions were considered but deferred: a study-companion layer (flashcards/quizzes) and cross-document archive intelligence (entities/auto-tag) — revisit later, not now.

**Status (2026-06-12):** the "pretty viewer" foundation is BUILT (see [[k-base-dev-environment]]): originals retained, rendered in-app (PDF.js/images/mammoth/xlsx), text-vs-original toggle, and per-page char-range tracking now flows through `doc-view`. REMAINING for the full loop: wire citation-click → open viewer → jump to page (+ passage highlight via PDF.js text layer). PPTX rendering was deliberately DROPPED (rarely text-heavy; not worth a ~300MB LibreOffice sidecar) — unsupported types fall back to the text view / reveal-in-explorer.
