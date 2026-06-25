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

// AMAdocs: indexing PACE — the rest the worker takes between documents during summary
// generation / indexing. Each summarised doc fires one granite /generate (sustained GPU);
// on a thermally-constrained machine (e.g. an old laptop with a tired battery) a longer
// rest keeps the box cool and quiet at the cost of a slower backfill — the user's call, not
// ours. We deliberately DON'T try to auto-tune this per machine (temp watchdogs / charge
// caps are brittle across hardware); we just expose one honest knob (Homepage slider) with a
// conservative default and let the user pick. Persisted to a tiny JSON file so it survives
// relaunch and the boot resume picks it up. runSync reads it live (once per batch), so a
// slider change applies on the next sync with no restart.
const settingsFile = path.join(syncStateDir, "amadocs-settings.json");
const DEFAULT_PACE_MS = 30000; // fairly conservative: ~30s rest between summaries
const MAX_PACE_MS = 600000; // 10 min ceiling — past this a backfill is effectively paused
const clampPace = (n) =>
  Number.isFinite(n) ? Math.min(MAX_PACE_MS, Math.max(0, Math.round(n))) : null;

// Effective per-doc rest in ms. Precedence: the user's saved slider value > an explicit
// GNOME_SYNC_COOLDOWN_MS launch override (back-compat) > the conservative default.
function getPaceMs() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"))?.summaryCooldownMs;
    const c = clampPace(Number(saved));
    if (c !== null) return c;
  } catch (_) {
    /* no saved setting yet — fall through */
  }
  const env = clampPace(Number(process.env.GNOME_SYNC_COOLDOWN_MS));
  return env !== null ? env : DEFAULT_PACE_MS;
}

// Persist the user's chosen pace. Returns the clamped value actually stored.
function setPaceMs(ms) {
  const c = clampPace(Number(ms));
  if (c === null) throw new Error("pace must be a number of milliseconds");
  fs.mkdirSync(syncStateDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ summaryCooldownMs: c }, null, 2));
  return c;
}

function sparql(query) {
  const tmp = path.join(os.tmpdir(), `tsp-${crypto.randomBytes(4).toString("hex")}.rq`);
  fs.writeFileSync(tmp, query);
  try {
    return execFileSync("tinysparql", ["query", "-b", DBUS, "-f", tmp], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 512,
      // execFileSync is SYNCHRONOUS — a query that never returns would block the whole
      // Node event loop (freezing the server, not just the drain). Bound it; the caller
      // treats a throw as "no text", so the doc is skipped and retried next sync.
      timeout: Number(process.env.GNOME_SPARQL_TIMEOUT_MS) || 30000,
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

// AMAdocs: bound any async step so a hung native call (e.g. a wedged LanceDB write)
// can't freeze the serial drain forever. Rejects with a labelled error after `ms`,
// which the EXECUTE delete phase catches → logs → skips → retried next sync. The
// underlying promise is left to settle on its own; we only stop AWAITING it.
function withTimeout(promise, ms, label = "op") {
  if (!ms || ms <= 0) return promise;
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Bound for the EXECUTE delete phase (removeDocuments + summary-vector deletes). A
// single LanceDB delete that hangs (lock/conflict) would otherwise wedge the whole
// boot-resume sync holding the inFlight lock — the 2026-06-24 incident. 0 disables.
const DELETE_TIMEOUT_MS = (() => {
  const v = Number(process.env.GNOME_DELETE_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 0 ? v : 120000;
})();

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
  FILTER(STR(?t) != "")
  ${excludeClause(exclude)}
}
GROUP BY ?u
ORDER BY ?u`;
  return parseRows(sparql(q))
    .map((r) => { const [url, mtime] = r.split(US); return { url, mtime: mtime || "" }; })
    .filter((x) => x.url);
}

// File extensions GNOME's own extractors silently drop (so they end up with NO
// nie:plainTextContent) but AMAdocs' collector CAN read via its own parser/OCR:
//  • OOXML office (docx/xlsx/pptx) — the WPS-mime content-sniffing blind spot, plus
//    legacy binary office — GNOME mis-routes the extractor and stores no text.
//  • PDFs with no text layer (scanned / image-only) — GNOME does poppler text only;
//    the collector's asPDF falls back to OCR (ocrPDF).
// Images are deliberately NOT here: they're the on-demand right-click path (vision
// captioning is heavy), handled by backstopFile, not bulk folder sync.
const BACKSTOP_EXTS = [
  ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".pdf",
];

// Sibling of queryFileList for the GNOME blind spots: every file under `folder` with a
// backstop extension that has NO usable extracted text. "No usable text" = no
// nie:plainTextContent triple OR an empty-string one — GNOME sometimes stores an empty
// plainTextContent for a file it mis-routed (e.g. an .xlsx or scanned PDF), which would
// otherwise slip past queryFileList's non-empty filter AND a bare NOT EXISTS check,
// leaving the file counted-but-never-embedded. The inner FILTER(?a != "") makes the
// NOT EXISTS fire on empty text too, so the collector backstop picks these up.
// Same GROUP BY ?u + MAX(?m) double-row guard. Returns [{ url, mtime, mime }].
function queryBlindSpots({ folder, exclude }) {
  const extFilter = BACKSTOP_EXTS
    .map((e) => `STRENDS(LCASE(STR(?u)), "${e}")`)
    .join(" || ");
  const q = `
SELECT (CONCAT(STR(?u), "${US}", COALESCE(MAX(STR(?m)), ""), "${US}", COALESCE(STR(?mime), "")) AS ?row)
WHERE {
  ?ie nie:isStoredAs ?do .
  ?do nie:url ?u .
  OPTIONAL { ?do nfo:fileLastModified ?m }
  OPTIONAL { ?ie nie:mimeType ?mime }
  FILTER(STRSTARTS(STR(?u), "file://${folder}/"))
  FILTER NOT EXISTS { ?ie nie:plainTextContent ?anytext . FILTER(STR(?anytext) != "") }
  FILTER(${extFilter})
  ${excludeClause(exclude)}
}
GROUP BY ?u ?mime
ORDER BY ?u`;
  return parseRows(sparql(q))
    .map((r) => {
      const [url, mtime, mime] = r.split(US);
      return { url, mtime: mtime || "", mime: mime || "" };
    })
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

// Build an AnythingLLM-shaped document JSON from meta + text. `source` records WHO
// extracted the text: "tinysparql" (GNOME's own index, the default ride-on path) or
// "collector-backstop" (AMAdocs' own parser/OCR/vision for files GNOME couldn't read —
// docx/xlsx/pptx routing failures, scanned PDFs, images), served in place via
// doc-original's sourcePath fallback. `pages` carries the asPDF per-page char ranges
// ([{page,start,end}]) when the collector produced them (backstop PDFs); GNOME's flat
// text has none, so it stays [] and the citation chip simply shows no p.N label (the
// passage highlight still works via text-match). pages is a disk-only doc-JSON field
// read by doc-view — it is NOT part of the LanceDB metadata schema, so it can differ
// freely between docs (normal asPDF docs already mix pages-bearing + page-less docs in
// one workspace).
// CRITICAL: emit an identical LanceDB key set across ALL docs (pageCount:0 when unknown,
// never undefined). LanceDB fixes the collection's Arrow schema from the first
// embedded doc; a later single-chunk doc that OMITS a column makes .add() build a
// malformed 0-byte Utf8 buffer and the whole insert throws.
function buildDoc(meta, text, source = "tinysparql", pages = null, aiSummary = "") {
  const fsPath = decodeURIComponent(meta.u.replace(/^file:\/\//, ""));
  const filename = path.basename(fsPath);
  const backstop = source === "collector-backstop";
  return {
    id: crypto.randomUUID(),
    url: meta.u,
    title: meta.title || filename,
    docAuthor: meta.author || "Unknown",
    description: backstop
      ? "Text extracted by AMAdocs (its own parser/OCR/vision backstop)."
      : "Full text indexed by GNOME LocalSearch (TinySPARQL).",
    docSource: backstop
      ? "AMAdocs collector backstop (GNOME LocalSearch blind spot)"
      : "GNOME LocalSearch (TinySPARQL) via AMAdocs hybrid bridge",
    chunkSource: "",
    published: meta.created || new Date().toISOString(),
    wordCount: meta.wc ? parseInt(meta.wc, 10) : text.split(/\s+/).length,
    pageContent: text,
    // Per-page char ranges for the citation jump-to-page label, when available
    // (collector-backstop PDFs). [] for GNOME flat text — the passage highlight
    // still works (text-match in the rendered PDF via doc-original's sourcePath
    // fallback); only the p.N chip label is absent. Disk-only (doc-view), not Lance.
    pages: Array.isArray(pages) ? pages : [],
    // AMAdocs: the ~120-word "catalog card" gist (built from the doc's opening by the
    // local LLM). Default "" when summarising is off/failed/the text is too short, so the
    // LanceDB key set stays identical across every doc (a missing column corrupts the
    // collection's Arrow schema). Consumed by the UI summary card, the Option-A summary-
    // grounded chat (aiSummaryForPath), and — next — the per-doc summary search vector.
    aiSummary: aiSummary || "",
    amadocsSource: source,
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

// AMAdocs: per-doc "catalog card" summary on the ride-on-GNOME path. This is the GATE
// for both summary-vector breadth search AND the Option-A summary-grounded chat — without
// it the bulk-indexed corpus has no aiSummary and both are silent no-ops. Best-effort and
// already bounded: DocSummary caps input to the first ~5 pages / 8000 chars and output to
// ~120 words, and it runs one Ollama /generate per doc INSIDE the serial, GNOME_SYNC_CAP-
// bounded runSync loop, so it adds no new unbounded/parallel work (THE #1 RULE). Off
// switch: GNOME_SUMMARY_DISABLED=1. Returns "" on disable/failure/too-short input (e.g. an
// image whose short vision caption already IS its gist) so buildDoc always stores a string.
// Model resolves from SUMMARY_MODEL_PREF / OLLAMA_MODEL_PREF (granite4.1:3b on this box).
const summariesDisabled = () =>
  String(process.env.GNOME_SUMMARY_DISABLED || "") === "1";

async function summariseDoc(text, { title = "", pages = null } = {}) {
  if (summariesDisabled()) return "";
  try {
    const DocSummary = require("../DocSummary");
    const summary = await new DocSummary().summarize(text, { title, pages });
    return summary || "";
  } catch (e) {
    console.error("[gnome-sync] summary:", e.message);
    return "";
  }
}

// Build + write a doc for one url, returning its docpath (or null if no text). Async
// because it summarises the extracted text first (see summariseDoc).
async function materialize(slug, url) {
  const text = fetchText(url);
  if (!text.trim()) return null;
  const meta = fetchMeta(url);
  const title = meta.title || path.basename(decodeURIComponent(url.replace(/^file:\/\//, "")));
  const aiSummary = await summariseDoc(text, { title });
  return writeDoc(slug, buildDoc(meta, text, "tinysparql", null, aiSummary));
}

// Fallback mime by extension, for files GNOME has no node for (e.g. an image
// analysed on demand) — keeps the doc's sourceMime accurate so the UI preview
// dispatches to the right renderer.
const EXT_MIME = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".tif": "image/tiff", ".tiff": "image/tiff",
};

// A real file:// URL from an absolute path (per-segment encoded so decodeURIComponent
// in buildDoc/writeDoc round-trips back to the exact path).
function pathToFileUrl(fsPath) {
  return "file://" + fsPath.split("/").map(encodeURIComponent).join("/");
}

// Backstop materialize: for a GNOME blind-spot file (office doc, scanned PDF, image),
// run AMAdocs' OWN collector extractor over the real file IN PLACE — asDocx
// (mammoth/officeparser), asPDF (OCR fallback), or asImage (OCR + vision caption) —
// and build a doc JSON from the returned text. parseOnly+absolutePath means the
// collector never touches/trashes the user's file. Async (collector is an HTTP call).
// Returns a docpath, or null if nothing extractable (→ retried next sync, matching the
// "text vanished mid-flight" contract).
async function materializeViaCollector(slug, url) {
  const fsPath = decodeURIComponent(url.replace(/^file:\/\//, ""));
  const filename = path.basename(fsPath);
  const { CollectorApi } = require("../collectorApi");
  // Bounded so one un-parseable / OCR-stuck file can't wedge the serial drain forever
  // (returns no text → null → ABSENT → retried next sync, same as "text vanished"). Generous
  // by default (5 min) so a legitimately slow scanned-PDF OCR still completes; tune via env.
  const res = await new CollectorApi().parseDocument(filename, {
    absolutePath: fsPath,
    timeoutMs: Number(process.env.GNOME_BACKSTOP_TIMEOUT_MS) || 300000,
  });
  const doc = res?.documents?.[0];
  const text = doc?.pageContent || "";
  if (!text.trim()) return null;
  const meta = fetchMeta(url);
  meta.u = url;
  if (!meta.mime || meta.mime === "application/octet-stream")
    meta.mime = EXT_MIME[path.extname(fsPath).toLowerCase()] || meta.mime;
  // asPDF emits per-page char ranges; carry them so backstop PDFs (scanned / OCR'd /
  // empty-text) get the p.N citation label. Other extractors omit pages → buildDoc []s it.
  // Summarise from the same pages so the input cap respects real page boundaries; short
  // image OCR/caption text (< 200 chars) returns "" and the caption stays the gist.
  const aiSummary = await summariseDoc(text, {
    title: meta.title || filename,
    pages: doc?.pages,
  });
  return writeDoc(slug, buildDoc(meta, text, "collector-backstop", doc?.pages, aiSummary));
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

// List the slugs that currently have a persisted sync state — i.e. folders that have
// been indexed at least once. The cadence scheduler enumerates these to know what to
// resume/keep fresh on relaunch (each state file carries its own folder + exclude).
function listSyncedSlugs() {
  try {
    return fs
      .readdirSync(syncStateDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch (_) {
    return [];
  }
}

// AMAdocs: one in-flight sync per folder. The EXECUTE loop can run for a long time at a
// gentle indexing pace, and for most of it NO embed worker is active — so without this a
// cadence tick (which only guards on Embed.hasRunningWorker) could start a SECOND pass over
// the same folder mid-materialize: two granite loops = double GPU heat, the opposite of the
// pace knob's purpose. Held across the materialize loop; released once embedding is dispatched
// (the embed phase is then guarded by hasRunningWorker as before). THE #1 RULE.
const inFlight = new Set();

// AMAdocs: the durable "ride on GNOME" sync orchestration, extracted so BOTH the
// gnome-sync HTTP endpoint and the background cadence scheduler drive ONE code path
// (no duplicated PLAN/EXECUTE/finalize-on-confirm logic to drift apart). Mirrors the
// endpoint contract: returns { status, body } where status is the HTTP-style code the
// endpoint relays verbatim (400/503/200-dryRun/202-execute/500). THE #1 RULE lives
// here — bounded per call (GNOME_SYNC_CAP), serial worker + cool-down (the embedder),
// durable finalize-on-confirm (state never claims a file embedded before it is).
//
// opts:
//   slug, folder            (required identity + target)
//   exclude="/novels/"      SPARQL substring filter
//   limit=0                 explicit user cap (>0) → overflow recorded dormant
//   dryRun=false            read-only plan (no side effects)
//   reconcile=false         poke/restart the OS indexer first (explicit only)
//   userId=null             for Document add/remove attribution
//   fromScheduler=false     true = background cadence (do NOT clear the STOP pause)
async function runSync(opts = {}) {
  const {
    slug = null,
    folder = null,
    exclude = "/novels/",
    limit = 0,
    dryRun = false,
    reconcile = false,
    userId = null,
    fromScheduler = false,
  } = opts;

  const { Workspace } = require("../../models/workspace");
  const { Document } = require("../../models/documents");
  const Embed = require("../EmbeddingWorkerManager");

  const currWorkspace = await Workspace.get({ slug });
  if (!currWorkspace)
    return { status: 400, body: { error: "Unknown workspace." } };
  if (!folder) return { status: 400, body: { error: "Missing 'folder'." } };

  // Only poke the OS indexer when the caller explicitly asks (reconcile) — never
  // restart a system service silently. On a non-GNOME box inotify doesn't fire, so
  // this is what wakes LocalSearch + forces a re-crawl so the delta sees changes.
  if (reconcile) await ensureIndexer({ restart: true });
  if (!available())
    return {
      status: 503,
      body: {
        error:
          "GNOME LocalSearch (TinySPARQL) is not running or reachable. Start the indexer and retry.",
      },
    };

  // `current` = files GNOME extracted text for (embed that text directly) PLUS the
  // blind-spot office/PDF files GNOME dropped (re-extract via the collector backstop).
  // Tag each with its source so EXECUTE dispatches to the right materializer; the
  // delta/state machinery below is source-agnostic (keys on url + mtime + docpath).
  const textFiles = queryFileList({ folder, exclude });
  const textUrls = new Set(textFiles.map((t) => t.url));
  const blindSpots = queryBlindSpots({ folder, exclude }).filter(
    (b) => !textUrls.has(b.url)
  );
  const sourceByUrl = new Map([
    ...textFiles.map((f) => [f.url, "gnome"]),
    ...blindSpots.map((f) => [f.url, "collector"]),
  ]);
  const current = [
    ...textFiles.map((f) => ({ url: f.url, mtime: f.mtime })),
    ...blindSpots.map((f) => ({ url: f.url, mtime: f.mtime })),
  ];
  const prevState = loadState(slug);

  // ---- PLAN (no side effects, so dryRun is truly read-only) ----
  let mode;
  let toEmbed = [];
  let toDelete = [];
  let nextFiles = {};
  if (!prevState) {
    mode = "index";
    toEmbed = current;
  } else {
    mode = "sync";
    nextFiles = { ...(prevState.files || {}) };
    const { news, changed, deleted } = computeDelta(nextFiles, current);
    const changedManaged = changed.filter((c) => c.prev.docpath);
    for (const c of changed.filter((c) => !c.prev.docpath)) // dormant: refresh mtime only
      nextFiles[c.url] = { docpath: c.prev.docpath, mtime: c.mtime };
    toDelete = [
      ...changedManaged.map((c) => c.prev.docpath),
      ...deleted.map((d) => d.prev.docpath),
    ];
    toEmbed = [
      ...changedManaged.map((c) => ({ url: c.url, mtime: c.mtime })),
      ...news,
    ];
    for (const d of deleted) delete nextFiles[d.url];
  }

  // ---- RESUME materialized-but-unconfirmed docs (per-doc checkpoint recovery) ----
  // A doc marked pendingEmbed had its (expensive, GPU) summary generated + written to disk
  // in a prior pass but was interrupted before the embed was confirmed. Re-embed the SAME
  // docpath now — never re-run granite. Only resume ones still present + unchanged; a doc
  // that changed again is already in toDelete/toEmbed and gets re-materialized fresh.
  const curUrls = new Set(current.map((c) => c.url));
  const planned = new Set(toEmbed.map((e) => e.url));
  const toResume = [];
  for (const [url, e] of Object.entries(nextFiles)) {
    if (e && e.pendingEmbed && e.docpath && curUrls.has(url) && !planned.has(url))
      toResume.push({ url, mtime: e.mtime, docpath: e.docpath });
  }

  // ---- BOUND the per-call work (THE #1 RULE) ----
  let remaining = 0;
  const explicitLimit = limit > 0;
  const cap = explicitLimit ? limit : Number(process.env.GNOME_SYNC_CAP) || 200;
  if (toEmbed.length > cap) {
    const overflow = toEmbed.slice(cap);
    toEmbed = toEmbed.slice(0, cap);
    remaining = overflow.length;
    if (explicitLimit)
      for (const { url, mtime } of overflow)
        nextFiles[url] = { docpath: null, mtime }; // dormant baseline
    // no-limit overflow: intentionally NOT recorded → retried next sync.
  }

  if (dryRun)
    return {
      status: 200,
      body: {
        dryRun: true,
        mode,
        indexed: current.length,
        queued: toEmbed.length,
        deleted: toDelete.length,
        remaining,
      },
    };

  // A real (non-dryRun) run that the USER triggered is an explicit re-engagement of
  // ingest — clear any STOP-latched pause so the cadence scheduler resumes too. The
  // scheduler's own runs pass fromScheduler:true and must NOT clear it.
  if (!fromScheduler) Embed.setIngestPaused(false);

  // Serial ingest (THE #1 RULE). Bail if a pass is already materializing for this folder
  // (inFlight) OR any embed worker is still running machine-wide — the latter also closes a
  // race: the lock is released once embedding is dispatched, but a resumed doc stays
  // pendingEmbed until its embed is CONFIRMED, so a second pass entering during that window
  // could re-embed an in-flight doc (duplicate vectors). While a worker runs, no new pass
  // proceeds. A second caller backs off; the cadence just retries next tick.
  if (inFlight.has(slug) || Embed.hasRunningWorker())
    return {
      status: 409,
      body: { busy: true, error: "Indexing is already in progress." },
    };
  inFlight.add(slug);
  try {
    // ---- EXECUTE (async, durable, finalize-on-confirm) ----
    if (toDelete.length > 0) {
      // Capture sourcePaths BEFORE the docs are removed, then drop their summary cards too.
      const goneSourcePaths = toDelete
        .map((dp) => readDocMeta(dp)?.sourcePath)
        .filter(Boolean);
      // Instrumented + bounded: the 2026-06-24 incident wedged HERE (a LanceDB delete
      // froze, holding inFlight forever). Markers pin which call stalls; withTimeout
      // converts a freeze into a logged error so the drain makes forward progress.
      const t0 = Date.now();
      console.error(
        `[gnome-delete] removeDocuments START — ${toDelete.length} docs, ${goneSourcePaths.length} summary cards`
      );
      try {
        await withTimeout(
          Document.removeDocuments(currWorkspace, toDelete, userId),
          DELETE_TIMEOUT_MS,
          "removeDocuments"
        );
        console.error(
          `[gnome-delete] removeDocuments DONE in ${Date.now() - t0}ms`
        );
      } catch (err) {
        console.error(`[gnome-delete] removeDocuments FAILED: ${err.message}`);
      }
      const t1 = Date.now();
      console.error(`[gnome-delete] deleteSummaryVectors START`);
      try {
        await withTimeout(
          deleteSummaryVectors(slug, goneSourcePaths),
          DELETE_TIMEOUT_MS,
          "deleteSummaryVectors"
        );
        console.error(
          `[gnome-delete] deleteSummaryVectors DONE in ${Date.now() - t1}ms`
        );
      } catch (err) {
        console.error(
          `[gnome-delete] deleteSummaryVectors FAILED: ${err.message}`
        );
      }
    }

    // Per-doc thermal rest — the user-set indexing PACE (Homepage slider; see getPaceMs).
    // Each materialize() fires one granite /generate (the summary), which pins the GPU;
    // back-to-back over a few hundred docs is what heats a thermally-constrained box during
    // a bulk backfill. The rest between docs lets the GPU shed heat without parallelising
    // anything (still serial — THE #1 RULE). The actual rest is read LIVE inside the loop
    // below (once per doc) so a slider change applies on the very next file — not just the
    // next batch (a 200-doc batch is ~40min, far too long to wait). Disabled when summaries
    // are off (no GPU work to pace).
    const paceDisabled = summariesDisabled();

    const persist = () =>
      saveState(slug, {
        folder,
        exclude,
        slug,
        lastSync: new Date().toISOString(),
        files: nextFiles,
      });

    const pending = new Map();
    const adds = [];

    // Resume docs whose summary was already generated last pass (embed-only, no granite).
    for (const { url, mtime, docpath } of toResume) {
      adds.push(docpath);
      pending.set(docpath, { url, mtime });
    }

    // AMAdocs diag (2026-06-24 recovery): pin where the drain stalls — loop sizes +
    // source breakdown, then a per-doc result marker for the first several docs.
    const collectorN = toEmbed.filter((e) => sourceByUrl.get(e.url) === "collector").length;
    console.error(
      `[gnome-drain] loop START — toEmbed=${toEmbed.length} (collector=${collectorN}, gnome=${toEmbed.length - collectorN}), toResume=${toResume.length}, paused=${Embed.isIngestPaused()}`
    );
    let _di = 0;
    for (const { url, mtime } of toEmbed) {
      _di++;
      const _diag = _di <= 6;
      if (_diag)
        console.error(
          `[gnome-drain] doc ${_di}/${toEmbed.length} src=${sourceByUrl.get(url) || "gnome"} ${url.slice(-70)}`
        );
      // Hard STOP mid-pass: halt granite immediately (a long pace makes this loop long-lived,
      // so without this check STOP would keep summarising for the rest of the batch). Already-
      // materialized docs are checkpointed below, so they resume cleanly on the next sync.
      if (Embed.isIngestPaused()) break;
      // GNOME-text files read their extracted text directly; blind spots go through the
      // collector backstop (its own parser/OCR). Source is resolved from the current
      // listing (defaults to gnome for delta items whose source map entry is present).
      // Per-doc try/catch: a SINGLE bad file (hung/failed parse, throwing query) must never
      // abort or wedge the serial drain — skip it (left ABSENT → retried next sync) and move
      // on. Combined with the bounded collector/sparql timeouts, the drain always makes
      // forward progress.
      let docpath = null;
      try {
        docpath =
          sourceByUrl.get(url) === "collector"
            ? await materializeViaCollector(slug, url)
            : await materialize(slug, url);
      } catch (err) {
        console.error(`[gnome-sync] materialize failed for ${url}:`, err.message);
      }
      if (_diag)
        console.error(
          `[gnome-drain] doc ${_di} result: ${docpath ? "materialized" : "NULL (empty/unextractable text)"}`
        );
      if (docpath) {
        adds.push(docpath);
        pending.set(docpath, { url, mtime });
        // CHECKPOINT the expensive summary the instant it's written: record the doc as
        // pendingEmbed so an interruption before the embed is confirmed re-embeds THIS
        // docpath next pass instead of re-running granite. Cleared to a plain done-entry in
        // onDocComplete. This is what makes GNOME_SYNC_CAP irrelevant to durability, so the
        // user only ever needs the one pace knob.
        nextFiles[url] = { docpath, mtime, pendingEmbed: true };
        try {
          persist();
        } catch (err) {
          console.error("[gnome-sync] persist:", err.message);
        }
        // Read the pace LIVE here so the Homepage slider takes effect on the next file.
        const docCooldownMs = paceDisabled ? 0 : getPaceMs();
        if (docCooldownMs) await sleep(docCooldownMs); // rest only after real GPU work
      }
      // else: text vanished / not extractable — leave ABSENT so it's retried next sync.
    }

    persist(); // persist deletions / dormant refreshes even if nothing materialized

    // If STOP arrived during the loop, do NOT dispatch a fresh embed worker (it would defeat
    // the kill switch). The materialized docs stay pendingEmbed and resume on the next sync.
    const paused = Embed.isIngestPaused();

    if (adds.length > 0 && !paused && Embed.isNativeEmbedder()) {
      await Embed.embedFiles(currWorkspace.slug, adds, currWorkspace.id, userId, {
        onDocComplete: (docpath) => {
          const e = pending.get(docpath);
          if (!e) return;
          nextFiles[e.url] = { docpath, mtime: e.mtime }; // confirmed → drop pendingEmbed
          try {
            persist();
          } catch (err) {
            console.error("[gnome-sync] persist:", err.message);
          }
        },
        onComplete: () => {
          try {
            persist();
          } catch (err) {
            console.error("[gnome-sync] persist:", err.message);
          }
        },
      });
    } else if (adds.length > 0 && !paused) {
      await Document.addDocuments(currWorkspace, adds, userId);
      for (const [docpath, e] of pending)
        nextFiles[e.url] = { docpath, mtime: e.mtime };
      persist();
    }

    // Mirror the freshly-embedded docs into the summary-vector table (breadth search).
    if (adds.length > 0 && !paused) await upsertSummaryVectors(slug, adds);

    return {
      status: 202,
      body: {
        mode,
        indexed: current.length,
        queued: adds.length,
        deleted: toDelete.length,
        remaining,
        tracked: Object.keys(nextFiles).length,
      },
    };
  } finally {
    inFlight.delete(slug);
  }
}

// AMAdocs: on-demand single-file backstop for the right-click "analyse with AI" action.
// Runs the collector extractor over ONE file and embeds it — the path that makes images
// and image-only PDFs indexable without a folder sync (bulk sync excludes images as too
// heavy). User-driven, so it clears the STOP pause like an explicit runSync. If the file
// lives inside an already-synced folder AND is an office/PDF type (i.e. it would later
// show up in that folder's blind-spot listing), it's recorded in the folder state with
// its mtime so the cadence delta treats it as known — never re-embedding it, and never
// (for images, deliberately NOT recorded) mistaking a standalone analysis for a deletion.
async function backstopFile(slug, fsPath, { userId = null } = {}) {
  const { Workspace } = require("../../models/workspace");
  const { Document } = require("../../models/documents");
  const Embed = require("../EmbeddingWorkerManager");

  const currWorkspace = await Workspace.get({ slug });
  if (!currWorkspace) return { ok: false, error: "Unknown workspace." };
  if (!fsPath || typeof fsPath !== "string")
    return { ok: false, error: "Missing 'path'." };
  try {
    if (!fs.statSync(fsPath).isFile()) return { ok: false, error: "Not a file." };
  } catch (_) {
    return { ok: false, error: "File not found." };
  }

  Embed.setIngestPaused(false); // explicit user re-engagement of ingest

  // Idempotent by sourcePath: drop any doc already embedded for this exact file
  // (a prior right-click analysis, or a copy the folder sync/cadence embedded) so
  // re-analysing never leaves duplicate vectors for one on-disk file.
  try {
    const existing = await Document.forWorkspace(currWorkspace.id);
    const dupes = (existing || [])
      .filter((d) => {
        try { return JSON.parse(d.metadata || "{}").sourcePath === fsPath; }
        catch (_) { return false; }
      })
      .map((d) => d.docpath)
      .filter(Boolean);
    if (dupes.length)
      await Document.removeDocuments(currWorkspace, dupes, userId);
  } catch (e) {
    console.error("[analyse-file] dedupe:", e.message);
  }

  const url = pathToFileUrl(fsPath);
  const docpath = await materializeViaCollector(slug, url);
  if (!docpath)
    return {
      ok: false,
      error: "Could not extract any text or caption from this file.",
    };

  if (Embed.isNativeEmbedder())
    await Embed.embedFiles(currWorkspace.slug, [docpath], currWorkspace.id, userId, {});
  else await Document.addDocuments(currWorkspace, [docpath], userId);

  // Refresh this file's summary card (idempotent by sourcePath → replaces any deduped one).
  await upsertSummaryVectors(slug, [docpath]);

  const ext = path.extname(fsPath).toLowerCase();
  const state = loadState(slug);
  if (
    state &&
    state.folder &&
    fsPath.startsWith(state.folder + "/") &&
    BACKSTOP_EXTS.includes(ext)
  ) {
    let mtime = "";
    try {
      mtime = new Date(fs.statSync(fsPath).mtime).toISOString();
    } catch (_) {}
    state.files = state.files || {};
    state.files[url] = { docpath, mtime };
    saveState(slug, state);
  }

  return { ok: true, docpath };
}

// AMAdocs: read a stored gnome doc JSON and report whether it carries a real aiSummary.
// Best-effort — a missing/unreadable doc counts as "no summary" so it gets re-processed.
function docHasSummary(docpath) {
  try {
    const doc = JSON.parse(
      fs.readFileSync(path.join(documentsPath, docpath), "utf8")
    );
    return typeof doc.aiSummary === "string" && doc.aiSummary.trim().length > 0;
  } catch (_) {
    return false;
  }
}

// AMAdocs (summary-search): read the fields the summary-vector table needs from a stored
// gnome doc JSON. Best-effort — returns null on any read/parse failure.
function readDocMeta(docpath) {
  try {
    const doc = JSON.parse(
      fs.readFileSync(path.join(documentsPath, docpath), "utf8")
    );
    return {
      sourcePath: doc.sourcePath || "",
      aiSummary: typeof doc.aiSummary === "string" ? doc.aiSummary : "",
      title: doc.title || "",
      amadocsSource: doc.amadocsSource || "",
      sourceMime: doc.sourceMime || "",
      pageCount: doc.pageCount || 0,
    };
  } catch (_) {
    return null;
  }
}

// AMAdocs (summary-search): keep the per-document summary-vector table ("<slug>__summaries")
// in lockstep with the chunk embeds/deletes on the gnome-sync path so breadth (folder/drive)
// chat searches a current set of cards. Embeds-only (NativeEmbedder) and best-effort — a
// failure here is logged and never breaks ingest (THE #1 RULE: still serial, no new worker).
async function upsertSummaryVectors(slug, docpaths = []) {
  if (summariesDisabled() || !docpaths.length) return;
  try {
    const { getVectorDbClass } = require("../helpers");
    const VectorDb = getVectorDbClass();
    if (typeof VectorDb.upsertSummaryVector !== "function") return;
    for (const dp of docpaths) {
      const m = readDocMeta(dp);
      if (!m || !m.sourcePath || !m.aiSummary.trim()) continue;
      await VectorDb.upsertSummaryVector({ namespace: slug, ...m });
    }
  } catch (e) {
    console.error("[gnome-sync] summary-vector upsert:", e.message);
  }
}

async function deleteSummaryVectors(slug, sourcePaths = []) {
  if (!sourcePaths.length) return;
  try {
    const { getVectorDbClass } = require("../helpers");
    const VectorDb = getVectorDbClass();
    if (typeof VectorDb.deleteSummaryVector !== "function") return;
    let i = 0;
    for (const sp of sourcePaths) {
      i++;
      if (!sp) continue;
      // Per-iteration marker + per-call bound: pins which card delete stalls and stops
      // one wedged LanceDB write from hanging the whole loop (2026-06-24 incident).
      const t = Date.now();
      await withTimeout(
        VectorDb.deleteSummaryVector({ namespace: slug, sourcePath: sp }),
        DELETE_TIMEOUT_MS,
        `deleteSummaryVector[${i}/${sourcePaths.length}]`
      );
      const dt = Date.now() - t;
      if (dt > 2000)
        console.error(
          `[gnome-delete] slow summary delete ${i}/${sourcePaths.length} (${dt}ms): ${sp}`
        );
    }
  } catch (e) {
    console.error("[gnome-sync] summary-vector delete:", e.message);
  }
}

// AMAdocs: "Re-summarise" — force the granite summary step to re-run over already-indexed
// files. The mtime-based delta (computeDelta) only re-selects NEW or CHANGED files, so a file
// indexed before summaries-by-default (or before a summary prompt/model change) is invisible
// to the cadence and would never (re)gain a summary on its own — the typical user never hits
// this (they index on a summaries-by-default build), but anyone who indexed with
// GNOME_SUMMARY_DISABLED=1 first, or who later changes the summary prompt/model, does.
// This stamps the SAVED mtime to "" for the matching tracked files, which makes the next
// runSync treat them as "changed" → delete-old + re-embed + re-summarise through the EXACT
// same serial / capped (GNOME_SYNC_CAP) / cooled-down (GNOME_SYNC_COOLDOWN_MS) / durable path
// as the backfill — no new ingest machinery, THE #1 RULE intact. It does NOT embed; the caller
// drives runSync, and the background cadence drains whatever exceeds one bounded pass.
//   onlyMissing=true  → stamp only files whose stored doc has an EMPTY aiSummary (backfill
//                       the gaps). false → ALL tracked files (e.g. after changing the prompt).
// Returns { ok, flipped, total } (or { ok:false, error } when summaries are off / no state).
function resummarize(slug, { onlyMissing = true } = {}) {
  if (summariesDisabled())
    return { ok: false, error: "Summaries are disabled (GNOME_SUMMARY_DISABLED=1)." };
  const state = loadState(slug);
  if (!state || !state.files || !Object.keys(state.files).length)
    return { ok: false, error: "This folder has not been indexed yet." };

  let flipped = 0;
  let total = 0;
  for (const [url, e] of Object.entries(state.files)) {
    if (!e || !e.docpath) continue; // only files actually embedded can be re-summarised
    total++;
    if (onlyMissing && docHasSummary(e.docpath)) continue;
    if (!e.mtime) continue; // already stamped (a prior resummarize still pending) — leave it
    state.files[url] = { ...e, mtime: "" }; // force computeDelta → "changed"
    flipped++;
  }
  if (flipped > 0) saveState(slug, state);
  return { ok: true, flipped, total };
}

// AMAdocs (Homepage): per-folder summary progress. Counts tracked (embedded) files, how many
// carry a real aiSummary, and how many are still QUEUED for one (stamped mtime="" or pendingEmbed
// — i.e. the backfill/cadence hasn't reached or confirmed them yet). Best-effort and LIVE: it
// reads each tracked doc JSON via docHasSummary, so the number climbs as a backfill drains. A
// file with no summary that ISN'T queued (indexed while summaries were off, never re-stamped)
// shows up only in the total/summarised gap — it needs a 🧠 Re-summarise click to enqueue.
function summaryStats(slug) {
  const out = { total: 0, summarised: 0, queued: 0 };
  const state = loadState(slug);
  if (!state || !state.files) return out;
  for (const e of Object.values(state.files)) {
    if (!e || !e.docpath) continue; // only embedded files can carry a summary
    out.total++;
    if (docHasSummary(e.docpath)) out.summarised++;
    else if (!e.mtime || e.pendingEmbed) out.queued++;
  }
  return out;
}

module.exports = {
  available, ensureIndexer, queryFileList, queryBlindSpots, fetchMeta, fetchText,
  buildDoc, writeDoc, materialize, materializeViaCollector, pathToFileUrl,
  loadState, saveState, computeDelta, docSubfolder,
  listSyncedSlugs, runSync, backstopFile, resummarize, summaryStats,
  getPaceMs, setPaceMs,
};
