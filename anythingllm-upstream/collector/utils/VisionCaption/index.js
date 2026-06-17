const fs = require("fs");
const path = require("path");

// AMAdocs: turn an image into a text description using a LOCAL vision model
// (via Ollama), so photos/whiteboards/receipts/screenshots with no clean text
// layer become searchable by their *content*, not just OCR'd glyphs. The output
// is plain text, so it flows through the existing embed→retrieve→cite pipeline
// with zero changes downstream. Everything stays on-device.
class VisionCaption {
  // Image types we will attempt to caption. Anything else is left to OCR alone.
  static SUPPORTED = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
  ]);

  /**
   * @param {Object} options
   * @param {string} options.model - The Ollama vision model tag (e.g. "moondream").
   * @param {string} options.basePath - Override for the Ollama base URL.
   */
  constructor({ model = null, basePath = null } = {}) {
    this.model = model || process.env.VISION_MODEL_PREF || "moondream";
    this.basePath = VisionCaption.resolveOllamaBasePath(basePath);
  }

  /**
   * Resolve the Ollama URL from (in order): an explicit override, OLLAMA_BASE_PATH,
   * OLLAMA_HOST (host[:port], no scheme), then the local default. This keeps the
   * collector working both in the dev stack and in the packaged Electron app
   * where the server gets OLLAMA_BASE_PATH but the collector only sees OLLAMA_HOST.
   * @param {string|null} override
   * @returns {string}
   */
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
    console.log(`\x1b[35m[VisionCaption]\x1b[0m ${text}`, ...args);
  }

  /**
   * Whether captioning is possible for a given file. Cheap, no network.
   * @param {string} filePath
   * @returns {boolean}
   */
  canCaption(filePath) {
    return VisionCaption.SUPPORTED.has(path.extname(filePath).toLowerCase());
  }

  /**
   * Describe an image with the local vision model.
   * Returns the caption text, or null if anything goes wrong (no model pulled,
   * runtime down, timeout, unreadable file). Captioning is best-effort: a failure
   * must never break ingestion — the caller falls back to OCR-only content.
   * @param {string} filePath
   * @param {Object} options
   * @param {string} options.prompt - The instruction given to the vision model.
   * @param {number} options.timeoutMs - Abort the request after this long.
   * @returns {Promise<string|null>}
   */
  async caption(
    filePath,
    {
      prompt = "Describe this image in detail. Include any visible text exactly as written, plus the objects, people, charts, layout, and overall context. Be thorough and factual; do not guess about things you cannot see.",
      timeoutMs = 180_000,
    } = {}
  ) {
    try {
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        this.log(`File ${filePath} does not exist. Skipping caption.`);
        return null;
      }
      if (!this.canCaption(filePath)) return null;

      const documentTitle = path.basename(filePath);
      this.log(`Captioning ${documentTitle} with "${this.model}"…`);
      const startTime = Date.now();
      const imageB64 = fs.readFileSync(filePath).toString("base64");

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
            images: [imageB64],
            stream: false,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        // 404 here almost always means the vision model isn't pulled yet.
        const detail = await res.text().catch(() => "");
        this.log(
          `Runtime returned ${res.status} for "${this.model}". ` +
            `Is the model downloaded? Continuing without a caption.`,
          detail.slice(0, 200)
        );
        return null;
      }

      const json = await res.json();
      const caption = (json?.response || "").trim();
      this.log(
        `Captioned ${documentTitle}`,
        {
          chars: caption.length,
          executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        }
      );
      return caption.length ? caption : null;
    } catch (e) {
      if (e?.name === "AbortError") {
        this.log(`Caption timed out for ${path.basename(filePath)}.`);
      } else {
        this.log(`Caption error: ${e.message}`);
      }
      return null;
    }
  }
}

module.exports = VisionCaption;
