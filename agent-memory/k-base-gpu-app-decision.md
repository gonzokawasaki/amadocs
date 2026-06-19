---
name: k-base-gpu-app-decision
description: AMAdocs is a GPU app — dropped all CPU-only performance claims; no CPU benchmarking/targeting
metadata: 
  node_type: memory
  type: project
  originSessionId: e6c7552f-ebfd-4d3d-9592-9655e14fbb8a
---

Decided 2026-06-14: **AMAdocs is positioned as a GPU app.** A discrete GPU is recommended;
we make **no CPU-only performance claim** and don't market to no-dGPU laptops. It still *runs*
on CPU via Ollama's fallback — we just don't advertise, target, or benchmark that as a
supported experience. All published perf numbers (~1 s warm) are GPU-based (GTX 1650 Ti).

**Why:** we can't stand behind a CPU number we never measured, and CPU-only perf was unproven.
Rather than chase/measure it, we cut the claim.

**How to apply:** this **reverses** the prior project stance that "CPU-only performance is the
single biggest unknown / the market" (was Risk 1 + next-move #2 in the Fable notes). Those
action items are now **dropped, not open**. Docs updated: README implicitly, [[k-base-product-direction]]
copy in K-base.md (GPU recommended), AMAdocs-FABLE-RECOMMENDATIONS.md (Risk 1 resolved-by-decision),
AMAdocs-DEV-NOTES.md (Performance section + AI Finder rationale). Don't re-raise "measure CPU."
See [[k-base-dev-environment]] for the GPU perf numbers.
