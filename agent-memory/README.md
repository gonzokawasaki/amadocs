# Agent memory (Claude Code persistent memory)

This folder is a **snapshot of Claude Code's persistent memory** for this project, captured on the
original (Arch) machine on 2026-06-18. It is the distilled decision log — the *why* behind choices,
rejected alternatives, and cross-links (`[[name]]`) the project docs refer to. `MEMORY.md` is the
index (one line per memory); each `k-base-*.md` / `tinysparql-integration.md` is one fact/topic.

These files are **reference reading** for any human or agent picking up the project. They are NOT
loaded automatically just by sitting here.

## To make Claude Code auto-load this memory on the new machine

Claude Code reads memory from a path derived from the **project's absolute path**, with `/` → `-`:

```
~/.claude/projects/<slug>/memory/
```
where `<slug>` is the project's absolute path with slashes replaced by hyphens.
Example: `/mnt/space/k-base` → `-mnt-space-k-base`; `/home/you/amadocs` → `-home-you-amadocs`.

Copy this folder's contents there (adjust `<slug>` to wherever the repo now lives):

```bash
SLUG="$(pwd | sed 's#/#-#g')"            # run from the repo root
mkdir -p ~/.claude/projects/"$SLUG"/memory
cp -a agent-memory/*.md ~/.claude/projects/"$SLUG"/memory/
```

After that, new Claude Code sessions in this repo will surface these memories as context.
(If unsure of the exact convention on your Claude Code version, just read these files directly —
they're plain markdown.)
