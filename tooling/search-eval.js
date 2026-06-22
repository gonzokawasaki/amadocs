/* AMAdocs search-eval harness (promoted from server/_sumtest2.js).
 *
 * Measures FOLDER-scope retrieval quality against a hand-labeled gold set (Recall@5 / MRR)
 * across four strategies:
 *   A chunk   — doc-level ranking over full-text CHUNK vectors (the pre-redesign behaviour)
 *   B summary — the NEW per-document SUMMARY-vector path, via the REAL db.summarySearch()
 *   L lexBM25 — BM25 over title+summary (lexical recall safety net)
 *   F fusion  — RRF(summary, lexical)
 *
 * Unlike the old script, B exercises the production LanceDb.summarySearch() against the live
 * "<slug>__summaries" table — so a good number here is a good number in the app. Run it from
 * the repo root (or anywhere); it resolves the server dir itself:
 *
 *   STORAGE_DIR=…/anythingllm-upstream/server/storage \
 *     node tooling/search-eval.js
 *
 * Tunables (env): THRESH (similarityThreshold, default 0.25), TOPN (summary topN, default 25),
 *   K_RRF (default 60). Gold set is the /STEM eval folder (7 labelled queries).
 */
const fs = require("fs");
const path = require("path");

const SERVER = path.resolve(__dirname, "../anythingllm-upstream/server");
if (!process.env.STORAGE_DIR)
  process.env.STORAGE_DIR = path.join(SERVER, "storage");

const { NativeEmbedder } = require(path.join(
  SERVER,
  "utils/EmbeddingEngines/native"
));
const { LanceDb } = require(path.join(
  SERVER,
  "utils/vectorDbProviders/lance"
));

const SLUG = process.env.SLUG || "amadocs-library";
const FOLDER = "/STEM/";
const DOCDIR = path.join(SERVER, "storage/documents/gnome-amadocs-library");
const THRESH = Number(process.env.THRESH) || 0.25;
const TOPN = Number(process.env.TOPN) || 25;
const K_RRF = Number(process.env.K_RRF) || 60;
const SHOW = 6;

// query -> hand-labeled relevant filenames (the "gold" answer)
const GOLD = {
  "machine learning": ["crest-silver-machine-learning-collection.pdf"],
  "build a pinhole camera": ["crest-gold-build-a-pinhole-camera.pdf"],
  "assessment criteria for grading student work": [
    "Assessment_Criteria_Breakdown.docx",
    "Skills_Table.docx",
    "assessment criteria STEM secondary.docx",
  ],
  "game controller design project": [
    "crest-bronze-design-a-game-controller.pdf",
    "Grade810_GameDesign_Assessment_SISVT.docx",
  ],
  microbit: [
    "Grade810_MicrobitRCCar_Assessment_SISVT.docx",
    "microbit and electronics.pptx",
  ],
  waltzer: ["crest-gold-build-a-model-waltzer.pdf"],
  skateboard: ["crest-gold-make-a-skateboard.pdf"],
};

const cos = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};
const norm = (v) => {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return v.map((x) => x / s);
};
const base = (p) => (p || "").split("/").pop();
const tok = (s) =>
  (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1);

function buildBM25(docs) {
  const k1 = 1.5,
    b = 0.75;
  const docTok = docs.map((d) => tok(d.name + " " + d.lexBody));
  const dl = docTok.map((t) => t.length);
  const avgdl = dl.reduce((a, c) => a + c, 0) / (dl.length || 1);
  const df = new Map();
  docTok.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const N = docs.length;
  const tf = docTok.map((t) => {
    const m = new Map();
    t.forEach((w) => m.set(w, (m.get(w) || 0) + 1));
    return m;
  });
  return (query) => {
    const q = tok(query);
    return docs
      .map((d, i) => {
        let score = 0;
        for (const w of q) {
          const f = tf[i].get(w);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
          score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * dl[i]) / avgdl));
        }
        return { name: d.name, score };
      })
      .sort((a, b) => b.score - a.score);
  };
}

function rrf(...lists) {
  const acc = new Map();
  for (const list of lists)
    list.forEach((item, i) =>
      acc.set(item.name, (acc.get(item.name) || 0) + 1 / (K_RRF + i + 1))
    );
  return [...acc.entries()]
    .map(([name, rrf]) => ({ name, rrf }))
    .sort((a, b) => b.rrf - a.rrf);
}

function score(ranked, gold) {
  const names = ranked.map((r) => r.name);
  const top5 = names.slice(0, 5);
  const hit = gold.filter((g) => top5.includes(g)).length;
  const recall = gold.length ? hit / gold.length : 0;
  let rr = 0;
  for (let i = 0; i < names.length; i++)
    if (gold.includes(names[i])) {
      rr = 1 / (i + 1);
      break;
    }
  return { recall, rr };
}
const distinct = (arr) => {
  const seen = new Set(),
    out = [];
  for (const x of arr)
    if (!seen.has(x.name)) {
      seen.add(x.name);
      out.push(x);
    }
  return out;
};

(async () => {
  const embedder = new NativeEmbedder();
  const db = new LanceDb();

  // --- lexical corpus: title+summary per STEM doc (from on-disk doc JSON) ---
  const byPath = new Map();
  for (const f of fs.readdirSync(DOCDIR)) {
    if (!f.endsWith(".json")) continue;
    let d;
    try {
      d = JSON.parse(fs.readFileSync(`${DOCDIR}/${f}`, "utf8"));
    } catch {
      continue;
    }
    if (!(d.sourcePath || "").includes(FOLDER)) continue;
    const summary = String(d.aiSummary || "").trim();
    if (!summary) continue;
    byPath.set(d.sourcePath, {
      name: base(d.sourcePath),
      lexBody: `${d.title || ""} ${summary}`,
    });
  }
  const lexDocs = [...byPath.values()];
  const bm25 = buildBM25(lexDocs);

  // folder prefix for production summarySearch scope (mirror the app's folder scope)
  const stemPrefix = [...byPath.keys()][0].split(FOLDER)[0] + FOLDER;

  // chunk vectors (doc-level ceiling: best chunk per doc), straight from the table
  const { client: dbc } = await db.connect();
  const tbl = await dbc.openTable(SLUG);
  const vrows = await tbl.query().limit(200000).toArray();
  const chunks = vrows
    .filter((r) => (r.sourcePath || "").includes(FOLDER))
    .map((r) => ({ name: base(r.sourcePath), vec: norm(Array.from(r.vector)) }));

  console.log(
    `STEM docs(summarised)=${lexDocs.length}  chunk-vectors=${chunks.length}  ` +
      `THRESH=${THRESH} TOPN=${TOPN} K_RRF=${K_RRF}\n`
  );
  const agg = { A: [], B: [], L: [], F: [] };

  for (const q of Object.keys(GOLD)) {
    const qv = norm(await embedder.embedTextInput(q));

    // A: doc-level chunk ranking (best chunk per doc)
    const A = distinct(
      chunks
        .map((c) => ({ name: c.name, sim: cos(qv, c.vec) }))
        .filter((c) => c.sim >= THRESH)
        .sort((a, b) => b.sim - a.sim)
    );

    // B: REAL production summary search
    const res = await db.summarySearch({
      namespace: SLUG,
      input: q,
      LLMConnector: embedder,
      similarityThreshold: THRESH,
      topN: TOPN,
      scopePath: stemPrefix,
    });
    const B = res.sources.map((s) => ({ name: base(s.sourcePath), sim: s.score }));

    // L: lexical BM25 over title+summary
    const L = bm25(q).filter((d) => d.score > 0);

    // F: RRF(summary, lexical)
    const F = rrf(B, L);

    const sA = score(A, GOLD[q]),
      sB = score(B, GOLD[q]),
      sL = score(L, GOLD[q]),
      sF = score(F, GOLD[q]);
    agg.A.push(sA);
    agg.B.push(sB);
    agg.L.push(sL);
    agg.F.push(sF);

    console.log("=".repeat(72));
    console.log(`QUERY: "${q}"   gold=[${GOLD[q].map(base).join(", ")}]`);
    const line = (tag, ranked, s) =>
      console.log(
        `  [${tag}] R@5=${s.recall.toFixed(2)} RR=${s.rr.toFixed(2)}  ::  ` +
          ranked
            .slice(0, SHOW)
            .map((r) => (GOLD[q].includes(r.name) ? "✓" : "·") + r.name)
            .join("  |  ")
            .slice(0, 160)
      );
    line("A chunk ", A, sA);
    line("B summ  ", B, sB);
    line("L lexBM ", L, sL);
    line("F fusion", F, sF);
    console.log();
  }

  const mean = (xs, k) =>
    (xs.reduce((a, c) => a + c[k], 0) / xs.length).toFixed(3);
  console.log("#".repeat(72));
  console.log("MEAN over", Object.keys(GOLD).length, "queries:");
  console.log("           Recall@5   MRR");
  for (const [k, label] of [
    ["A", "chunk   "],
    ["B", "summary "],
    ["L", "lexBM25 "],
    ["F", "RRF-fuse"],
  ])
    console.log(`  ${label}   ${mean(agg[k], "recall")}      ${mean(agg[k], "rr")}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
