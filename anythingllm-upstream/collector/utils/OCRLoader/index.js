const fs = require("fs");
const os = require("os");
const path = require("path");
const { VALID_LANGUAGE_CODES } = require("./validLangs");

class OCRLoader {
  /**
   * The language code(s) to use for the OCR.
   * @type {string[]}
   */
  language;
  /**
   * The cache directory for the OCR.
   * @type {string}
   */
  cacheDir;

  /**
   * The constructor for the OCRLoader.
   * @param {Object} options - The options for the OCRLoader.
   * @param {string} options.targetLanguages - The target languages to use for the OCR as a comma separated string. eg: "eng,deu,..."
   */
  constructor({ targetLanguages = "eng" } = {}) {
    this.language = this.parseLanguages(targetLanguages);
    // AMAdocs: rasterization DPI for scanned-PDF OCR. Upstream hard-coded 70 (low —
    // tuned for speed/memory); we raise the default so small print survives, but keep
    // it env-tunable and clamped so a low-RAM machine can dial it back (or a power user
    // up) without code changes. Clamp ceiling guards against OOM on huge pages.
    this.dpi = this.parseDpi(process.env.OCR_PDF_DPI);
    // AMAdocs: minimum mean OCR confidence (0-100) for an image's text to count
    // as real. Photos/graphics with no text make Tesseract hallucinate strings
    // of stray glyphs that score very low (~25-40) where genuine text scores
    // ~85-95 — even when blurred. Below this we treat the image as text-less so
    // the noise never gets embedded or shown. Env-tunable + clamped.
    this.minConfidence = this.parseConfidence(process.env.OCR_MIN_CONFIDENCE);
    this.cacheDir = path.resolve(
      process.env.STORAGE_DIR
        ? path.resolve(process.env.STORAGE_DIR, `models`, `tesseract`)
        : path.resolve(__dirname, `../../../server/storage/models/tesseract`)
    );

    // Ensure the cache directory exists or else Tesseract will persist the cache in the default location.
    if (!fs.existsSync(this.cacheDir))
      fs.mkdirSync(this.cacheDir, { recursive: true });
    this.log(
      `OCRLoader initialized with language support for:`,
      this.language.map((lang) => VALID_LANGUAGE_CODES[lang]).join(", ")
    );
  }

  /**
   * Parses the language code from a provided comma separated string of language codes.
   * @param {string} language - The language code to parse.
   * @returns {string[]} The parsed language code.
   */
  /**
   * AMAdocs: parse + clamp the scanned-PDF rasterization DPI from env.
   * Defaults to 150 (2x the old 72-relative baseline) and is clamped to [72, 300]:
   * below 72 loses detail, above 300 mostly bloats memory/time without OCR gains.
   * @param {string} value - The raw OCR_PDF_DPI env value.
   * @returns {number} The clamped DPI.
   */
  parseDpi(value = null) {
    const dpi = parseInt(value, 10);
    if (!Number.isFinite(dpi)) return 150;
    return Math.min(300, Math.max(72, dpi));
  }

  /**
   * AMAdocs: parse + clamp the minimum mean-OCR-confidence gate from env.
   * Defaults to 50 (well clear of the ~28-40 that text-less photos score and the
   * ~85-95 of real text) and is clamped to [0, 100]. Set to 0 to disable the gate.
   * @param {string} value - The raw OCR_MIN_CONFIDENCE env value.
   * @returns {number} The clamped confidence threshold.
   */
  parseConfidence(value = null) {
    const c = parseInt(value, 10);
    if (!Number.isFinite(c)) return 50;
    return Math.min(100, Math.max(0, c));
  }

  /**
   * AMAdocs: preprocess an image buffer/path for OCR — grayscale + contrast
   * normalize, which reliably lifts Tesseract accuracy on photos/faded scans
   * (Tesseract binarizes internally, so we stop short of hard thresholding).
   * Small images are gently upscaled so glyphs are big enough to recognize.
   * Best-effort: any failure returns the original input so OCR still runs.
   * @param {string|Buffer} input - The image file path or raw buffer.
   * @returns {Promise<string|Buffer>} A preprocessed PNG buffer, or the input on failure.
   */
  async preprocessImage(input) {
    try {
      const sharp = (await import("sharp")).default;
      let pipeline = sharp(input).grayscale().normalize();
      const meta = await sharp(input).metadata();
      const longest = Math.max(meta.width || 0, meta.height || 0);
      // Upscale small images (≈ low-DPI scans / thumbnails) so text is legible to OCR.
      if (longest > 0 && longest < 1500)
        pipeline = pipeline.resize({
          width: Math.round((meta.width || 0) * 2),
          height: Math.round((meta.height || 0) * 2),
          fit: "fill",
        });
      return await pipeline.png().toBuffer();
    } catch (e) {
      this.log(`Image preprocessing skipped: ${e.message}`);
      return input;
    }
  }

  parseLanguages(language = null) {
    try {
      if (!language || typeof language !== "string") return ["eng"];
      const langList = language
        .split(",")
        .map((lang) => (lang.trim() !== "" ? lang.trim() : null))
        .filter(Boolean)
        .filter((lang) => VALID_LANGUAGE_CODES.hasOwnProperty(lang));
      if (langList.length === 0) return ["eng"];
      return langList;
    } catch (e) {
      this.log(`Error parsing languages: ${e.message}`, e.stack);
      return ["eng"];
    }
  }

  log(text, ...args) {
    console.log(`\x1b[36m[OCRLoader]\x1b[0m ${text}`, ...args);
  }

  /**
   * Loads a PDF file and returns an array of documents.
   * This function is reserved to parsing for SCANNED documents - digital documents are not supported in this function
   * @returns {Promise<{pageContent: string, metadata: object}[]>} An array of documents with page content and metadata.
   */
  async ocrPDF(
    filePath,
    { maxExecutionTime = 300_000, batchSize = 10, maxWorkers = null } = {}
  ) {
    if (
      !filePath ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
      this.log(`File ${filePath} does not exist. Skipping OCR.`);
      return [];
    }

    const documentTitle = path.basename(filePath);
    this.log(`Starting OCR of ${documentTitle}`);
    const pdfjs = await import("pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js");
    let buffer = fs.readFileSync(filePath);

    const pdfDocument = await pdfjs.getDocument({ data: buffer });

    const documents = [];
    const meta = await pdfDocument.getMetadata().catch(() => null);
    const metadata = {
      source: filePath,
      pdf: {
        version: "v2.0.550",
        info: meta?.info,
        metadata: meta?.metadata,
        totalPages: pdfDocument.numPages,
      },
    };

    const pdfSharp = new PDFSharp({
      dpi: this.dpi, // AMAdocs: env-tunable rasterization DPI (default 150)
      validOps: [
        pdfjs.OPS.paintJpegXObject,
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
      ],
    });
    await pdfSharp.init();

    const { createWorker, OEM } = require("tesseract.js");
    const BATCH_SIZE = batchSize;
    const MAX_EXECUTION_TIME = maxExecutionTime;
    const NUM_WORKERS = maxWorkers ?? Math.min(os.cpus().length, 4);
    const totalPages = pdfDocument.numPages;
    const workerPool = await Promise.all(
      Array(NUM_WORKERS)
        .fill(0)
        .map(() =>
          createWorker(this.language, OEM.LSTM_ONLY, {
            cachePath: this.cacheDir,
          })
        )
    );

    const startTime = Date.now();
    try {
      this.log("Bootstrapping OCR completed successfully!", {
        MAX_EXECUTION_TIME_MS: MAX_EXECUTION_TIME,
        BATCH_SIZE,
        MAX_CONCURRENT_WORKERS: NUM_WORKERS,
        TOTAL_PAGES: totalPages,
      });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `OCR job took too long to complete (${
                MAX_EXECUTION_TIME / 1000
              } seconds)`
            )
          );
        }, MAX_EXECUTION_TIME);
      });

      const processPages = async () => {
        for (
          let startPage = 1;
          startPage <= totalPages;
          startPage += BATCH_SIZE
        ) {
          const endPage = Math.min(startPage + BATCH_SIZE - 1, totalPages);
          const pageNumbers = Array.from(
            { length: endPage - startPage + 1 },
            (_, i) => startPage + i
          );
          this.log(`Working on pages ${startPage} - ${endPage}`);

          const pageQueue = [...pageNumbers];
          const results = [];
          const workerPromises = workerPool.map(async (worker, workerIndex) => {
            while (pageQueue.length > 0) {
              const pageNum = pageQueue.shift();
              this.log(
                `\x1b[34m[Worker ${
                  workerIndex + 1
                }]\x1b[0m assigned pg${pageNum}`
              );
              const page = await pdfDocument.getPage(pageNum);
              const imageBuffer = await pdfSharp.pageToBuffer({ page });
              if (!imageBuffer) continue;
              const { data } = await worker.recognize(imageBuffer, {}, "text");
              this.log(
                `✅ \x1b[34m[Worker ${
                  workerIndex + 1
                }]\x1b[0m completed pg${pageNum}`
              );
              results.push({
                pageContent: data.text,
                metadata: {
                  ...metadata,
                  loc: { pageNumber: pageNum },
                },
              });
            }
          });

          await Promise.all(workerPromises);
          documents.push(
            ...results.sort(
              (a, b) => a.metadata.loc.pageNumber - b.metadata.loc.pageNumber
            )
          );
        }
        return documents;
      };

      await Promise.race([timeoutPromise, processPages()]);
    } catch (e) {
      this.log(`Error: ${e.message}`, e.stack);
    } finally {
      global.Image = undefined;
      await Promise.all(workerPool.map((worker) => worker.terminate()));
    }

    this.log(`Completed OCR of ${documentTitle}!`, {
      documentsParsed: documents.length,
      totalPages: totalPages,
      executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
    });
    return documents;
  }

  /**
   * Loads an image file and returns the OCRed text plus a confidence signal.
   * AMAdocs: returns an object (was a bare string) so the caller can tell real
   * text from the low-confidence noise Tesseract emits on text-less photos.
   * @param {string} filePath - The path to the image file.
   * @param {Object} options - The options for the OCR.
   * @param {number} options.maxExecutionTime - The maximum execution time of the OCR in milliseconds.
   * @returns {Promise<{text: string|null, confidence: number, reliable: boolean}>}
   *   text: the OCRed text (null on failure); confidence: mean 0-100;
   *   reliable: confidence >= the configured minConfidence gate.
   */
  async ocrImage(filePath, { maxExecutionTime = 300_000 } = {}) {
    let content = "";
    let confidence = 0;
    let worker = null;
    if (
      !filePath ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
      this.log(`File ${filePath} does not exist. Skipping OCR.`);
      return { text: null, confidence: 0, reliable: false };
    }

    const documentTitle = path.basename(filePath);
    try {
      this.log(`Starting OCR of ${documentTitle}`);
      const startTime = Date.now();
      const { createWorker, OEM } = require("tesseract.js");
      worker = await createWorker(this.language, OEM.LSTM_ONLY, {
        cachePath: this.cacheDir,
      });

      // Race the timeout with the OCR
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `OCR job took too long to complete (${
                maxExecutionTime / 1000
              } seconds)`
            )
          );
        }, maxExecutionTime);
      });

      const processImage = async () => {
        // AMAdocs: grayscale/normalize/upscale before OCR for cleaner extraction.
        const prepared = await this.preprocessImage(filePath);
        // Default output (no "text"-only restriction) so `data.confidence` —
        // the mean per-word confidence — comes back for the noise gate below.
        const { data } = await worker.recognize(prepared);
        content = data.text;
        confidence = Number.isFinite(data.confidence) ? data.confidence : 0;
      };

      await Promise.race([timeoutPromise, processImage()]);
      const reliable = confidence >= this.minConfidence;
      this.log(`Completed OCR of ${documentTitle}!`, {
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        confidence: Math.round(confidence),
        reliable, // false => treated as a text-less image (noise discarded by caller)
      });
      if (!reliable && (content || "").trim())
        this.log(
          `OCR confidence ${Math.round(confidence)} < ${this.minConfidence} ` +
            `for ${documentTitle} — flagged as noise (text-less image).`
        );

      return { text: content, confidence, reliable };
    } catch (e) {
      this.log(`Error: ${e.message}`);
      return { text: null, confidence: 0, reliable: false };
    } finally {
      //eslint-disable-next-line
      if (!worker) return;
      await worker.terminate();
    }
  }
}

/**
 * Converts a PDF page to a buffer using Sharp.
 * @param {Object} options - The options for the Sharp PDF page object.
 * @param {Object} options.page - The PDFJS page proxy object.
 * @returns {Promise<Buffer>} The buffer of the page.
 */
class PDFSharp {
  constructor({ validOps = [], dpi = 150 } = {}) {
    this.sharp = null;
    this.validOps = validOps;
    this.dpi = dpi; // AMAdocs: rasterization DPI (was hard-coded 70)
  }

  log(text, ...args) {
    console.log(`\x1b[36m[PDFSharp]\x1b[0m ${text}`, ...args);
  }

  async init() {
    this.sharp = (await import("sharp")).default;
  }

  /**
   * Converts a PDF page to a buffer.
   * @param {Object} options - The options for the Sharp PDF page object.
   * @param {Object} options.page - The PDFJS page proxy object.
   * @returns {Promise<Buffer>} The buffer of the page.
   */
  async pageToBuffer({ page }) {
    if (!this.sharp) await this.init();
    try {
      this.log(`Converting page ${page.pageNumber} to image...`);
      const ops = await page.getOperatorList();
      const pageImages = ops.fnArray.length;

      for (let i = 0; i < pageImages; i++) {
        try {
          if (!this.validOps.includes(ops.fnArray[i])) continue;

          const name = ops.argsArray[i][0];
          const img = await page.objs.get(name);
          const { width, height } = img;
          const size = img.data.length;
          const channels = size / width / height;
          const targetDPI = this.dpi;
          const targetWidth = Math.floor(width * (targetDPI / 72));
          const targetHeight = Math.floor(height * (targetDPI / 72));

          const image = this.sharp(img.data, {
            raw: { width, height, channels },
            density: targetDPI,
          })
            .resize({
              width: targetWidth,
              height: targetHeight,
              fit: "fill",
            })
            // AMAdocs: grayscale + contrast-normalize lifts OCR accuracy on
            // faded/low-contrast scans (Tesseract binarizes internally, so we
            // stop short of a hard threshold that would wreck uneven lighting).
            .grayscale()
            .normalize()
            .withMetadata({
              density: targetDPI,
              resolution: targetDPI,
            })
            .png();

          // For debugging purposes
          // await image.toFile(path.resolve(__dirname, `../../storage/`, `pg${page.pageNumber}.png`));
          return await image.toBuffer();
        } catch (error) {
          this.log(`Iteration error: ${error.message}`, error.stack);
          continue;
        }
      }
      this.log(`No valid images found on page ${page.pageNumber}`);
      return null;
    } catch (error) {
      this.log(`Error: ${error.message}`, error.stack);
      return null;
    }
  }
}

module.exports = OCRLoader;
