---
name: k-base-ocr-quality
description: v2 #2 OCR quality DONE for build 1 — DPI bump+tunable (OCR_PDF_DPI), grayscale/normalize/upscale prep; gain unquantified (no real scans); build 1 English-only so UI lang picker deferred
metadata: 
  node_type: memory
  type: project
  originSessionId: 44f63927-d2bd-49c9-bbe7-89fcb83dce90
---

v2 feature #2 (OCR quality) — **DONE for build 1 (2026-06-13)**. All in `collector/utils/OCRLoader/index.js`, tagged `AMAdocs:`, no new deps.

**What was done:**
- Scanned-PDF rasterization DPI: hard-coded **70** (actually a slight shrink) → default **150**, env-tunable via **`OCR_PDF_DPI`**, clamped **[72,300]** (`parseDpi()`). Ceiling is an OOM guard (safety-first, ties [[k-base-folder-index]]). Threaded into `PDFSharp` via a `dpi` ctor option; knob added to `collector/.env` + `start-stack.sh`.
- `preprocessImage()`: `grayscale()` + `normalize()` (contrast stretch; deliberately NO hard threshold — Tesseract binarizes internally) + 2× upscale for small images (longest side <1500px). Best-effort, falls back to raw input. Wired into `ocrImage`; PDF path gets grayscale+normalize inside `PDFSharp.pageToBuffer`.

**Confidence noise-gate added 2026-06-14 (real fix for OCR artefacts on photos).** Problem found live: a text-less portrait photo produced ~1,200 words of Tesseract glyph garbage ("PEER EEE HEE EE Spey 11 ¢…") that got embedded — the old `looksLikeText` char-heuristic in `asImage.js` let it through (fake uppercase runs satisfy "3+ four-letter words" + high letter-ratio). Replaced with Tesseract's own **mean per-word confidence** — measured cleanly separates noise from text: text-less photos score **~28-40**, genuine text **~85-95 even when blurred**. Changes: `ocrImage()` now uses default `recognize()` output (so `data.confidence` is populated; dropped the `"text"`-only restriction) and **returns `{text, confidence, reliable}`** (was a bare string; only caller is `asImage`). Gate `OCR_MIN_CONFIDENCE` default **50**, clamped [0,100], 0 disables (`parseConfidence()`); knob in `collector/.env`, `start-stack.sh`, and packaged `main.js` `packagedEngineEnv`. `asImage` drops unreliable OCR **only when a caption exists** — with no caption it keeps low-conf OCR (never-drop guarantee, [[k-base-image-analyser]]). Removed the `looksLikeText` heuristic entirely. **Verified live:** re-ingested the offending photo → pageContent went 1264 words → 41 (caption only); collector logs `dropped-as-noise@28`.

**Honest verification limit:** confirmed it loads, clamps correctly, and is **non-destructive** (synthetic faded+blur scan: 47/47 chars identical raw vs preprocessed). Could NOT show a quantitative accuracy *gain* — modern Tesseract LSTM reads crisp synthetic text fine, and real failures (scanner noise/skew/paper/JPEG) can't be synthesized. Payoff needs **real scanned docs** to measure — `tooling/test-docs/` has none (PNGs are text-less shape graphics; `test-curriculum.pdf` OCRs to nothing). Same "needs real-world test data" gap as the CPU-perf and citation-render items.

**Deferred (post-build-1):** UI OCR **language** picker. **Build 1 is English-only (decided 2026-06-13)** — parked, NOT unfinished scope. Default is already `eng`, so English-only needs zero work. When wanted it's UI-only plumbing in `amadocs-ui/index.html`; engine already honors `TARGET_OCR_LANG` → `ocr.langList` → `OCRLoader` end-to-end. Next v2 item: [[k-base-folder-index]] (AI Finder).
