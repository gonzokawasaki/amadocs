---
name: k-base-folder-index
description: AI Finder (v2
metadata: 
  node_type: memory
  type: project
  originSessionId: ddb0585f-84a8-4f1d-b704-d461b66f9602
---

v2 feature #3 = **AI Finder: "add a folder" → one-shot index every file into a collection**, with progress. Whole-drive OUT (OS territory), no live watcher. Design settled 2026-06-13, **not built**. See [[k-base-companion-apps]].

**PARKED — likely a SEPARATE PROJECT, dropped from the AMAdocs roadmap (decided 2026-06-14).** User's call: "too many pitfalls." The lock-up/perf risk, the OOM crash vectors, the idle-aware/durable-queue machinery, and the entanglement with the unmeasured CPU-perf unknown add up to a different problem shape than AMAdocs' focused drop-files-and-ask tool. Not just deferred behind build 1 — taken off this project's plan. If revisited, spin it up as its own product. The settled design below is preserved as the starting point for whenever/wherever it's resumed. Sequence now: #1 image-analyser ✅ → #2 OCR quality ✅ → **build-1 ship work** (AI Finder removed).

(Earlier framing, superseded: was "DEFERRED until after build 1 ships." Now stronger — out of scope for AMAdocs entirely.)

**Overriding principle (user, 2026-06-13): cautious and responsible — NEVER risk locking up the user's machine, even at the cost of speed.** Reasoning: for non-technical users a frozen laptop reads as "this app broke my computer," and that reputation kills a zero-config product. So folder indexing *deliberately underperforms* to stay safe. This principle likely generalizes beyond folders.

**Why:** "background = just slower" doesn't work — each vision/OCR call is an indivisible GPU/CPU burst, so spacing files only spreads the spikes; the machine still stutters. User foresaw this.

**How to apply (settled design):**
- One **safe mode in the UI, no "Fast" footgun.** Aggressive/full-speed = **config-only escape hatch** for power users (their config-as-intent stance, [[k-base-modes-direction]]) — never a UI default.
- **Strictly serial** (one file ever), **durable per-file checkpoint queue** (process→embed→commit done→next; crash re-runs only that file, idempotent via content-digest cache; survives app close).
- **Idle-aware** = the honest "background": process only when user away (`powerMonitor.getSystemIdleTime()` > ~30–60s), auto-pause on input (like Spotlight); cool-down between files.
- **Memory/VRAM guard** (the real crash vector: 3.5GB GPU + vision + chat model OOM; big PDF RAM spike) — per-file size cap, skip+report oversized.
- **Per-file watchdog** (skip hung file vs wedge run); **never blocks search** of already-indexed docs; **pause = finish current file then stop**; progress as in-chat status bubble (`addSystemMsg`, [[k-base-status-feedback]]); up-front by-type tally + warning + running ETA.
- **v1 leans copy-into-Library** (reuse the normal drop path per file), NOT in-place. Gotcha: in-place via `collectorApi.parseDocument`+absolutePath (`/parse`) bypasses originals-retention that the citation→viewer loop needs; `processDocument` (`/process`) takes no absolutePath. Copy matches the existing "AMAdocs keeps its own private copy" model; cost = disk dup.
- Packaging delta: needs the Electron folder picker (packaged-app capability). Ties to the still-open CPU-perf unknown.
