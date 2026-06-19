---
name: k-base-platform-focus
description: AMAdocs pivoting to Arch/Linux-first for now; Windows/macOS builds deprioritized (not abandoned)
metadata: 
  node_type: memory
  type: project
  originSessionId: 79479a8b-9f1f-4524-a796-349c610c68d4
---

**Decided 2026-06-14: focus AMAdocs on Arch/Linux for now.** The shippable target is the Linux
**AppImage** (already BUILT + verified, see [[k-base-packaging]]); the **Windows `.exe` / macOS
`.dmg` builds are deprioritized**, not abandoned — they still need those OSes or CI runners and
aren't the current priority.

**Why:** the dev box is Arch (ML4W Hyprland), the AppImage works end-to-end, and staying single-
platform removes the cross-platform tax while iterating on features. **How to apply:** when
weighing work, prefer Linux paths; Linux-only integrations are now fair game (e.g. the Nautilus
right-click summary follow-up in [[k-base-doc-summary]] — previously caveated as "GNOME-only,
outside the cross-platform story"; that caveat matters less under a Linux-first focus). Don't spend
effort on Windows/macOS-specific packaging until the focus widens again. Native modules are prebuilt
N-API so this is a packaging/QA scope call, not a code-portability one.
