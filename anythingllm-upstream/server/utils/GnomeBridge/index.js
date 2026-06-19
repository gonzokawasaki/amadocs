// AMAdocs: GNOME LocalSearch (TinySPARQL) bridge — server-side.
//
// The "ride on GNOME" hybrid: read the full text + metadata that GNOME's desktop
// indexer (LocalSearch, stored in TinySPARQL) already extracted, and turn it into
// AnythingLLM-shaped document JSONs the engine can embed — so AMAdocs adds a
// semantic/citation layer on top of the OS index WITHOUT re-parsing files itself.
//
// This is the productionized counterpart of tooling/tinysparql-bridge.js +
// tinysparql-sync.js: the same query/build logic, living inside the server so the
// gnome-index / gnome-sync endpoints (and ultimately the app UI) can drive it.
//
// Talks to the LIVE LocalSearch daemon over D-Bus (the on-disk meta.db is WAL-locked
// by the daemon, so a standalone endpoint sees an empty view — D-Bus is the way).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const DBUS = "org.freedesktop.LocalSearch3";
const US = "\u001F"; // field delimiter (U+001F unit separator; never in document text)
const NL = "\u241B"; // newline sentinel; keeps each result row on one physical line

const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, `../../storage/documents`)
    : path.resolve(process.env.STORAGE_DIR, `documents`);

const syncStateDir =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, `../../storage/gnome-sync`)
    : path.resolve(process.env.STORAGE_DIR, `gnome-sync`);

// Per-workspace folder under storage/documents and per-workspace sync-state file,
// so indexing two workspaces from two folders never collide.
const docSubfolder = (slug) => `gnome-${slug}`;
const stateFile = (slug) => path.join(syncStateDir, `${slug}.json`);

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

function parseRows(out) {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.trim() === "Results:");
  if (i < 0) return [];
  return lines.slice(i + 1).filter((l) => l.startsWith("  ")).map((l) => l.slice(2));
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function excludeClause(exclude) {
  return exclude
    ? `FILTER(!CONTAINS(STR(?u), "${String(exclude).replace(/"/g, '\\"')}"))`
    : "";
}

// Is the LocalSearch daemon reachable? (so the endpoint can give a clean error
// instead of a 500 when GNOME's indexer isn't running.)
function available() {
  try {
    sparql("SELECT ?s WHERE { ?s a rdfs:Resource } LIMIT 1");
    return true;
  } catch (_) {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ensure the OS indexer is running (and, on `restart`, has re-crawled). On a
// non-GNOME desktop LocalSearch is installed but dormant, and even when running its
// inotify monitors don't fire outside a real GNOME session — so picking up new/
// changed/deleted files needs an explicit start/restart + reconcile crawl. This runs
// the documented systemctl --user dance and polls until the daemon answers.
//
// CALLER GATING (deliberate, per [[k-base-ingest-safety]]): never auto-poke silently.
// The endpoint only calls this when the UI passes `reconcile:true` (e.g. an explicit
// "Re-index" / "Check for changes" button), so we don't restart a system service
// behind the user's back. Degrades to whatever available() reports on any failure.
// @returns {Promise<boolean>} whether the daemon is reachable afterwards
async function ensureIndexer({ restart = false } = {}) {
  if (available() && !restart) return true;
  try {
    execFileSync("systemctl", [
      "--user",
      "set-environment",
      "XDG_SESSION_CLASS=user",
    ]);
    execFileSync("systemctl", [
      "--user",
      restart ? "restart" : "start",
      "localsearch-3.service",
    ]);
  } catch (_) {
    return available();
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (available()) return true;
    await sleep(500);
  }
  return available();
}

// Lightweight listing for delta diffing: every file under `folder` that HAS
// extracted text, with its newest last-modified time. GROUP BY ?u + MAX(?m)
// because nfo:fileLastModified is stored with two (identical) values per file,
// which would otherwise double every row. Returns [{ url, mtime }].
function queryFileList({ folder, exclude }) {
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

// Metadata for a single url (mime/wordCount/pageCount/title/author/created).
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
  if (!rows.length) return { u: url, mime: "application/octet-stream", wc: "", pc: "", title: "", author: "", created: "" };
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
// embedded doc; a later single-chunk doc that OMITS a column makes .add() build a
// malformed 0-byte Utf8 buffer and the whole insert throws.
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
    // still works (text-match in the rendered PDF, served via doc-original's
    // sourcePath fallback); only the page-number chip label is unavailable.
    amadocsSource: "tinysparql",
    sourceMime: meta.mime,
    sourcePath: fsPath,
    pageCount: meta.pc ? parseInt(meta.pc, 10) : 0,
    token_count_estimate: Math.round(text.length / 4),
  };
}

// Write a doc JSON under storage/documents/gnome-<slug>/ and return its docpath
// (relative — the form addDocuments/removeDocuments expect).
function writeDoc(slug, doc) {
  const sub = docSubfolder(slug);
  const outDir = path.join(documentsPath, sub);
  fs.mkdirSync(outDir, { recursive: true });
  const fsPath = decodeURIComponent(doc.url.replace(/^file:\/\//, ""));
  const safe = sanitize(path.basename(fsPath)) + "-" + doc.id.slice(0, 8) + ".json";
  fs.writeFileSync(path.join(outDir, safe), JSON.stringify(doc, null, 4));
  return `${sub}/${safe}`;
}

// Build + write a doc for one url, returning its docpath (or null if no text).
function materialize(slug, url) {
  const text = fetchText(url);
  if (!text.trim()) return null;
  return writeDoc(slug, buildDoc(fetchMeta(url), text));
}

function loadState(slug) {
  try { return JSON.parse(fs.readFileSync(stateFile(slug), "utf8")); }
  catch (_) { return null; }
}

function saveState(slug, state) {
  fs.mkdirSync(syncStateDir, { recursive: true });
  fs.writeFileSync(stateFile(slug), JSON.stringify(state, null, 2));
}

const newer = (a, b) => {
  if (!a) return false; if (!b) return true;
  const da = Date.parse(a), db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return a > b;
  return da > db;
};

// Diff the current index listing against saved state → {news, changed, deleted}.
function computeDelta(stateFiles, current) {
  const curByUrl = new Map(current.map((c) => [c.url, c.mtime]));
  const news = [], changed = [], deleted = [];
  for (const { url, mtime } of current) {
    const prev = stateFiles[url];
    if (!prev) news.push({ url, mtime });
    else if (newer(mtime, prev.mtime)) changed.push({ url, mtime, prev });
  }
  for (const url of Object.keys(stateFiles)) {
    if (!curByUrl.has(url) && stateFiles[url].docpath) deleted.push({ url, prev: stateFiles[url] });
  }
  return { news, changed, deleted };
}

module.exports = {
  available, ensureIndexer, queryFileList, fetchMeta, fetchText, buildDoc, writeDoc,
  materialize, loadState, saveState, computeDelta, docSubfolder,
};
