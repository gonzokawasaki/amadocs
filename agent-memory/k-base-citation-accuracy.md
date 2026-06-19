---
name: k-base-citation-accuracy
description: "AMAdocs citation jump-to-page accuracy limit — matchPage maps to chunk-START page, lands early on sparse-text pages"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8fc20d2b-0110-47f1-913e-f3e7d25e367a
---

For [[k-base-product-direction]] (the grounded visual citation loop, AMAdocs's
moat). Live-tested 2026-06-12 end-to-end (real stack + phi3.5 queries + the
verbatim `matchPage`/`stripChunkHeader` UI code in `tooling/amadocs-ui/index.html`
lines 331–353).

**Finding:** `matchPage` maps a citation to the page where its retrieval **chunk
begins**, not the page holding the cited sentence. A LanceDB chunk is ~1000 chars.
When a document's pages hold *less* text than that (sparse / big-heading / lots of
whitespace, e.g. ~440–550 chars/page), one chunk **spans 2–3 pages**, so the chip
points 1–2 pages BEFORE the actual fact. Verified on a 10-page synthetic doc:
fact p7→chip p6, p10→p9, p2→p1, p9→p7 (that chunk spanned pages 7→9). Off-by-one/two,
consistently early.

**It's accurate for text-DENSE pages** (≥~1000 chars/page → chunk fits inside one
page → chunk-start page == fact page). That's why the earlier 13-page exam doc
scored 13/13. Real textbook/admin PDFs are usually dense, so this mostly bites
sparse docs — but it still weakens the "jump to the EXACT page" headline.

**Why string-matching to chunk start can't fix it:** we don't know which sentence
in a multi-page chunk the answer actually used; the v2 "store chunk start offset at
embed time" (in AMAdocs-FABLE-RECOMMENDATIONS.md) maps to the same chunk-start, so
it won't help either.

**FIX CHOSEN + BUILT (2026-06-12): passage highlighting (option A).** User picked
"the real fix" over the cheap page-range display. Implemented UI-only in
`tooling/amadocs-ui/index.html` (synced to `amadocs-desktop/ui/`):
- Citations now carry their chunk `text` (`resolveCitations`), stored in a `CITES[]`
  registry referenced by `data-cite=<idx>` on the chip (kept OUT of the DOM to avoid
  re-introducing the attribute-escaping/XSS risk we just fixed).
- `renderPdf` rewritten: each page wrapped in `.vpage-wrap`; for a citation it renders
  the PDF.js **text layer** (`renderTextLayer`, v3.11 — needs `textContentSource` +
  `--scale-factor` on the container) over the canvas for the chunk's page window
  (matchPage page .. +4), highlights the spans inside the cited passage (`.hl`), and
  scrolls to the FIRST highlighted span (`scrollToHighlight`, block:center).
- Matching: `normWS` (collapse ws + lowercase) both sides; `findPassageRegion` probes
  with sliding 40-char fragments and unions the hits → robust to the whitespace
  mismatch between the collector's extraction and PDF.js's. Char range → span indices
  via an `owner[]` map built from the rendered spans (not item indices — avoids
  div/item misalignment).

**Validated (2026-06-12):** ran the verbatim `normWS`/`stripChunkHeader`/
`findPassageRegion` + span-concat logic in Node against REAL PDF.js page extraction
(collector's pdfjs v1.10.100) for the 4 live-query chunks. Result: highlight spans
the chunk's pages and **covers the fact's page in all 4** (e.g. budget chunk spans
p7-9, fact p9 — highlighted; chip still says p7 but the highlight reaches p9). So the
"lands early" problem is solved: the whole cited passage is marked end-to-end.

**STILL UNVERIFIED (needs a human eyeball or CDP-driven Electron):** the actual
in-browser render — text-layer span positioning/alignment over the canvas, the yellow
highlight appearance, and `scrollToHighlight` behaviour. Can't run PDF.js
`renderTextLayer`/canvas headlessly in Node; the matching algorithm + data path are
verified, the DOM rendering is not yet seen live.

Test asset built: `tooling/test-docs/dept-reports.pdf` (10 pages, unique per-page
prose, one buried queryable fact per page) + `riverbend-archive.pdf` (5 pages, but
small enough to embed as ONE chunk — not useful for page-jump testing). The old
`test-curriculum.pdf` is image-only (0 text layer) — useless for citation tests.
