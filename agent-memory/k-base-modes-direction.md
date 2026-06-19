---
name: k-base-modes-direction
description: "K-base direction — two modes (Find/Discuss); config-as-intent is OK, only plumbing-config banned; finder-first"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf03c327-5af9-45d4-a52e-195934d3e4a0
---

Direction agreed 2026-06-13 in discussion. The app is a **humble finder**: "pull a specific thing (figure, clause, quote, date) out of a messy pile and show me where it came from." Explicitly NOT competing with frontier models; multi-doc aggregation / synthesis is out of scope and that's fine. Real user pain (user's own, from day job): orgs overproduce paperwork, you *know* a fact is in a doc but exact wording escapes you, so keyword search fails — AI bridges concept→wording. This makes retrieval-first the spine, Discuss the bonus (resolves the earlier search-vs-chat tension toward search). See [[k-base-product-direction]], [[k-base-retrieval-tuning]].

**Modes (start with TWO, add more later if they prove out):**
- **Retrieval / "Find"** (admin docs) — thin/no LLM, ranked cards + the highlighted passage is the answer, terse, tiny fast model.
- **Discussion / "Discuss"** (study docs) — prose, conversational, synthesis; verbosity is a feature here; most capable model the machine affords.
- A mode is a *bundle* (retrieval params + output shape + which model), not just a prompt. Modes can drive model selection so the user never knowingly swaps models (the picker becomes an implementation detail). Modes must **look** different (cards vs prose), or users perceive one confusing chatbot toggle.
- Future 3rd "synthesis" mode deferred (ambiguous: generate quiz/flashcards FROM docs, vs multi-doc answer synthesis).

**Config philosophy correction (user's, important):** "zero config" was always shorthand for "no *jargon/plumbing* config" (model/embedder/vector DB). Asking the user's **intent** in plain language ("looking something up, or studying this?") is fine — most users grasp find-vs-discuss instantly. Surface lean: per-collection default (Admin→Find, Coursework→Discuss) + a visible per-query override; dovetails with the planned Library scope chip ([[k-base-search-scope-feature]]). Honesty rule: a finder should say "I couldn't find that" rather than confabulate — against a user who knows the truth, a plausible-wrong quote is a betrayal.
