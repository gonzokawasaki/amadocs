---
name: k-base-github-staging
description: Staged plan for publishing AMAdocs to GitHub (gonzokawasaki/amadocs); doing it right in stages
metadata: 
  node_type: memory
  type: project
  originSessionId: 6469f475-bbef-41f4-8635-6477fb6355dc
---

Publishing AMAdocs to **github.com/gonzokawasaki/amadocs** deliberately **in stages** (user wants to "do this right"), each stage = one reviewable commit. Push auth is **SSH** (key authenticates as gonzokawasaki; HTTPS had no creds — remote `origin` set to `git@github.com:gonzokawasaki/amadocs.git`). Repo lives at the non-git working tree `/mnt/space/k-base` (14 GB on disk, but real source is ~tens of MB). **Never `git add .`** here — stage explicit files only; `.gitignore` excludes node_modules, ollama-models/ollama, storage/vector-cache, `.env*`, secrets.json, vendor/, dist, *.AppImage, logs.

Stages:
- **0 ✅ DONE** — `README.md` + `.gitignore` (first commit on `main`, pushed).
- **1 — Licensing foundation** — `LICENSE` (MIT) + `THIRD_PARTY_LICENSES` + upstream attribution. Do BEFORE publishing any code. On the existing todo [[k-base-project]].
- **2 — Original work** — `amadocs-desktop/` (Electron: main.js, ui/, preload, package.json) + `tooling/amadocs-ui/` (source-of-truth UI) + `start-stack.sh`.
- **3 — Docs** — K-base.md, PACKAGING.md, dev-notes, fable-notes; maybe tidy into `docs/`, trim internal-only bits.
- **4 — Engine fork** — `anythingllm-upstream/` source (no deps/storage/.env). OPEN decision saved for last: **vendor whole fork** (simple, buildable) vs **patch/submodule** (keeps the ~215-line AMAdocs diff visible).

**Security — release integrity (TODO, user-requested 2026-06-13):** publish **checksums (SHA-256) for the downloadable release files** on GitHub so users can verify the installer/AppImage hasn't been tampered with — matters doubly for a privacy/security-first product whose whole pitch is "trust it on your machine." Ship a `SHA256SUMS` file (and ideally a signature/`.asc`) alongside each GitHub Release artifact; document the verify command in the README/release notes. Belongs with the packaging/release step (see PACKAGING.md "Build"); not a source-tree concern.

Two open gating questions when resumed: (1) is the repo **public or private** (gates urgency of Stage 1); (2) Stage-4 vendor-vs-separate preference. Name is fixed AMAdocs [[k-base-naming]].

**Why:** user is publishing incrementally and cares about doing it correctly; this preserves the agreed order and the SSH/never-add-all gotchas.
**How to apply:** resume at Stage 1 (licensing) once public/private is known; keep each stage a single explicit-file commit.
