# AMAdocs

**A private, local AI file browser.**

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
- **Zero cloud.** GPU recommended; everything runs on-device.

## Status

🚧 Early development, GNOME (Linux) first. The engine works end-to-end, fully offline.
Aimed at technical early adopters for now; non-technical zero-config users are the destination.

## Built on

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (MIT) — RAG engine
- [Ollama](https://github.com/ollama/ollama) (MIT) — local LLM runtime (default model: granite4.1:3b)
- [Electron](https://www.electronjs.org/) (MIT) — desktop shell
- GNOME LocalSearch / TinySPARQL — the filesystem crawler AMAdocs rides on
- Local embedder & OCR (Apache-2.0)

## License

MIT (planned) — see forthcoming `LICENSE` and `THIRD_PARTY_LICENSES`.
