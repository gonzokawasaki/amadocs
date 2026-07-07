# AMAdocs

**A GNOME-based AI file browser for your hard drive — ask your documents anything, powered by frontier models over [OpenRouter](https://openrouter.ai).**

> Naming note: AMAdocs was briefly rebranded **Coracle** in mid-2026, then reverted —
> the name collided with existing projects, and *AMAdocs* says what the app is.
> The v0.1.0 release artifacts still carry the Coracle name; internal `amadocs-*`
> identifiers in code, paths and env vars were never changed.

AMAdocs is a desktop file manager that already understands what's inside your files.
Browse your documents like you would in Finder or Nautilus — PDFs, Word, Excel, PowerPoint,
text, scanned pages, images — and ask questions about them in plain language. Frontier AI
models answer, and show you the exact page the answer came from.

Think *"Obsidian, but it's your real filesystem and you can talk to it"* — with none of the setup.

---

## How it works

AMAdocs is a three-panel file browser:

- **Left — file tree.** Your real filesystem. Click a file to preview it; click a folder to
  scope the AI to that folder.
- **Middle — content.** A folder view (grid/list) or a tabbed file preview (PDF, image, text).
- **Right — AI panel.** A summary of the selected file plus a chat scoped to your selection.
  Answers come with **clickable citations** that jump to the exact page and highlight the passage.

Reading the disk is done by the OS. On GNOME, **LocalSearch** already crawls and extracts the
full text of your files continuously, idle-aware, for free. AMAdocs rides on that index and
sends the extracted text and images to OpenRouter to build embeddings, AI summaries, and the
grounded answer/citation loop. The resulting search index lives in a local database; your files
themselves are never modified.

### What gets sent where

AMAdocs is **cloud-powered search**. To process your documents it uploads their extracted
**text, your queries, and images** (including scanned pages for OCR/vision) to OpenRouter and
its underlying model providers. Your original files are not uploaded as files, and the search
index stays on your machine — but the document *content* does leave your computer. If that
matters to you, enable zero-data-retention provider filtering in your OpenRouter account.

## What makes it different

- **Grounded visual citations.** Click a citation → open the actual page of the actual
  document → see the cited passage highlighted. No other local tool does this well.
- **The OS does the crawling.** No melting your laptop indexing the whole disk — AMAdocs
  reads what the desktop indexer already extracted.
- **Frontier quality, no GPU.** Embeddings, summaries, chat and image analysis run on frontier
  models over a single OpenRouter key — far better search and vision quality, indexing in
  minutes, no local GPU and no model downloads.
- **Responsible by design.** A safe, serial indexing queue with cool-downs, durable resume,
  a hard global STOP button, and an explicit opt-in before anything is uploaded. It will never
  lock up your machine.

## Setup

AMAdocs runs on a single [OpenRouter](https://openrouter.ai) API key:

```bash
OPENROUTER_API_KEY=sk-or-… ./AMAdocs-x86_64.AppImage   # or: electron .
```

The key can also live at `~/.config/amadocs/openrouter.key`. Without a key the app cannot
index or answer — it will prompt you for one.

Defaults: chat `anthropic/claude-sonnet-4.6`, summaries + vision `google/gemini-2.5-flash`,
embeddings `baai/bge-m3` — all overridable via the usual env prefs. Typical cost is around
$0.0006 per document, and indexing is ~15–30× faster than a local GPU.

## Download

Linux x86_64 AppImage from [**Releases**](https://github.com/gonzokawasaki/amadocs/releases/latest)
(the v0.1.0 artifact predates the rename back to AMAdocs, hence the filename):

```bash
chmod +x Coracle-0.1.0-x86_64.AppImage
./Coracle-0.1.0-x86_64.AppImage
```

App state lives under `~/.config/Coracle/` for the v0.1.0 build (`~/.config/AMAdocs/` from
the next release).

## Requirements

**An OpenRouter API key** — AMAdocs sends document text and images to OpenRouter for
embeddings, summaries, chat and vision. Get one at [openrouter.ai](https://openrouter.ai).

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

No local GPU, no Ollama, and no local model downloads are required.

## Status

🚧 Early development, GNOME (Linux) first. The engine works end-to-end. Aimed at technical
Linux users who like to tweak their tools — every setting, the prompts, and the CSS are
exposed for customisation. (Zero-config-for-non-technical-users is no longer a goal.)

## Built on

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (MIT) — RAG engine
- [OpenRouter](https://openrouter.ai) — frontier model access (chat, embeddings, vision)
- [Electron](https://www.electronjs.org/) (MIT) — desktop shell
- GNOME LocalSearch / TinySPARQL — the filesystem crawler AMAdocs rides on
- Tesseract OCR (Apache-2.0)

## License

MIT — see [`LICENSE`](LICENSE) and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
