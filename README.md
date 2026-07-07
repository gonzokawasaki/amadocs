# AMAdocs

**A GNOME-based, Openrouter AI file browser for your hard drive — ask your documents anything.**

> Naming note: AMAdocs was briefly rebranded **Coracle** in mid-2026, then reverted —
> the name collided with existing projects, and *AMAdocs* says what the app is.
> The v0.1.0 release artifacts still carry the Coracle name; internal `amadocs-*`
> identifiers in code, paths and env vars were never changed.

AMAdocs is a desktop file manager that already understands what's inside your files.
Browse your documents like you would in Finder or Nautilus — PDFs, Word, Excel, PowerPoint,
text, scanned pages, images — and ask questions about them in plain language. A local AI
answers, and shows you the exact page it took the answer from. **Everything stays on your
computer. Nothing is uploaded.**

Think *"Obsidian, but it's your real filesystem and you can talk to it"* — with none of the setup.

---

## How it works

AMAdocs is a three-panel file browser:

- **Left — file tree.** Your real filesystem. Click a file to preview it; click a folder to
  scope the AI to that folder.
- **Middle — content.** A folder view (grid/list) or a tabbed file preview (PDF, image, text).
- **Right — AI panel.** A summary of the selected file plus a chat scoped to your selection.
  Answers come with **clickable citations** that jump to the exact page and highlight the passage.

The heavy lifting of reading the disk is done by the OS. On GNOME, **LocalSearch** already
crawls and extracts the full text of your files continuously, idle-aware, for free. AMAdocs
rides on that index — it adds embeddings, AI summaries, and the grounded answer/citation loop
on top. Files are never modified; all AI data lives in a separate local database.

## What makes it different

- **Grounded visual citations.** Click a citation → open the actual page of the actual
  document → see the cited passage highlighted. No other local tool does this well.
- **The OS does the crawling.** No melting your laptop indexing the whole disk — AMAdocs
  reads what the desktop indexer already extracted.
- **Responsible by design.** A safe, serial indexing queue with cool-downs, durable resume,
  and a hard global STOP button. It will never lock up your machine.
- **Two modes.** **Private local** (the default): zero cloud, GPU recommended, everything
  on-device. **Cloud** (experimental): file *reading* stays local, but embeddings, summaries,
  chat and image analysis run on frontier models over one [OpenRouter](https://openrouter.ai)
  key — dramatically better search and vision quality, indexing in minutes, no GPU needed.

## Cloud mode (experimental)

```bash
CORACLE_PROFILE=cloud OPENROUTER_API_KEY=sk-or-… ./AMAdocs-x86_64.AppImage   # or electron .
```

Defaults: chat `anthropic/claude-sonnet-4.6`, summaries + vision `google/gemini-2.5-flash`,
embeddings `baai/bge-m3` — all overridable via the usual env prefs. Ollama is **not** required
in this mode. Be aware of what it means: your documents' text and images are sent to OpenRouter
(and its underlying model providers) for processing; the search index itself stays on your
machine. Consider enabling zero-data-retention provider filtering in your OpenRouter account.
Cloud and local embeddings are incompatible (different dimensions) — index into separate
workspaces, or re-index when switching modes.

## Download

Linux x86_64 AppImage from [**Releases**](https://github.com/gonzokawasaki/amadocs/releases/latest)
(the v0.1.0 artifact predates the rename back to AMAdocs, hence the filename):

```bash
chmod +x Coracle-0.1.0-x86_64.AppImage
./Coracle-0.1.0-x86_64.AppImage
```

On first launch the app offers to download its AI models (chat: `granite4.1:3b`; optional
image/scan reading: `moondream`). App state lives under `~/.config/Coracle/` for the v0.1.0
build (`~/.config/AMAdocs/` from the next release).

## Requirements

AMAdocs currently relies on two local services:

**GNOME file indexing (LocalSearch / TinySPARQL)** — how AMAdocs finds and reads your files.
On a full **GNOME desktop** this is usually already running. **On Arch / non-GNOME setups the
packages are often installed but _not enabled_ by default** — so install if missing, then enable
and start the user service:

```bash
sudo pacman -S tinysparql localsearch                  # install if missing
systemctl --user enable --now localsearch-3.service    # not auto-enabled outside GNOME
tinysparql status                                       # verify it's indexing
```

Without a running indexer, file indexing and document search won't work.

**Ollama** — runs the local AI models (not needed in cloud mode). **Not bundled** (keeps the
download ~662 MB). AMAdocs reuses a running Ollama or starts your installed copy; if it can't
find one, it shows an "Install Ollama" screen.

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
- GNOME LocalSearch / TinySPARQL — the filesystem crawler AMAdocs rides on
- Local embedder & OCR (Apache-2.0)

## License

MIT — see [`LICENSE`](LICENSE) and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
