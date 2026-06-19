// AMAdocs: embed everything AMAdocs understands about a document — the AI summary,
// the AI vision description, any OCR'd text, and source/provenance — into a COPY of the
// file's OWN native metadata, so that understanding travels inside the file (visible in
// OS file managers / other tools) instead of only in a separate sidecar. The user's
// source file is NEVER touched: we operate on a buffer and the caller streams the result
// as a new download.
//
// There is no single cross-format metadata standard, BUT XMP (Adobe's RDF/XML metadata
// packet) is natively carried by PDF, JPEG and PNG, so those three share ONE schema — a
// custom `amadocs:` namespace + the standard dc:description — and differ only in how the
// packet is injected. Office (OOXML) doesn't use XMP; its native home for arbitrary
// structured app metadata is custom document properties (docProps/custom.xml).
//
//   • PDF              → XMP metadata stream + Info /Subject        (pdf-lib)
//   • PNG              → iTXt "XML:com.adobe.xmp" + "Description"    (hand-rolled chunks)
//   • JPEG             → APP1 XMP segment + EXIF ImageDescription    (no pixel re-encode)
//   • Office (OOXML)   → docProps/custom.xml + core.xml dc:description (jszip)
//
// For each family we write BOTH a standard slot (so generic tools show something) AND the
// full `amadocs:` payload (so AMAdocs can read it all back losslessly). Other extensions
// return null (unsupported) — the sidecar export covers those.

const AMADOCS_NS = "https://amadocs.app/ns/1.0/";
const XMP_SCHEMA_VERSION = "1";
// JPEG APP1 max payload: 65535 - 2 (length field) - 29 (XMP identifier incl. NUL).
const JPEG_XMP_MAX = 65535 - 2 - 29;

const SUPPORTED_EMBED_EXTS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".jpg",
  ".jpeg",
  ".png",
];

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function log(text, ...args) {
  console.log(`\x1b[36m[MetadataEmbed]\x1b[0m ${text}`, ...args);
}

function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// XML 1.0 permits only tab (0x09), LF (0x0A) and CR (0x0D) among control characters;
// any other C0 control (plus DEL) makes the whole XMP/XML packet invalid. Small LLMs
// occasionally emit stray control bytes (e.g. 0x14, 0x19) inside a generated summary, so
// strip them from every text field before we build metadata — both the human-readable
// fields and the JSON blob, so the embedded data is clean and round-trips.
function sanitizeText(s) {
  return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function deepSanitize(value) {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = deepSanitize(value[k]);
    return out;
  }
  return value;
}

// A metadata object may be a bare summary string (back-compat) or the full sidecar shape.
function normalizeMetadata(input) {
  if (!input) return null;
  if (typeof input === "string") return { aiSummary: input };
  return input;
}

// In-file metadata should carry AMAdocs' *understanding* (summary, description,
// provenance) — not a second full copy of the document's own text. A scanned photo's OCR
// is small and worth embedding, but a 500-page PDF's extracted text would double the file
// for no gain (the text is already inside it). So cap extractedText for the embed; the
// sidecar export keeps the complete text.
const EMBED_TEXT_CAP = 16000; // ~2,500 words
function capForEmbed(meta) {
  if (!meta || typeof meta !== "object") return meta;
  if (meta.extractedText && meta.extractedText.length > EMBED_TEXT_CAP) {
    return {
      ...meta,
      extractedText:
        meta.extractedText.slice(0, EMBED_TEXT_CAP) +
        "… [truncated — full text is in the sidecar export]",
    };
  }
  return meta;
}

// The short, human-facing line for the standard "description" slots dumb tools surface.
function pickDisplay(meta = {}) {
  const text =
    meta.aiSummary ||
    meta.aiDescription ||
    (meta.extractedText ? meta.extractedText.slice(0, 400) : "") ||
    "";
  return String(text).trim();
}

/* ---------------------------------- XMP ---------------------------------- */
// Build an XMP packet carrying the standard dc:description (the display line) plus the
// full payload under the amadocs: namespace — individual fields for XMP-aware tools, and
// a complete JSON blob in amadocs:data for a lossless round-trip back into AMAdocs.
function buildXmp(meta = {}) {
  const display = pickDisplay(meta);
  const json = JSON.stringify(meta);
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="AMAdocs">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
    `    xmlns:amadocs="${AMADOCS_NS}">\n` +
    `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(
      display
    )}</rdf:li></rdf:Alt></dc:description>\n` +
    `   <amadocs:schemaVersion>${XMP_SCHEMA_VERSION}</amadocs:schemaVersion>\n` +
    `   <amadocs:summary>${xmlEscape(meta.aiSummary || "")}</amadocs:summary>\n` +
    `   <amadocs:aiDescription>${xmlEscape(
      meta.aiDescription || ""
    )}</amadocs:aiDescription>\n` +
    `   <amadocs:extractedText>${xmlEscape(
      meta.extractedText || ""
    )}</amadocs:extractedText>\n` +
    `   <amadocs:data>${xmlEscape(json)}</amadocs:data>\n` +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

// Build an XMP packet whose UTF-8 length fits within `maxBytes` (for JPEG's APP1 cap),
// shedding the heaviest fields first: trim extractedText, then drop it, then drop the
// full JSON blob — always keeping the summary/description/source intact.
function buildXmpFitting(meta = {}, maxBytes = JPEG_XMP_MAX) {
  let xmp = buildXmp(meta);
  if (Buffer.byteLength(xmp, "utf8") <= maxBytes) return xmp;

  const slim = { ...meta };
  // Trim extractedText down in halves until the packet fits or it's gone.
  if (slim.extractedText) {
    let txt = slim.extractedText;
    while (txt.length > 200) {
      txt = txt.slice(0, Math.floor(txt.length / 2));
      slim.extractedText = txt + "… [truncated for in-file metadata]";
      xmp = buildXmp(slim);
      if (Buffer.byteLength(xmp, "utf8") <= maxBytes) return xmp;
    }
    delete slim.extractedText;
    xmp = buildXmp(slim);
    if (Buffer.byteLength(xmp, "utf8") <= maxBytes) return xmp;
  }
  // Last resort: drop the verbose fields entirely; keep the headline data only.
  const minimal = {
    exportedBy: meta.exportedBy,
    source: meta.source,
    aiSummary: meta.aiSummary,
    aiDescription: meta.aiDescription
      ? meta.aiDescription.slice(0, 1000)
      : meta.aiDescription,
  };
  xmp = buildXmp(minimal);
  if (Buffer.byteLength(xmp, "utf8") <= maxBytes) return xmp;
  // Give up on structured data — just the display line.
  return buildXmp({ aiSummary: pickDisplay(meta).slice(0, 1000) });
}

/* ---------------------------------- PDF ---------------------------------- */
async function embedPdf(buffer, meta) {
  const { PDFDocument, PDFName } = require("pdf-lib");
  const pdf = await PDFDocument.load(buffer, {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const display = pickDisplay(meta);
  if (display) pdf.setSubject(display); // the slot file managers show
  const existing = (pdf.getKeywords() || "").trim();
  pdf.setKeywords(
    existing ? [existing, "AMAdocs metadata"] : ["AMAdocs metadata"]
  );

  // Inject our XMP packet as the document metadata stream. XMP must be uncompressed
  // plaintext, so use context.stream (raw), and point the catalog /Metadata at ours so
  // it is the authoritative packet regardless of what pdf-lib may also write.
  // IMPORTANT: pass UTF-8 BYTES, not the JS string — given a string pdf-lib re-encodes it
  // with single-byte PDFDocEncoding, which corrupts every non-Latin1 char (e.g. an em-dash
  // U+2014 → byte 0x14, a curly quote U+2019 → 0x19), silently mangling the packet.
  const xmp = buildXmp(meta);
  const metaStream = pdf.context.stream(Buffer.from(xmp, "utf8"), {
    Type: "Metadata",
    Subtype: "XML",
  });
  const ref = pdf.context.register(metaStream);
  pdf.catalog.set(PDFName.of("Metadata"), ref);

  const bytes = await pdf.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/* --------------------------- Office (OOXML zip) -------------------------- */
function ooxmlCustomProps(meta) {
  // fmtid is the well-known GUID for custom document properties; pid must start at 2.
  const FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
  const props = [
    ["AMAdocs Summary", meta.aiSummary],
    ["AMAdocs Description", meta.aiDescription],
    ["AMAdocs Extracted Text", meta.extractedText],
    ["AMAdocs Data", JSON.stringify(meta)],
  ].filter(([, v]) => v != null && String(v).length);
  const body = props
    .map(
      ([name, value], i) =>
        `<property fmtid="${FMTID}" pid="${i + 2}" name="${xmlEscape(
          name
        )}"><vt:lpwstr>${xmlEscape(value)}</vt:lpwstr></property>`
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    body +
    `</Properties>`
  );
}

async function embedOoxml(buffer, meta) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);

  // 1) Standard slot: core.xml <dc:description> (the visible "Comments"/description).
  const corePath = "docProps/core.xml";
  const coreFile = zip.file(corePath);
  const display = pickDisplay(meta);
  if (coreFile && display) {
    let core = await coreFile.async("string");
    const desc = `<dc:description>${xmlEscape(display)}</dc:description>`;
    if (/<dc:description>[\s\S]*?<\/dc:description>/.test(core))
      core = core.replace(/<dc:description>[\s\S]*?<\/dc:description>/, desc);
    else if (/<\/cp:coreProperties>/.test(core))
      core = core.replace(/<\/cp:coreProperties>/, `${desc}</cp:coreProperties>`);
    if (core) zip.file(corePath, core);
  }

  // 2) Full payload: docProps/custom.xml custom document properties.
  zip.file("docProps/custom.xml", ooxmlCustomProps(meta));

  // Register the custom.xml part in [Content_Types].xml (Override) if not already there.
  const ctPath = "[Content_Types].xml";
  const ctFile = zip.file(ctPath);
  if (!ctFile) {
    log("No [Content_Types].xml — not a valid OOXML package, skipping.");
    return null;
  }
  let ct = await ctFile.async("string");
  if (!ct.includes('PartName="/docProps/custom.xml"')) {
    const override =
      `<Override PartName="/docProps/custom.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`;
    if (/<\/Types>/.test(ct)) ct = ct.replace(/<\/Types>/, `${override}</Types>`);
    zip.file(ctPath, ct);
  }

  // Register the relationship from the package root (_rels/.rels).
  const relsPath = "_rels/.rels";
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    let rels = await relsFile.async("string");
    if (!rels.includes("docProps/custom.xml")) {
      // Pick a relationship id that doesn't collide with existing ones.
      const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
      const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
      const rel =
        `<Relationship Id="rId${nextId}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" ` +
        `Target="docProps/custom.xml"/>`;
      if (/<\/Relationships>/.test(rels))
        rels = rels.replace(/<\/Relationships>/, `${rel}</Relationships>`);
      zip.file(relsPath, rels);
    }
  }

  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

/* ---------------------------------- JPEG --------------------------------- */
function embedJpegExif(buffer, display) {
  const piexif = require("piexifjs");
  // EXIF ImageDescription is an ASCII field — strip non-ASCII so piexif.dump can't throw.
  const ascii = String(display).replace(/[^\x00-\x7F]/g, "");
  const binary = buffer.toString("binary");
  let exifObj;
  try {
    exifObj = piexif.load(binary);
  } catch {
    exifObj = { "0th": {}, Exif: {}, GPS: {}, "1st": {}, thumbnail: null };
  }
  exifObj["0th"] = exifObj["0th"] || {};
  if (ascii) exifObj["0th"][piexif.ImageIFD.ImageDescription] = ascii;
  exifObj["0th"][piexif.ImageIFD.Software] = "AMAdocs";
  const exifBytes = piexif.dump(exifObj);
  return Buffer.from(piexif.insert(exifBytes, binary), "binary");
}

// Insert an APP1 XMP segment immediately after the SOI marker. Multiple APP1 segments
// (EXIF + XMP) are legal; readers match on the leading identifier string.
function insertJpegXmp(buffer, xmp) {
  if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const id = Buffer.from("http://ns.adobe.com/xap/1.0/ ", "latin1");
  const xmpBuf = Buffer.from(xmp, "utf8");
  const segLen = 2 + id.length + xmpBuf.length; // length field counts itself
  if (segLen > 65535) return null;
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = 0xe1; // APP1
  header.writeUInt16BE(segLen, 2);
  const segment = Buffer.concat([header, id, xmpBuf]);
  // SOI is the first 2 bytes; splice the segment in right after it.
  return Buffer.concat([buffer.subarray(0, 2), segment, buffer.subarray(2)]);
}

function embedJpeg(buffer, meta) {
  const withExif = embedJpegExif(buffer, pickDisplay(meta));
  const xmp = buildXmpFitting(meta, JPEG_XMP_MAX);
  const out = insertJpegXmp(withExif, xmp);
  return out || withExif; // worst case: still return the EXIF-tagged copy
}

/* ---------------------------------- PNG ---------------------------------- */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Build an uncompressed iTXt chunk: keyword\0 compFlag(0) compMethod(0) lang\0 transKw\0 text.
function pngITXt(keyword, text) {
  const kw = Buffer.from(keyword, "latin1");
  const txt = Buffer.from(text, "utf8");
  const data = Buffer.concat([kw, Buffer.from([0, 0, 0, 0, 0]), txt]);
  const type = Buffer.from("iTXt", "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([len, type, data, crc]);
}

function embedPng(buffer, meta) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIG)) return null;
  const iendStart = buffer.length - 12;
  if (
    iendStart < 8 ||
    buffer.subarray(iendStart + 4, iendStart + 8).toString("latin1") !== "IEND"
  )
    return null;

  const chunks = [pngITXt("Description", pickDisplay(meta))];
  // The XMP convention for PNG uses the reserved keyword "XML:com.adobe.xmp".
  chunks.push(pngITXt("XML:com.adobe.xmp", buildXmp(meta)));

  return Buffer.concat([
    buffer.subarray(0, iendStart),
    ...chunks,
    buffer.subarray(iendStart),
  ]);
}

/* -------------------------------- dispatch ------------------------------- */
/**
 * Embed AMAdocs metadata into a copy of a file's native metadata containers.
 * @param {Object} args
 * @param {Buffer} args.buffer  - Original file bytes (never mutated).
 * @param {string} args.ext     - Lowercased extension incl. dot (e.g. ".pdf").
 * @param {Object|string} args.metadata - Full sidecar-shaped object, or a bare summary string.
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>} null if unsupported/failed.
 */
async function embedMetadata({ buffer, ext, metadata } = {}) {
  const meta = capForEmbed(deepSanitize(normalizeMetadata(metadata)));
  if (!buffer || !meta || !SUPPORTED_EMBED_EXTS.includes(ext)) return null;
  if (!pickDisplay(meta) && !meta.source) return null; // nothing worth writing
  try {
    let out = null;
    if (ext === ".pdf") out = await embedPdf(buffer, meta);
    else if (ext === ".docx" || ext === ".xlsx" || ext === ".pptx")
      out = await embedOoxml(buffer, meta);
    else if (ext === ".jpg" || ext === ".jpeg") out = embedJpeg(buffer, meta);
    else if (ext === ".png") out = embedPng(buffer, meta);
    if (!out) return null;
    return {
      buffer: out,
      contentType: CONTENT_TYPES[ext] || "application/octet-stream",
    };
  } catch (e) {
    log(`Embed failed for ${ext}: ${e.message}`);
    return null;
  }
}

// Back-compat thin wrapper: embed just a summary string.
async function embedSummary({ buffer, ext, summary } = {}) {
  return embedMetadata({ buffer, ext, metadata: summary });
}

module.exports = {
  embedMetadata,
  embedSummary,
  buildXmp,
  AMADOCS_NS,
  SUPPORTED_EMBED_EXTS,
  CONTENT_TYPES,
};
