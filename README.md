# AMAdocs

**Ask your documents anything** — a private, local AI assistant for your files.

AMAdocs is a single desktop app (Windows / macOS / Linux) for **non-technical people**.
Drop in your documents — PDF, Word, Excel, PowerPoint, scanned pages, images, and more —
and ask questions about them in plain language. A local AI reads your files and answers,
with sources. **Everything stays on your computer. Nothing is uploaded.**

Think *"Obsidian, but it reads your files and you can talk to them"* — with none of the setup.

---

## What it is trying to do

The space is crowded (AnythingLLM, GPT4All, Jan, Khoj). provide a local solution for AI document search and indexing.
**grounded visual citation loop**: click a citation → jump to the actual page of the
actual document and see the cited passage highlighted. And hopefully essy configuration options — the
user never sees the words "model," "embedder," or "vector database."

Currently tsted on a Asus i5 with 16 GB ram and a GTX1650ti.

## Status

🚧 Early development. The engine works end-to-end, fully offline. README first — more to follow.

## Built on

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (MIT) — RAG engine
- [Ollama](https://github.com/ollama/ollama) (MIT) — local LLM runtime
- [Electron](https://www.electronjs.org/) (MIT) — desktop shell
- Local embedder & OCR (Apache-2.0)

## License

MIT (planned) — see forthcoming `LICENSE` and `THIRD_PARTY_LICENSES`.
