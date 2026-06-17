const path = require("path");
const fs = require("fs");
const {
  WATCH_DIRECTORY,
  SUPPORTED_FILETYPE_CONVERTERS,
} = require("../utils/constants");
const {
  trashFile,
  isTextType,
  normalizePath,
  isWithin,
  stashOriginal,
  commitOriginal,
  discardOriginal,
  documentsFolder,
} = require("../utils/files");
const DocSummary = require("../utils/DocSummary");
const VisionCaption = require("../utils/VisionCaption");
const RESERVED_FILES = ["__HOTDIR__.md"];

/**
 * AMAdocs: generate a short "catalog card" summary for each freshly-parsed document
 * and write it back to the document's JSON as `aiSummary` (metadata for the semantic
 * file browser). Runs at the single funnel every file drop passes through, so all
 * file types are covered without touching each converter. Best-effort and isolated:
 * any failure is logged and skipped — never breaks ingestion.
 *
 * Skipped for: parse-only/direct uploads (not embedded into a workspace), images
 * (their vision caption already IS their summary), and when DOC_SUMMARY_ENABLED=false.
 * @param {{success:boolean, documents:Object[]}} result
 * @param {string} fileExtension
 * @param {Object} options - carries `summary:{enabled,model,ollamaBasePath}` from the server
 */
async function attachDocumentSummary(result, fileExtension, options = {}) {
  const cfg = options?.summary;
  if (!result?.success || options.parseOnly) return;
  if (cfg && cfg.enabled === false) return;
  if (VisionCaption.SUPPORTED.has(fileExtension)) return; // caption is the image's summary

  const summarizer = new DocSummary({
    model: cfg?.model,
    basePath: cfg?.ollamaBasePath,
  });

  for (const document of result.documents || []) {
    try {
      if (!document?.location || !document?.pageContent) continue;
      const summary = await summarizer.summarize(document.pageContent, {
        title: document.title,
        pages: document.pages,
      });
      if (!summary) continue;

      // Persist onto the on-disk document JSON (strip the runtime-only fields the
      // write helper appends) and reflect it on the returned object.
      const docPath = normalizePath(
        path.resolve(documentsFolder, document.location)
      );
      if (fs.existsSync(docPath)) {
        const { location, isDirectUpload, ...data } = document;
        data.aiSummary = summary;
        fs.writeFileSync(docPath, JSON.stringify(data, null, 4), {
          encoding: "utf-8",
        });
      }
      document.aiSummary = summary;
    } catch (e) {
      console.error(`[DocSummary] Skipped summary for a document: ${e.message}`);
    }
  }
}

/**
 * Process a single file and return the documents
 * @param {string} targetFilename - The filename to process
 * @param {Object} options - The options for the file processing
 * @param {boolean} options.parseOnly - If true, the file will not be saved as a document even when `writeToServerDocuments` is called in the handler. Must be explicitly set to true to use.
 * @param {string} options.absolutePath - If provided, use this absolute path instead of resolving relative to WATCH_DIRECTORY. For internal use only.
 * @param {Object} metadata - The metadata for the file processing
 * @returns {Promise<{success: boolean, reason: string, documents: Object[]}>} - The documents from the file processing
 */
async function processSingleFile(targetFilename, options = {}, metadata = {}) {
  const fullFilePath = normalizePath(
    options.absolutePath || path.resolve(WATCH_DIRECTORY, targetFilename)
  );

  // If absolute path is not provided, check if the file is within the watch directory
  // to prevent unauthorized paths from being processed.
  if (
    !options.absolutePath &&
    !isWithin(path.resolve(WATCH_DIRECTORY), fullFilePath)
  )
    return {
      success: false,
      reason: "Filename is a not a valid path to process.",
      documents: [],
    };

  if (RESERVED_FILES.includes(targetFilename))
    return {
      success: false,
      reason: "Filename is a reserved filename and cannot be processed.",
      documents: [],
    };

  if (!fs.existsSync(fullFilePath))
    return {
      success: false,
      reason: "File does not exist in upload directory.",
      documents: [],
    };

  const fileExtension = path.extname(fullFilePath).toLowerCase();
  if (fullFilePath.includes(".") && !fileExtension) {
    return {
      success: false,
      reason: `No file extension found. This file cannot be processed.`,
      documents: [],
    };
  }

  let processFileAs = fileExtension;
  if (!SUPPORTED_FILETYPE_CONVERTERS.hasOwnProperty(fileExtension)) {
    if (isTextType(fullFilePath)) {
      console.log(
        `\x1b[33m[Collector]\x1b[0m The provided filetype of ${fileExtension} does not have a preset and will be processed as .txt.`
      );
      processFileAs = ".txt";
    } else {
      // If absolute path is provided, do NOT trash the file since it is a user provided path.
      if (!options.absolutePath) trashFile(fullFilePath);
      return {
        success: false,
        reason: `File extension ${fileExtension} not supported for parsing and cannot be assumed as text file type.`,
        documents: [],
      };
    }
  }

  const FileTypeProcessor = require(SUPPORTED_FILETYPE_CONVERTERS[
    processFileAs
  ]);

  // AMAdocs: keep a copy of the original file (so the UI can show the "pretty"
  // version) before the converter runs — converters trash the source file.
  // Skip for parse-only/direct uploads which aren't embedded into a workspace.
  const retainOriginal = !options.parseOnly;
  const pendingOriginal = retainOriginal
    ? stashOriginal(fullFilePath, fileExtension)
    : null;

  const result = await FileTypeProcessor({
    fullFilePath,
    filename: targetFilename,
    options,
    metadata,
  });

  // Commit the stashed original under the generated document id, or drop it.
  const docId = result?.documents?.[0]?.id;
  if (result?.success && docId) commitOriginal(pendingOriginal, docId);
  else discardOriginal(pendingOriginal);

  // AMAdocs: attach a short AI summary to each parsed document (metadata for the
  // semantic file browser). Best-effort — never fails the ingestion.
  await attachDocumentSummary(result, fileExtension, options);

  return result;
}

module.exports = {
  processSingleFile,
};
