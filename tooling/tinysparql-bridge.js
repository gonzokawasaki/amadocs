#!/usr/bin/env node
// AMAdocs: TinySPARQL → AMAdocs FULL-PULL bridge ("ride on GNOME" hybrid).
//
// Reads the full text + metadata that GNOME's LocalSearch indexer already
// extracted (held in TinySPARQL as nie:plainTextContent), and writes
// AnythingLLM-shaped document JSONs into the engine's storage/documents folder.
// Those can then be embedded via POST /workspace/:slug/update-embeddings {adds:[...]}
// — so AMAdocs adds the semantic/embedding layer on top of the OS index WITHOUT
// re-parsing the files itself.
//
// For INCREMENTAL refresh (re-embed only changed/new/deleted files), use the
// companion tinysparql-sync.js instead of re-running this full pull.
//
// Blind spots (Office files broken by WPS mime override, scanned PDFs, images)
// have no plainTextContent in the index, so they are simply absent here — they
// are AMAdocs' own-pipeline (OCR/vision/parser) job, handled separately.
//
// Usage:
//   node tooling/tinysparql-bridge.js [folder] [limit]
//     folder : filesystem prefix to pull (default /mnt/space/teaching_docs)
//     limit  : max docs (default 0 = all)
//   env EXCLUDE : skip files whose URL contains this substring (default
//     "/novels/" — the giant public-domain books used as corpus filler). Set
//     EXCLUDE="" to keep all. Rows are ORDER BY url so a LIMIT slice is deterministic.

const fs = require("fs");
const path = require("path");
const lib = require("./lib/tinysparql-lib");

const FOLDER = process.argv[2] || "/mnt/space/teaching_docs";
const LIMIT = process.argv[3] ? parseInt(process.argv[3], 10) : 0;
const EXCLUDE = process.env.EXCLUDE !== undefined ? process.env.EXCLUDE : "/novels/";

function main() {
  console.log(`[bridge] querying LocalSearch for docs under ${FOLDER} ...`);
  const metas = lib.queryDocMeta({ folder: FOLDER, exclude: EXCLUDE, limit: LIMIT });
  console.log(`[bridge] ${metas.length} docs with extracted text`);

  const adds = [];
  let n = 0;
  for (const meta of metas) {
    const text = lib.fetchText(meta.u);
    if (text.trim().length < 1) continue;
    const docpath = lib.writeDoc(lib.buildDoc(meta, text));
    adds.push(docpath);
    n++;
    if (n % 50 === 0) console.log(`[bridge]   wrote ${n} ...`);
  }

  const manifest = path.resolve(__dirname, "tinysparql-adds.json");
  fs.writeFileSync(manifest, JSON.stringify(adds, null, 2));
  console.log(`[bridge] wrote ${n} document JSONs to ${path.join(lib.DOCS_DIR, lib.SUBFOLDER)}`);
  console.log(`[bridge] embed manifest (${adds.length} paths): ${manifest}`);
  console.log(`[bridge] next: POST these as {adds:[...]} to /workspace/<slug>/update-embeddings`);
}

main();
