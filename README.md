# AMAdocs

**Ask your documents anything** — a private, local AI assistant for your files.

AMAdocs is a single desktop app (Windows / macOS / Linux) for **non-technical people**.
Drop in your documents — PDF, Word, Excel, PowerPoint, scanned pages, images, and more —
and ask questions about them in plain language. A local AI reads your files and answers,
with sources. **Everything stays on your computer. Nothing is uploaded.**

Think *"Obsidian, but it reads your files and you can talk to them"* — with none of the setup.

---

## Why it's different

The space is crowded (AnythingLLM, GPT4All, Jan, Khoj). What's rare is the
**grounded visual citation loop**: click a citation → jump to the actual page of the
actual document and see the cited passage highlighted. And **zero configuration** — the
user never sees the words "model," "embedder," or "vector database."

## Status

🚧 Early development. The engine works end-to-end, fully offline. README first — more to follow.

## Built on

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (MIT) — RAG engine
- [Ollama](https://github.com/ollama/ollama) (MIT) — local LLM runtime
- [Electron](https://www.electronjs.org/) (MIT) — desktop shell
- Local embedder & OCR (Apache-2.0)

## License

MIT (planned) — see forthcoming `LICENSE` and `THIRD_PARTY_LICENSES`.
