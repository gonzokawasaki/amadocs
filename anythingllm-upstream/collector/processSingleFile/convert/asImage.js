const { v4 } = require("uuid");
const { tokenizeString } = require("../../utils/tokenizer");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../utils/files");
const OCRLoader = require("../../utils/OCRLoader");
const VisionCaption = require("../../utils/VisionCaption");
const { default: slugify } = require("slugify");

async function asImage({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  // AMAdocs: read an image two ways and combine them, so a picture is searchable
  // by both its literal text AND its visual content:
  //   • OCR  — pulls out any text glyphs in the image (exact anchors).
  //   • Vision caption — a local model describes what's *in* the image, so
  //     text-less photos/whiteboards/screenshots are no longer dead weight.
  // Both are best-effort; we only fail the file if BOTH come back empty.
  const [ocr, caption] = await Promise.all([
    new OCRLoader({ targetLanguages: options?.ocr?.langList })
      .ocrImage(fullFilePath)
      .catch(() => ({ text: null, confidence: 0, reliable: false })),
    new VisionCaption({
      model: options?.vision?.model,
      basePath: options?.vision?.ollamaBasePath,
    })
      .caption(fullFilePath)
      .catch(() => null),
  ]);

  // Assemble the searchable text. Lead with the caption (what the image is),
  // then the verbatim OCR text (what it literally says). Light labels help the
  // model ground answers without polluting retrieval.
  // AMAdocs: OCR on a text-less photo hallucinates low-confidence glyph noise
  // ("PEER EEE HEE EE Spey 11 ¢ Bi…") that pollutes retrieval and shows up as
  // junk `extractedText` in the export sidecar. OCRLoader flags that via a mean
  // -confidence gate (`reliable`). Drop unreliable OCR — but only when the
  // caption can carry the file; with no caption we keep whatever OCR we have
  // rather than drop the file (never-drop guarantee).
  const hasCaption = !!caption?.trim();
  const ocrTrim = ocr?.text?.trim() || "";
  const keepOcr = ocrTrim && (ocr?.reliable || !hasCaption);
  const sections = [];
  if (hasCaption) sections.push(`Image description:\n${caption.trim()}`);
  if (keepOcr) sections.push(`Text found in image:\n${ocrTrim}`);
  const content = sections.join("\n\n");

  if (!content.length) {
    console.error(
      `[asImage] No text or visual content could be extracted from ${filename}.`
    );
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No readable content found in ${filename}.`,
      documents: [],
    };
  }

  console.log(
    `-- Working ${filename} -- (caption: ${hasCaption ? "yes" : "no"}, ocr: ${
      keepOcr
        ? `kept@${Math.round(ocr?.confidence || 0)}`
        : ocrTrim
          ? `dropped-as-noise@${Math.round(ocr?.confidence || 0)}`
          : "none"
    })`
  );
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "Unknown",
    description: metadata.description || "Unknown",
    docSource: metadata.docSource || "image file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asImage;
