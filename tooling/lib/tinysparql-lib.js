// AMAdocs: shared TinySPARQL/LocalSearch helpers used by both the full-pull
// bridge (tinysparql-bridge.js) and the incremental delta-sync (tinysparql-sync.js).
//
// All queries talk to the LIVE LocalSearch daemon over D-Bus (the on-disk meta.db
// is WAL-locked by the daemon, so a standalone endpoint sees an empty view).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const DBUS = "org.freedesktop.LocalSearch3";
const US = ""; // field delimiter (unit separator — never in document text)
const NL = "␛"; // newline sentinel — keeps each result row on one physical line

const DOCS_DIR = path.resolve(
  __dirname,
  "../../anythingllm-upstream/server/storage/documents"
);
const SUBFOLDER = "tinysparql-teaching"; // 1-level folder under storage/documents

// Run a SPARQL query against the live daemon. File-based (-f) to dodge shell
// escaping; large maxBuffer because plainTextContent can be ~1MB.
function sparql(query) {
  const tmp = path.join(os.tmpdir(), `tsp-${crypto.randomBytes(4).toString("hex")}.rq`);
  fs.writeFileSync(tmp, query);
  try {
    return execFileSync("tinysparql", ["query", "-b", DBUS, "-f", tmp], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 512,
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// The CLI prints a "Results:" header then each row indented by 2 spaces. With a
// single CONCAT column whose value has no newlines (sentinel-replaced), one row
// == one physical line.
function parseRows(out) {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.trim() === "Results:");
  if (i < 0) return [];
  return lines.slice(i + 1).filter((l) => l.startsWith("  ")).map((l) => l.slice(2));
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

// SPARQL FILTER that skips files whose URL contains `exclude` (e.g. "/novels/").
function excludeClause(exclude) {
  return exclude
    ? `FILTER(!CONTAINS(STR(?u), "${String(exclude).replace(/"/g, '\\"')}"))`
    : "";
}

// Lightweight listing for delta diffing: every file under `folder` that HAS
// extracted text, with its last-modified time. No full text pulled (cheap).
// Returns [{ url, mtime }].
function queryFileList({ folder, exclude }) {
  // GROUP BY ?u + MAX(?m): nfo:fileLastModified is stored with two (identical)
  // values per file, which would otherwise double every row; collapsing to one
  // row per url with the newest mtime keeps the delta diff clean & deterministic.
  const q = `
SELECT (CONCAT(STR(?u), "${US}", COALESCE(MAX(STR(?m)), "")) AS ?row)
WHERE {
  ?ie nie:plainTextContent ?t ; nie:isStoredAs ?do .
  ?do nie:url ?u .
  OPTIONAL { ?do nfo:fileLastModified ?m }
  FILTER(STRSTARTS(STR(?u), "file://${folder}/"))
  ${excludeClause(exclude)}
}
GROUP BY ?u
ORDER BY ?u`;
  return parseRows(sparql(q))
    .map((r) => { const [url, mtime] = r.split(US); return { url, mtime: mtime || "" }; })
    .filter((x) => x.url);
}

// Batched metadata for the full pull: one row per indexed doc with text.
// Returns [{ u, mime, wc, pc, title, author, created }].
function queryDocMeta({ folder, exclude, limit }) {
  const q = `
SELECT (CONCAT(
  STR(?u), "${US}", STR(?m), "${US}",
  COALESCE(STR(?wc), ""), "${US}", COALESCE(STR(?pc), ""), "${US}",
  COALESCE(REPLACE(?title, "[\\n\\r${US}]", " "), ""), "${US}",
  COALESCE(STR(?author), ""), "${US}", COALESCE(STR(?created), "")
) AS ?row)
WHERE {
  ?ie nie:plainTextContent ?t ; nie:mimeType ?m ; nie:isStoredAs ?do .
  ?do nie:url ?u .
  FILTER(STRSTARTS(STR(?u), "file://${folder}/"))
  ${excludeClause(exclude)}
  OPTIONAL { ?ie nfo:wordCount ?wc }
  OPTIONAL { ?ie nfo:pageCount ?pc }
  OPTIONAL { ?ie nie:title ?title }
  OPTIONAL { ?ie nco:creator [ nco:fullname ?author ] }
  OPTIONAL { ?ie nie:contentCreated ?created }
}
ORDER BY ?u
${limit > 0 ? `LIMIT ${limit}` : ""}`;
  return parseRows(sparql(q)).map((row) => {
    const [u, mime, wc, pc, title, author, created] = row.split(US);
    return { u, mime, wc, pc, title, author, created };
  }).filter((x) => x.u);
}

// Metadata for a SINGLE url (used by delta-sync for changed/new files).
function fetchMeta(url) {
  const q = `
SELECT (CONCAT(
  STR(?m), "${US}", COALESCE(STR(?wc), ""), "${US}", COALESCE(STR(?pc), ""), "${US}",
  COALESCE(REPLACE(?title, "[\\n\\r${US}]", " "), ""), "${US}",
  COALESCE(STR(?author), ""), "${US}", COALESCE(STR(?created), "")
) AS ?row)
WHERE {
  ?do nie:url <${url}> . ?ie nie:isStoredAs ?do ; nie:mimeType ?m .
  OPTIONAL { ?ie nfo:wordCount ?wc }
  OPTIONAL { ?ie nfo:pageCount ?pc }
  OPTIONAL { ?ie nie:title ?title }
  OPTIONAL { ?ie nco:creator [ nco:fullname ?author ] }
  OPTIONAL { ?ie nie:contentCreated ?created }
}`;
  const rows = parseRows(sparql(q));
  if (!rows.length) return null;
  const [mime, wc, pc, title, author, created] = rows[0].split(US);
  return { u: url, mime, wc, pc, title, author, created };
}

// Full extracted text for one url (newlines sentinel-encoded to stay one line).
function fetchText(url) {
  const q = `
SELECT (REPLACE(?t, "[\\n\\r]", "${NL}") AS ?text)
WHERE { ?do nie:url <${url}> . ?ie nie:isStoredAs ?do ; nie:plainTextContent ?t }`;
  const rows = parseRows(sparql(q));
  if (!rows.length) return "";
  return rows.join("").split(NL).join("\n");
}

// Build an AnythingLLM-shaped document JSON from TinySPARQL meta + text.
// CRITICAL: emit an identical key set across ALL docs (pageCount:0 when unknown,
// never undefined). LanceDB fixes the collection's Arrow schema from the first
// embedded doc; a later single-chunk doc that OMITS a column the schema has makes
// .add() build a malformed 0-byte Utf8 buffer and the whole insert throws
// "Need at least 4 bytes in buffers[0] in array of type Utf8".
function buildDoc(meta, text) {
  const fsPath = decodeURIComponent(meta.u.replace(/^file:\/\//, ""));
  const filename = path.basename(fsPath);
  return {
    id: crypto.randomUUID(),
    url: meta.u,
    title: meta.title || filename,
    docAuthor: meta.author || "Unknown",
    description: "Full text indexed by GNOME LocalSearch (TinySPARQL).",
    docSource: "GNOME LocalSearch (TinySPARQL) via AMAdocs hybrid bridge",
    chunkSource: "",
    published: meta.created || new Date().toISOString(),
    wordCount: meta.wc ? parseInt(meta.wc, 10) : text.split(/\s+/).length,
    pageContent: text,
    // TinySPARQL text is flat — no per-page ranges. Citation passage highlighting
    // still works (text-match in the rendered PDF); only the page-number label is lost.
    amadocsSource: "tinysparql",
    sourceMime: meta.mime,
    sourcePath: fsPath,
    pageCount: meta.pc ? parseInt(meta.pc, 10) : 0,
    token_count_estimate: Math.round(text.length / 4),
  };
}

// Write a doc JSON under storage/documents/<SUBFOLDER>/ and return the relative
// docpath (the form update-embeddings adds/deletes expect).
function writeDoc(doc) {
  const outDir = path.join(DOCS_DIR, SUBFOLDER);
  fs.mkdirSync(outDir, { recursive: true });
  const fsPath = decodeURIComponent(doc.url.replace(/^file:\/\//, ""));
  const safe = sanitize(path.basename(fsPath)) + "-" + doc.id.slice(0, 8) + ".json";
  fs.writeFileSync(path.join(outDir, safe), JSON.stringify(doc, null, 4));
  return `${SUBFOLDER}/${safe}`;
}

module.exports = {
  DBUS, US, NL, DOCS_DIR, SUBFOLDER,
  sparql, parseRows, sanitize, excludeClause,
  queryFileList, queryDocMeta, fetchMeta, fetchText, buildDoc, writeDoc,
};
