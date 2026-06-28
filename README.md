# Coracle

**A private, local AI file browser.**

> Coracle was originally developed under the name **AMAdocs**. You'll still see
> `amadocs-*` in code, file paths, env vars, and config — those internal names are
> unchanged; only the product/brand name has moved to Coracle.

Coracle is a desktop file manager that already understands what's inside your files.
Browse your documents like you would in Finder or Nautilus — PDFs, Word, Excel, PowerPoint,
text, scanned pages, images — and ask questions about them in plain language. A local AI
answers, and shows you the exact page it took the answer from. **Everything stays on your
computer. Nothing is uploaded.**

Think *"Obsidian, but it's your real filesystem and you can talk to it"* — with none of the setup.

---

## How it works

Coracle is a three-panel file browser:

- **Left — file tree.** Your real filesystem. Click a file to preview it; click a folder to
  scope the AI to that folder.
- **Middle — content.** A folder view (grid/list) or a tabbed file preview (PDF, image, text).
- **Right — AI panel.** A summary of the selected file plus a chat scoped to your selection.
  Answers come with **clickable citations** that jump to the exact page and highlight the passage.

The heavy lifting of reading the disk is done by the OS. On GNOME, **LocalSearch** already
crawls and extracts the full text of your files continuously, idle-aware, for free. Coracle
rides on that index — it adds embeddings, AI summaries, and the grounded answer/citation loop
on top. Files are never modified; all AI data lives in a separate local database.

## What makes it different

- **Grounded visual citations.** Click a citation → open the actual page of the actual
  document → see the cited passage highlighted. No other local tool does this well.
- **The OS does the crawling.** No melting your laptop indexing the whole disk — Coracle
  reads what the desktop indexer already extracted.
- **Responsible by design.** A safe, serial indexing queue with cool-downs, durable resume,
  and a hard global STOP button. It will never lock up your machine.
- **Zero cloud.** GPU recommended; everything runs on-device.

## Download

Linux x86_64 AppImage from [**Releases**](https://github.com/gonzokawasaki/coracle/releases/latest):

```bash
chmod +x Coracle-0.1.0-x86_64.AppImage
./Coracle-0.1.0-x86_64.AppImage
```

On first launch Coracle offers to download its AI models (chat: `granite4.1:3b`; optional
image/scan reading: `moondream`). All app state lives under `~/.config/Coracle/`.

## Requirements

Coracle currently relies on two local services:

**GNOME file indexing (LocalSearch / TinySPARQL)** — how Coracle finds and reads your files.
On a full **GNOME desktop** this is usually already running. **On Arch / non-GNOME setups the
packages are often installed but _not enabled_ by default** — so install if missing, then enable
and start the user service:

```bash
sudo pacman -S tinysparql localsearch                  # install if missing
systemctl --user enable --now localsearch-3.service    # not auto-enabled outside GNOME
tinysparql status                                       # verify it's indexing
```

Without a running indexer, file indexing and document search won't work.

**Ollama** — runs the local AI models. **Not bundled** (keeps the download ~662 MB). Coracle
reuses a running Ollama or starts your installed copy; if it can't find one, it shows an
"Install Ollama" screen.

```bash
sudo pacman -S ollama                          # Arch / Manjaro
curl -fsSL https://ollama.com/install.sh | sh  # other Linux
```

## Status

🚧 Early development, GNOME (Linux) first. The engine works end-to-end, fully offline.
Aimed at technical Linux users who like to tweak their tools — every setting, the prompts, and
the CSS are exposed for customisation. (Zero-config-for-non-technical-users is no longer a goal.)

## Built on

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (MIT) — RAG engine
- [Ollama](https://github.com/ollama/ollama) (MIT) — local LLM runtime (default model: granite4.1:3b)
- [Electron](https://www.electronjs.org/) (MIT) — desktop shell
- GNOME LocalSearch / TinySPARQL — the filesystem crawler Coracle rides on
- Local embedder & OCR (Apache-2.0)

## License

MIT — see [`LICENSE`](LICENSE) and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
