/* AMAdocs (summary-search redesign): one-off backfill of the per-document summary-vector
   table ("<slug>__summaries") from the aiSummary already stored on each gnome doc JSON.
   Embeds only (NativeEmbedder, local/CPU — NO granite generation, thermally safe), so it's
   cheap to re-run / drop+rebuild while tuning. Run from server/ dir:  node _backfill_summaries.js
   Optional: WIPE=1 drops the summary table first for a clean rebuild. */
const fs = require("fs");
const path = require("path");
const { LanceDb } = require("./utils/vectorDbProviders/lance");

const SLUG = process.env.SLUG || "amadocs-library";
const DOCDIR = path.resolve(
  __dirname,
  "storage/documents/gnome-amadocs-library"
);

(async () => {
  const db = new LanceDb();
  const sumNS = db.summaryNamespace(SLUG);

  if (process.env.WIPE === "1") {
    try {
      const { client } = await db.connect();
      if (await db.namespaceExists(client, sumNS)) {
        await client.dropTable(sumNS);
        console.log(`[backfill] dropped existing table ${sumNS}`);
      }
    } catch (e) {
      console.error("[backfill] wipe failed:", e.message);
    }
  }

  const files = fs.existsSync(DOCDIR)
    ? fs.readdirSync(DOCDIR).filter((f) => f.endsWith(".json"))
    : [];
  console.log(`[backfill] scanning ${files.length} doc JSONs in ${DOCDIR}`);

  let withSummary = 0;
  let ok = 0;
  let fail = 0;
  const t0 = Date.now();

  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(DOCDIR, f), "utf8"));
    } catch {
      continue;
    }
    const aiSummary = String(doc.aiSummary || "").trim();
    const sourcePath = doc.sourcePath || "";
    if (!aiSummary || !sourcePath) continue;
    withSummary++;

    const wrote = await db.upsertSummaryVector({
      namespace: SLUG,
      sourcePath,
      aiSummary,
      title: doc.title || path.basename(sourcePath),
      amadocsSource: doc.amadocsSource || "",
      sourceMime: doc.sourceMime || "",
      pageCount: doc.pageCount || 0,
    });
    if (wrote) ok++;
    else fail++;
    if ((ok + fail) % 25 === 0)
      console.log(`[backfill]   ${ok + fail}/${withSummary} processed…`);
  }

  let rows = 0;
  try {
    const { client } = await db.connect();
    if (await db.namespaceExists(client, sumNS))
      rows = await (await client.openTable(sumNS)).countRows();
  } catch {}

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[backfill] done in ${secs}s — docs-with-summary=${withSummary} ` +
      `upserted=${ok} failed=${fail} | table ${sumNS} now has ${rows} rows`
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
