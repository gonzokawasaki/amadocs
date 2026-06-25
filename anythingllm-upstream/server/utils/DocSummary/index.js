// AMAdocs: generate a short, factual "catalog card" summary of a document using the
// LOCAL chat model (via Ollama). Server-side twin of collector/utils/DocSummary —
// used for the ON-DEMAND "Summarize" action (right-click in the app), where we have
// the workspace and so can use the exact chat model the user picked. (The collector
// copy is for the opt-in auto-summarise-at-ingest path.)
//
// It summarises only the FIRST few pages (a few thousand tokens), not a whole book,
// and hard-caps output at ~120 words (num_predict) to match AMAdocs' search-tool
// answer standard. Best-effort: returns null on any failure, never throws.
class DocSummary {
  static MAX_CHARS = 8000; // ~2000 tokens of input
  static MAX_PAGES = 5;
  static NUM_PREDICT = 300; // ~120-word paragraph + a trailing "Keywords:" line

  /**
   * @param {Object} options
   * @param {string} options.model - Ollama chat model tag (e.g. the workspace chatModel).
   * @param {string} options.basePath - Override for the Ollama base URL.
   */
  constructor({ model = null, basePath = null } = {}) {
    this.model =
      model ||
      process.env.SUMMARY_MODEL_PREF ||
      process.env.OLLAMA_MODEL_PREF ||
      "phi3.5";
    this.basePath = DocSummary.resolveOllamaBasePath(basePath);
  }

  static resolveOllamaBasePath(override = null) {
    const raw =
      override ||
      process.env.OLLAMA_BASE_PATH ||
      process.env.OLLAMA_HOST ||
      "127.0.0.1:11434";
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, "");
  }

  log(text, ...args) {
    console.log(`\x1b[36m[DocSummary]\x1b[0m ${text}`, ...args);
  }

  /**
   * First MAX_PAGES pages when per-page ranges are known (PDF), else first MAX_CHARS
   * chars. Always hard-capped at MAX_CHARS.
   * @param {string} content
   * @param {Array<{page:number,start:number,end:number}>} [pages]
   * @returns {string}
   */
  static leadingSlice(content = "", pages = null) {
    let text = content || "";
    if (Array.isArray(pages) && pages.length > DocSummary.MAX_PAGES) {
      const cut = pages[DocSummary.MAX_PAGES - 1]?.end;
      if (Number.isFinite(cut)) text = text.slice(0, cut);
    }
    return text.slice(0, DocSummary.MAX_CHARS).trim();
  }

  /**
   * Trim a generated summary to the last complete sentence so a token-level cut
   * never dangles. Mirrors the UI's capAnswer.
   * @param {string} text
   * @returns {string}
   */
  static trimToSentence(text = "") {
    const trimmed = text.trim();
    const lastEnd = Math.max(
      trimmed.lastIndexOf("."),
      trimmed.lastIndexOf("!"),
      trimmed.lastIndexOf("?")
    );
    if (lastEnd > 40) return trimmed.slice(0, lastEnd + 1).trim();
    return trimmed;
  }

  /**
   * Post-process a raw generation into the stored summary. The model returns a prose
   * paragraph followed by a final "Keywords: a, b, c" line of exact searchable terms
   * (names, dates, codes, technical terms) — that line is what gives breadth search
   * rare-term recall, so it must survive. We split it off FIRST, trim only the prose
   * to a whole sentence (trimToSentence cuts at the last . ! ? — which lives in the
   * paragraph and would otherwise lop the keyword line off), then re-attach it.
   * A "Keywords: none" line is dropped.
   * @param {string} text
   * @returns {string}
   */
  static finalize(text = "") {
    const raw = (text || "").trim();
    // Find the LAST "Keywords:" marker (the line we asked for is at the end; a stray
    // "keywords:" earlier in the prose won't win).
    let splitAt = -1;
    const re = /keywords\s*:/gi;
    let m;
    while ((m = re.exec(raw)) !== null) splitAt = m.index;
    if (splitAt === -1) return DocSummary.trimToSentence(raw);

    const prose = DocSummary.trimToSentence(raw.slice(0, splitAt));
    const keywords = raw.slice(splitAt).replace(/\s+/g, " ").trim();
    if (/^keywords\s*:\s*(none\.?|n\/a\.?)?$/i.test(keywords)) return prose;
    return prose ? `${prose}\n\n${keywords}` : keywords;
  }

  /**
   * Summarise a document into a ~120-word gist. Returns the summary text, or null
   * if anything goes wrong or there's nothing worth summarising. Never throws.
   * @param {string} content - The document's extracted text.
   * @param {Object} options
   * @param {string} options.title - Filename/title, given to the model for context.
   * @param {Array} [options.pages] - Per-page char ranges (PDF) for the page cap.
   * @param {number} [options.timeoutMs] - Abort the request after this long.
   * @returns {Promise<string|null>}
   */
  async summarize(content, { title = "", pages = null, timeoutMs = 120_000 } = {}) {
    try {
      const input = DocSummary.leadingSlice(content, pages);
      if (input.length < 200) return null;

      const prompt =
        `You are cataloguing a document for a searchable file browser. Using ONLY the ` +
        `excerpt below (the document's opening), write exactly two parts.\n\n` +
        `First, a single factual paragraph of at most 120 words describing what this ` +
        `document is and what it covers: its type (e.g. report, contract, invoice, ` +
        `syllabus, novel, manual), its subject, and the main topics or sections. Do ` +
        `not add information not in the excerpt, do not speculate about later pages, ` +
        `and do not start with "This document" — lead with the subject. Plain prose, ` +
        `no headings or lists.\n\n` +
        `Then, on a new final line beginning exactly with "Keywords:", list the ` +
        `specific searchable terms that actually appear in the excerpt — proper names ` +
        `(people, organisations, places), dates and years, reference numbers or codes, ` +
        `and distinctive technical or topic terms — separated by commas. Include only ` +
        `terms present in the excerpt; write "Keywords: none" if there are none. Output ` +
        `nothing but the paragraph and the Keywords line (no other labels).\n\n` +
        `Filename: ${title || "untitled"}\n\n` +
        `--- Excerpt ---\n${input}\n--- End excerpt ---`;

      this.log(`Summarising "${title || "untitled"}" with "${this.model}"…`);
      const startTime = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(`${this.basePath}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: false,
            options: { num_predict: DocSummary.NUM_PREDICT, temperature: 0.2 },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.log(
          `Runtime returned ${res.status} for "${this.model}". ` +
            `Is the model downloaded? Continuing without a summary.`,
          detail.slice(0, 200)
        );
        return null;
      }

      const json = await res.json();
      const summary = DocSummary.finalize(json?.response || "");
      this.log(`Summarised "${title || "untitled"}"`, {
        chars: summary.length,
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      });
      return summary.length ? summary : null;
    } catch (e) {
      if (e?.name === "AbortError") this.log(`Summary timed out for "${title}".`);
      else this.log(`Summary error: ${e.message}`);
      return null;
    }
  }
}

module.exports = DocSummary;
