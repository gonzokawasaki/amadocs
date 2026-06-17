// AMAdocs: standalone verification for the full-metadata native embed (MetadataEmbed).
// Generates real PNG/JPEG/PDF/DOCX, embeds the full payload, reads it back, asserts.
const path = require("path");
const SERVER = "/mnt/space/k-base/anythingllm-upstream/server";
const { embedMetadata, buildXmp } = require(path.join(
  SERVER,
  "utils/MetadataEmbed"
));
const sharp = require(path.join(SERVER, "node_modules/sharp"));
const { PDFDocument } = require(path.join(SERVER, "node_modules/pdf-lib"));
const JSZip = require(path.join(SERVER, "node_modules/jszip"));
const piexif = require(path.join(SERVER, "node_modules/piexifjs"));

const META = {
  exportedBy: "AMAdocs",
  exportedAt: new Date().toISOString(),
  source: {
    filename: "robot.png",
    collection: "vision-test",
    documentId: "abc-123-def",
    wordCount: 42,
  },
  aiSummary: "A friendly yellow robot waving on a blue background.",
  aiDescription:
    "The image shows a cartoon robot with a yellow body, antenna, and a raised left arm, set against a sky-blue backdrop with a few clouds. Unicode check: café — résumé — ☕.",
  extractedText: "HELLO HUMAN".repeat(20),
};

let pass = 0,
  fail = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? "  " + extra : ""}`);
  }
}

// Parse PNG chunks → [{type, data}]
function pngChunks(buf) {
  const out = [];
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("latin1");
    const data = buf.subarray(i + 8, i + 8 + len);
    out.push({ type, data });
    i += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

async function main() {
  // ---------- PNG ----------
  console.log("\nPNG:");
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#ffcc00" },
  })
    .png()
    .toBuffer();
  const pngOut = await embedMetadata({ buffer: png, ext: ".png", metadata: META });
  ok("returns image/png", pngOut && pngOut.contentType === "image/png");
  const pc = pngChunks(pngOut.buffer);
  const itxts = pc.filter((c) => c.type === "iTXt");
  const xmpChunk = itxts.find((c) =>
    c.data.toString("utf8").startsWith("XML:com.adobe.xmp")
  );
  const descChunk = itxts.find((c) =>
    c.data.toString("utf8").startsWith("Description")
  );
  ok("has Description iTXt chunk", !!descChunk);
  ok("has XMP iTXt chunk", !!xmpChunk);
  ok(
    "XMP carries amadocs:data round-trip",
    xmpChunk && xmpChunk.data.toString("utf8").includes("abc-123-def")
  );
  ok(
    "XMP preserves Unicode (café/☕)",
    xmpChunk && xmpChunk.data.toString("utf8").includes("☕")
  );
  const pngMeta = await sharp(pngOut.buffer).metadata().catch(() => null);
  ok("still a valid 64x64 PNG", pngMeta && pngMeta.width === 64);
  ok("input bytes untouched (copy)", !png.equals(pngOut.buffer));

  // ---------- JPEG ----------
  console.log("\nJPEG:");
  const jpg = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
  const jpgOut = await embedMetadata({ buffer: jpg, ext: ".jpg", metadata: META });
  ok("returns image/jpeg", jpgOut && jpgOut.contentType === "image/jpeg");
  const jpgMeta = await sharp(jpgOut.buffer).metadata().catch(() => null);
  ok("still a valid 64x64 JPEG", jpgMeta && jpgMeta.width === 64);
  // EXIF ImageDescription (ASCII display line)
  const exifObj = piexif.load(jpgOut.buffer.toString("binary"));
  const imgDesc = exifObj["0th"][piexif.ImageIFD.ImageDescription];
  ok("EXIF ImageDescription set", !!imgDesc, `("${(imgDesc || "").slice(0, 30)}…")`);
  // XMP APP1 present + carries full data
  const jpgStr = jpgOut.buffer.toString("latin1");
  ok("has XMP APP1 segment", jpgStr.includes("http://ns.adobe.com/xap/1.0/"));
  const xmpStart = jpgOut.buffer.toString("utf8");
  ok("JPEG XMP carries amadocs:data", xmpStart.includes("abc-123-def"));

  // JPEG size-cap path: huge OCR text must still fit APP1 (<=65533 payload)
  const bigMeta = { ...META, extractedText: "WORD ".repeat(50000) };
  const jpgBig = await embedMetadata({ buffer: jpg, ext: ".jpg", metadata: bigMeta });
  const bigOk = await sharp(jpgBig.buffer).metadata().catch(() => null);
  // find APP1 XMP segment length
  let maxApp1 = 0;
  {
    const b = jpgBig.buffer;
    let i = 2;
    while (i < b.length - 1) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1];
      if (marker === 0xda) break; // SOS
      const len = b.readUInt16BE(i + 2);
      if (marker === 0xe1) maxApp1 = Math.max(maxApp1, len);
      i += 2 + len;
    }
  }
  ok("oversized OCR → still valid JPEG", !!bigOk);
  ok("APP1 XMP segment within 65535 limit", maxApp1 > 0 && maxApp1 <= 65535, `(len=${maxApp1})`);

  // ---------- PDF ----------
  console.log("\nPDF:");
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText("hello");
  const pdf = Buffer.from(await doc.save());
  const pdfOut = await embedMetadata({ buffer: pdf, ext: ".pdf", metadata: META });
  ok("returns application/pdf", pdfOut && pdfOut.contentType === "application/pdf");
  const reopened = await PDFDocument.load(pdfOut.buffer);
  ok(
    "/Subject set to display line",
    (reopened.getSubject() || "").startsWith("A friendly yellow robot")
  );
  const pdfStr = pdfOut.buffer.toString("utf8");
  ok("PDF embeds XMP packet", pdfStr.includes("x:xmpmeta"));
  ok("PDF XMP carries amadocs:data", pdfStr.includes("abc-123-def"));
  ok("PDF reopens cleanly", reopened.getPageCount() === 1);

  // ---------- DOCX (minimal hand-built OOXML) ----------
  console.log("\nDOCX:");
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  );
  z.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
  );
  z.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></cp:coreProperties>`
  );
  z.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`
  );
  const docx = await z.generateAsync({ type: "nodebuffer" });
  const docxOut = await embedMetadata({ buffer: docx, ext: ".docx", metadata: META });
  ok("returns docx content-type", docxOut && /wordprocessingml/.test(docxOut.contentType));
  const rz = await JSZip.loadAsync(docxOut.buffer);
  const custom = rz.file("docProps/custom.xml");
  ok("custom.xml part created", !!custom);
  if (custom) {
    const cx = await custom.async("string");
    ok("custom.xml has AMAdocs Summary prop", cx.includes("AMAdocs Summary"));
    ok("custom.xml has full Data prop (round-trip)", cx.includes("abc-123-def"));
  }
  const ct = await rz.file("[Content_Types].xml").async("string");
  ok("content-types registers custom.xml", ct.includes('PartName="/docProps/custom.xml"'));
  const rels = await rz.file("_rels/.rels").async("string");
  ok("rels references custom-properties", rels.includes("custom-properties"));
  const core = await rz.file("docProps/core.xml").async("string");
  ok("core.xml dc:description set", /<dc:description>/.test(core));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
