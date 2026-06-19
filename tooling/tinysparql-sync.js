#!/usr/bin/env node
// AMAdocs: TinySPARQL → AMAdocs INCREMENTAL delta-sync ("ride on GNOME", stay fresh).
//
// Keeps a workspace's embeddings in step with what GNOME LocalSearch has indexed,
// WITHOUT re-embedding the whole corpus. GNOME keeps its own store live via inotify
// (enable-monitors) and stamps every file with nfo:fileLastModified; we diff that
// against a small local state file and re-embed only NEW / CHANGED files (and drop
// DELETED ones). Cost scales with CHANGES, not corpus size.
//
//   NEW      file in the index, not in our state            -> embed (add)
//   CHANGED  managed file whose mtime advanced              -> re-embed (delete old + add new)
//   DELETED  managed file no longer in the index            -> drop (delete)
//
// Usage:
//   node tooling/tinysparql-sync.js <workspace-slug> [folder]
//     env EXCLUDE   skip files whose URL contains this (default "/novels/")
//     env ENGINE    engine base URL (default http://127.0.0.1:3001)
//     env STATE     state file path (default tooling/tinysparql-sync-state.<slug>.json)
//     env SYNC_NEW  "0" to NOT embed brand-new files, only track changes/deletes of
//                   the already-embedded set (default "1" = embed new files too)
//     env DRY_RUN   "1" to print the plan and exit without writing/embedding
//
// FIRST RUN bootstraps a baseline from the live workspace + current index mtimes and
// does NOT embed anything (it adopts whatever is already embedded; all other indexed
// files are recorded as a dormant baseline so they aren't seen as "new" later).

const fs = require("fs");
const path = require("path");
const lib = require("./lib/tinysparql-lib");

const SLUG = process.argv[2];
const FOLDER = process.argv[3] || "/mnt/space/teaching_docs";
const EXCLUDE = process.env.EXCLUDE !== undefined ? process.env.EXCLUDE : "/novels/";
const ENGINE = process.env.ENGINE || "http://127.0.0.1:3001";
const SYNC_NEW = process.env.SYNC_NEW !== "0";
const DRY_RUN = process.env.DRY_RUN === "1";
const STATE = process.env.STATE || path.resolve(__dirname, `tinysparql-sync-state.${SLUG}.json`);

if (!SLUG) { console.error("usage: node tinysparql-sync.js <workspace-slug> [folder]"); process.exit(1); }

const newer = (a, b) => { // is mtime a strictly newer than b? (ISO strings)
  if (!a) return false; if (!b) return true;
  const da = Date.parse(a), db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return a > b; // fall back to lexical
  return da > db;
};

async function api(pathname, body) {
  const res = await fetch(`${ENGINE}${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

async function listWorkspaceDocs() {
  const res = await fetch(`${ENGINE}/api/workspace/${SLUG}`);
  if (!res.ok) throw new Error(`GET /workspace/${SLUG} -> HTTP ${res.status}`);
  const docs = ((await res.json()).workspace || {}).documents || [];
  // map source url -> docpath, via each doc's embedded metadata
  const byUrl = {};
  for (const d of docs) {
    let md = {}; try { md = JSON.parse(d.metadata || "{}"); } catch {}
    if (md.url) byUrl[md.url] = d.docpath;
  }
  return byUrl;
}

(async () => {
  const current = lib.queryFileList({ folder: FOLDER, exclude: EXCLUDE }); // [{url, mtime}]
  const curByUrl = new Map(current.map((c) => [c.url, c.mtime]));
  console.log(`[sync] index has ${current.length} files with text under ${FOLDER}`);

  // ---- bootstrap: no state yet ----
  if (!fs.existsSync(STATE)) {
    const wsDocs = await listWorkspaceDocs();
    const files = {};
    let managed = 0;
    for (const { url, mtime } of current) {
      const docpath = wsDocs[url] || null;
      if (docpath) managed++;
      files[url] = { docpath, mtime };
    }
    const state = { folder: FOLDER, exclude: EXCLUDE, slug: SLUG, lastSync: new Date().toISOString(), files };
    if (!DRY_RUN) fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(`[sync] BOOTSTRAP: baselined ${current.length} indexed files (${managed} already embedded). No re-embed. State -> ${STATE}`);
    return;
  }

  // ---- delta against existing state ----
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const files = state.files || {};

  const news = [], changed = [], deleted = [];
  for (const { url, mtime } of current) {
    const prev = files[url];
    if (!prev) news.push({ url, mtime });
    else if (newer(mtime, prev.mtime)) changed.push({ url, mtime, prev });
  }
  for (const url of Object.keys(files)) {
    if (!curByUrl.has(url) && files[url].docpath) deleted.push({ url, prev: files[url] });
  }

  // CHANGED only matters for files we actually embedded (have a docpath); a changed
  // file we never embedded just gets its mtime refreshed in state.
  const changedManaged = changed.filter((c) => c.prev.docpath);
  const changedDormant = changed.filter((c) => !c.prev.docpath);

  console.log(`[sync] plan: ${news.length} new, ${changedManaged.length} changed(managed), ${deleted.length} deleted` +
    (SYNC_NEW ? "" : "  [SYNC_NEW=0: new files tracked but NOT embedded]") +
    (changedDormant.length ? `  (+${changedDormant.length} changed-but-unembedded, mtime refreshed only)` : ""));

  if (DRY_RUN) {
    for (const x of news) console.log(`  NEW      ${x.url}`);
    for (const x of changedManaged) console.log(`  CHANGED  ${x.url}`);
    for (const x of deleted) console.log(`  DELETED  ${x.url}`);
    console.log("[sync] DRY_RUN — nothing written or embedded.");
    return;
  }

  const adds = [], deletes = [];
  const nextFiles = { ...files };

  // CHANGED managed: delete old vectors, embed fresh (new docpath -> new vector-cache key).
  for (const c of changedManaged) {
    deletes.push(c.prev.docpath);
    const text = lib.fetchText(c.url);
    if (!text.trim()) { // text vanished -> treat as delete
      delete nextFiles[c.url];
      continue;
    }
    const docpath = lib.writeDoc(lib.buildDoc(lib.fetchMeta(c.url), text));
    adds.push(docpath);
    nextFiles[c.url] = { docpath, mtime: c.mtime };
  }
  // CHANGED dormant: just refresh mtime.
  for (const c of changedDormant) nextFiles[c.url] = { docpath: c.prev.docpath, mtime: c.mtime };

  // NEW: embed (or, with SYNC_NEW=0, just baseline).
  for (const x of news) {
    if (!SYNC_NEW) { nextFiles[x.url] = { docpath: null, mtime: x.mtime }; continue; }
    const text = lib.fetchText(x.url);
    if (!text.trim()) { nextFiles[x.url] = { docpath: null, mtime: x.mtime }; continue; }
    const docpath = lib.writeDoc(lib.buildDoc(lib.fetchMeta(x.url), text));
    adds.push(docpath);
    nextFiles[x.url] = { docpath, mtime: x.mtime };
  }

  // DELETED: drop vectors + state entry.
  for (const d of deleted) { deletes.push(d.prev.docpath); delete nextFiles[d.url]; }

  if (adds.length || deletes.length) {
    await api(`/api/workspace/${SLUG}/update-embeddings`, { adds, deletes });
    console.log(`[sync] posted update-embeddings: +${adds.length} adds, -${deletes.length} deletes`);
  } else {
    console.log(`[sync] nothing to embed or delete.`);
  }

  state.files = nextFiles;
  state.lastSync = new Date().toISOString();
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(`[sync] state updated (${Object.keys(nextFiles).length} tracked files).`);
})().catch((e) => { console.error("[sync] ERROR:", e.message); process.exit(1); });
