---
name: k-base-ocr-roadmap
description: "Post-build-1 priority (decided 2026-06-14) = improving OCR + text analysis; ranked, licensing-aware plan. Don't re-litigate that this is the next focus."
metadata: 
  node_type: memory
  type: project
  originSessionId: 17d2c5ed-6fb2-4cfd-8d68-2e36035da7d6
---

**Decided 2026-06-14: once AMAdocs build 1 ships, the MAIN focus is improving OCR + text analysis.** It's the core product value (reading messy real-world docs well) and where the headroom is.

**Why / framing:** per-character accuracy on *clean printed Latin text* is near-maxed — Tesseract (used via `tesseract.js`, LSTM) is at the ceiling there; tuning it won't help. Everything else is wide open: layout/tables, handwriting, degraded/photographed docs, reading order, math/formulas, non-Latin.

**How to apply — ranked axes (effort-vs-payoff for non-technical users dumping real-world docs/photos; keep the MIT/Apache-only stance):**
1. **More preprocessing** (lowest-risk, biggest real-world win, stays light): deskew, dewarp (curved pages), perspective-crop/document-detection, adaptive binarization (Sauvola), denoise, super-resolution — OpenCV-grade, permissive. Builds on existing DPI/grayscale/normalize/upscale + confidence noise-gate ([[k-base-ocr-quality]]).
2. **Deep-learning OCR via ONNX** (we already run onnxruntime): PaddleOCR (Apache-2.0, PP-Structure for tables) → ONNX (RapidOCR/OnnxOCR), or docTR/EasyOCR (Apache-2.0). Watch **Surya**'s license (more restrictive/revenue-gated).
3. **VLM-as-deep-OCR** for worst cases (handwriting, tables→markdown, formulas→LaTeX): we already bundle a VLM path ([[k-base-image-analyser]], moondream); a doc-OCR-tuned small VLM as an **opt-in "deep read"** — NOT default (collides with 8GB/zero-config/GPU-app constraints).
4. **Structured extraction** (tables/forms) — high value for the records/invoices use case.

**Standing tension:** accuracy vs footprint/simplicity — Tesseract's appeal is tiny+CPU-fine+Apache+no-GPU; default stays light, heavy options are opt-in/config escape-hatch ([[k-base-modes-direction]]). "Text analysis" also = retrieval side ([[k-base-retrieval-tuning]]: hybrid/keyword search still absent, stronger embedder = config swap). Full plan in repo `AMAdocs-DEV-NOTES.md` → "Post-build-1 priority".
