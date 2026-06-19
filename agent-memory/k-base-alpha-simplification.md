---
name: k-base-alpha-simplification
description: "The big reframe (2026-06-15) — AMAdocs is an experiment-that-may-have-legs: AI librarian by default, opt-in semantic search; ship for technical early adopters"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3669b097-88d3-4bff-a732-68e9e19dd0e1
---

**Reframing session 2026-06-15 (non-coding). All the open questions from the earlier "Task 1" rethink are now RESOLVED.** This memory is the new landing; supersedes the earlier "pending one confirmation" state.

**1. Framing / tone — SETTLED.**
- **Honest origin story (the real "why"):** AMAdocs was born from (a) a conviction that an AI-enabled OS is round the corner and *semantic search over your own machine/files* becomes a defining feature, + (b) a personal itch — "I have a Claude subscription and a laptop; can I build something real with local AI?" It started as an experiment and became AMAdocs.
- **Tone = "an experiment that may have legs."** Not "alpha product," not a toy. Humble but not self-deprecating. This makes rough edges the *spec*, not bugs; lets ROADMAP be open-ended; makes "parked: too many pitfalls" read as good judgment. Public pitch: "an experiment I think has legs — come kick the tires."
- **Audience CONFIRMED = technical early adopters** (Linux/privacy/self-hoster/Ollama folks via AUR+GitHub). Non-technical zero-config users stay the *destination* (VISION), NOT the alpha bar. So GPU-required / needs-Ollama / AUR are honest specs, not failures.
- **AI-OS conviction goes public as BELIEF, not promise:** opens VISION.md as "the bet this came from," then immediately "AMAdocs is NOT that — it's the small slice one app can do today." README keeps it to a sentence; thesis ≠ feature commitment. Whole-drive/OS search stays OUT (OS vendors' turf) — now *consistent with the thesis*, not a limitation to apologize for. See [[k-base-companion-apps]], [[k-base-folder-index]].

**2. Product shape — CENTER OF GRAVITY MOVED (the big change).**
- OLD: a semantic-search engine that also makes summaries. NEW: **an AI LIBRARIAN that catalogs your files** (reads each, gives a summary/caption + useful embedded metadata) — and can **deep-read any file on request** for semantic Q&A + the citation loop.
- **Summary/caption/metadata = the DEFAULT** (bounded work per file). **Full-document semantic search/embedding = a conscious, per-file OPT-IN** (e.g. right-click "Deep search"). User: leaning into semantic-search-as-the-novel-bet is now *more interesting* than the original doc-search framing.
- **Ship-and-let-use-cases-evolve:** expose the capabilities, don't over-prescribe. (Forensic accountants deep-indexing scanned docs; people wanting AI metadata baked into files; etc.) This PROMOTES the metadata-embed feature ([[k-base-photo-export]], "Save copy with info") from Labs-hide into a named default value — caveat: still needs ONE live eyeball before exposed.
- The grounded visual citation loop ([[k-base-product-direction]]) is NOT demoted — it's repositioned as the *payoff of the opt-in deep mode* (the evidence the experiment "has legs"), not the default headline. Maps onto the two-stage [[k-base-search-scope-feature]]: default search finds the right *file*; deep mode searches *inside* it.
- **REVERSAL to log:** summary-at-ingest was previously made on-demand/opt-in to avoid the dump-100 tax ([[k-base-doc-summary]]). It is now the DEFAULT — accepted because safety > speed, and the cost is bounded + queued + stoppable (see [[k-base-ingest-safety]]).

**3. The #1 rule — DON'T KILL THEIR MACHINE (ethical, top constraint).** Full design in [[k-base-ingest-safety]]: bounded-by-default + strict serial DURABLE queue (resumes at relaunch) + deliberate cool-downs + honest upfront banner + hard global STOP. This is the tractable subset of the parked AI-Finder safety design ([[k-base-folder-index]]) — tractable now because bounding the work removed the worst pitfalls.

**NEXT MOVE:** draft VISION.md (one-sentence purpose + AI-OS-belief framing + experiment tone + librarian-default/opt-in-semantic shape + the keep/hide/defer list), then ROADMAP.md (done/works-today/ideas/parked-and-why), CONTRIBUTING.md, public README. Keep DEV-NOTES public as-is (radical transparency attracts contributors). KEEP core loop + citations + model picker + first-run download + OCR + vision; the safety model is in-scope alpha work, not parked.
