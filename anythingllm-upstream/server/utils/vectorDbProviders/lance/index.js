const lancedb = require("@lancedb/lancedb");
const { toChunks, getEmbeddingEngineSelection } = require("../../helpers");
const { TextSplitter } = require("../../TextSplitter");
const { SystemSettings } = require("../../../models/systemSettings");
const { storeVectorResult, cachedVectorInformation } = require("../../files");
const { v4: uuidv4 } = require("uuid");
const { sourceIdentifier } = require("../../chats");
const { NativeEmbeddingReranker } = require("../../EmbeddingRerankers/native");
const { VectorDatabase } = require("../base");
const path = require("path");

// AMAdocs: guarantee a stable Arrow schema across both doc producers
// (the GnomeBridge gnome-sync path and the normal collector upload path).
// LanceDB fixes a table's column set from its FIRST inserted row; any later
// doc that OMITS a column makes LanceDB-node build a malformed 0-byte Utf8
// buffer and the whole .add() throws ("Last offset … is larger than values
// length 0"). The two producers diverge on five columns:
//   - GnomeBridge emits: amadocsSource, sourceMime, sourcePath, pageCount
//   - the normal collector upload emits: aiSummary
// so a table seeded by either producer rejected the other's docs. We force the
// full union onto EVERY doc (defaulting ""/0 when the source did not supply a
// column) so bridged + dropped docs share one stable Arrow schema.
function withAmadocsSchema(metadata = {}) {
  return {
    ...metadata,
    amadocsSource: metadata.amadocsSource ?? "",
    sourceMime: metadata.sourceMime ?? "",
    sourcePath: metadata.sourcePath ?? "",
    pageCount: metadata.pageCount ?? 0,
    aiSummary: metadata.aiSummary ?? "",
  };
}

// AMAdocs (summary-search redesign): breadth-scope chat (folder/drive/global) retrieves
// over ONE per-document summary vector instead of full-text chunks, so results are
// "one librarian card per document" rather than scattered chunk fragments (which in a
// big folder dominate the topN with duplicate chunks of one doc and miss the right doc).
// These vectors live in a SEPARATE table ("<slug>__summaries") so the proven chunk/chat
// table and its DocumentVectors bookkeeping stay untouched, and the whole summary index
// can be dropped+rebuilt cheaply (embeds only — no LLM generation) while we tune. Every
// row goes through summaryRow() so the table's Arrow schema (locked at first insert) is
// stable regardless of which fields a producer happens to supply. See [[llm-search-redesign]].
function summaryRow(meta = {}) {
  const summary = String(meta.aiSummary ?? "").trim();
  return {
    sourcePath: meta.sourcePath ?? "",
    title: meta.title ?? "",
    // `text` carries the summary so curateSources()/the UI render it as the result
    // snippet, exactly like a chunk's text — folder result cards "just work".
    text: summary,
    aiSummary: summary,
    amadocsSource: meta.amadocsSource ?? "",
    sourceMime: meta.sourceMime ?? "",
    pageCount: meta.pageCount ?? 0,
  };
}

/**
 * LancedDB Client connection object
 * @typedef {import('@lancedb/lancedb').Connection} LanceClient
 */

class LanceDb extends VectorDatabase {
  /** @type {import('@lancedb/lancedb').Connection|null} */
  static #connection = null;

  constructor() {
    super();
  }

  get uri() {
    const basePath = !!process.env.STORAGE_DIR
      ? process.env.STORAGE_DIR
      : path.resolve(__dirname, "../../../storage");
    return path.resolve(basePath, "lancedb");
  }

  get name() {
    return "LanceDb";
  }

  /** @returns {Promise<{client: LanceClient}>} */
  async connect() {
    if (!LanceDb.#connection)
      LanceDb.#connection = await lancedb.connect(this.uri);
    return { client: LanceDb.#connection };
  }

  distanceToSimilarity(distance = null) {
    if (distance === null || typeof distance !== "number") return 0.0;
    if (distance >= 1.0) return 1;
    if (distance < 0) return 1 - Math.abs(distance);
    return 1 - distance;
  }

  async heartbeat() {
    await this.connect();
    return { heartbeat: Number(new Date()) };
  }

  async tables() {
    const { client } = await this.connect();
    return await client.tableNames();
  }

  async totalVectors() {
    const { client } = await this.connect();
    const tables = await client.tableNames();
    let count = 0;
    for (const tableName of tables) {
      const table = await client.openTable(tableName);
      count += await table.countRows();
    }
    return count;
  }

  async namespaceCount(_namespace = null) {
    const { client } = await this.connect();
    const exists = await this.namespaceExists(client, _namespace);
    if (!exists) return 0;

    const table = await client.openTable(_namespace);
    return (await table.countRows()) || 0;
  }

  /**
   * Performs a SimilaritySearch + Reranking on a namespace.
   * @param {Object} params - The parameters for the rerankedSimilarityResponse.
   * @param {Object} params.client - The vectorDB client.
   * @param {string} params.namespace - The namespace to search in.
   * @param {string} params.query - The query to search for (plain text).
   * @param {number[]} params.queryVector - The vector of the query.
   * @param {number} params.similarityThreshold - The threshold for similarity.
   * @param {number} params.topN - the number of results to return from this process.
   * @param {string[]} params.filterIdentifiers - The identifiers of the documents to filter out.
   * @returns
   */
  async rerankedSimilarityResponse({
    client,
    namespace,
    query,
    queryVector,
    topN = 4,
    similarityThreshold = 0.25,
    filterIdentifiers = [],
    scopePath = null,
  }) {
    const reranker = new NativeEmbeddingReranker();
    const collection = await client.openTable(namespace);
    const totalEmbeddings = await this.namespaceCount(namespace);
    const result = {
      contextTexts: [],
      sourceDocuments: [],
      scores: [],
    };

    /**
     * For reranking, we want to work with a larger number of results than the topN.
     * This is because the reranker can only rerank the results it it given and we dont auto-expand the results.
     * We want to give the reranker a larger number of results to work with.
     *
     * However, we cannot make this boundless as reranking is expensive and time consuming.
     * So we limit the number of results to a maximum of 50 and a minimum of 10.
     * This is a good balance between the number of results to rerank and the cost of reranking
     * and ensures workspaces with 10K embeddings will still rerank within a reasonable timeframe on base level hardware.
     *
     * Benchmarks:
     * On Intel Mac: 2.6 GHz 6-Core Intel Core i7 - 20 docs reranked in ~5.2 sec
     */
    const searchLimit = Math.max(
      10,
      Math.min(50, Math.ceil(totalEmbeddings * 0.1))
    );
    // AMAdocs: same quoting rule as similarityResponse.
    let vQuery = collection.vectorSearch(queryVector).distanceType("cosine").limit(searchLimit);
    if (scopePath) {
      const escaped = String(scopePath).replace(/'/g, "''");
      vQuery = vQuery.where(`starts_with(sourcePath, '${escaped}')`);
    }
    const vectorSearchResults = await vQuery.toArray();

    await reranker
      .rerank(query, vectorSearchResults, { topK: topN })
      .then((rerankResults) => {
        rerankResults.forEach((item) => {
          if (this.distanceToSimilarity(item._distance) < similarityThreshold)
            return;
          const { vector: _, ...rest } = item;
          if (filterIdentifiers.includes(sourceIdentifier(rest))) {
            this.logger(
              "A source was filtered from context as it's parent document is pinned."
            );
            return;
          }
          const score =
            item?.rerank_score || this.distanceToSimilarity(item._distance);

          result.contextTexts.push(rest.text);
          result.sourceDocuments.push({
            ...rest,
            score,
          });
          result.scores.push(score);
        });
      })
      .catch((e) => {
        this.logger(e);
        this.logger("rerankedSimilarityResponse", e.message);
      });

    return result;
  }

  /**
   * Performs a SimilaritySearch on a give LanceDB namespace.
   * @param {Object} params
   * @param {LanceClient} params.client
   * @param {string} params.namespace
   * @param {number[]} params.queryVector
   * @param {number} params.similarityThreshold
   * @param {number} params.topN
   * @param {string[]} params.filterIdentifiers
   * @returns
   */
  async similarityResponse({
    client,
    namespace,
    queryVector,
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
    scopePath = null,
  }) {
    const collection = await client.openTable(namespace);
    const result = {
      contextTexts: [],
      sourceDocuments: [],
      scores: [],
    };

    // AMAdocs: unquoted identifier resolves case-insensitively in DataFusion (lancedb 0.15.0).
    // Quoted "sourcePath" resolves the column but returns 0 rows — keep unquoted.
    let query = collection.vectorSearch(queryVector).distanceType("cosine").limit(topN);
    if (scopePath) {
      const escaped = String(scopePath).replace(/'/g, "''");
      query = query.where(`starts_with(sourcePath, '${escaped}')`);
    }
    const response = await query.toArray();

    response.forEach((item) => {
      if (this.distanceToSimilarity(item._distance) < similarityThreshold)
        return;
      const { vector: _, ...rest } = item;
      if (filterIdentifiers.includes(sourceIdentifier(rest))) {
        this.logger(
          "A source was filtered from context as it's parent document is pinned."
        );
        return;
      }

      result.contextTexts.push(rest.text);
      result.sourceDocuments.push({
        ...rest,
        score: this.distanceToSimilarity(item._distance),
      });
      result.scores.push(this.distanceToSimilarity(item._distance));
    });

    return result;
  }

  /**
   * AMAdocs (Option A — summary-grounded chat): fetch the stored aiSummary for an
   * exact file path within a namespace. The summary is the "librarian's card" built
   * from the document's title page + opening (see collector DocSummary). Injecting it
   * into file-scoped chat context gives the LLM whole-document orientation that pure
   * similarity search misses — the title/opening pages rarely textually match a
   * specific question, so they're seldom retrieved. Exact-path match (not starts_with)
   * so a sibling like "/a/file2" can't bleed into "/a/file". Returns "" when there is
   * no summary (bridged/GNOME docs, images, summariser failures) — never throws.
   * @param {Object} params
   * @param {string} params.namespace
   * @param {string} params.sourcePath - exact file path (no trailing slash)
   * @returns {Promise<string>}
   */
  async aiSummaryForPath({ namespace = null, sourcePath = null } = {}) {
    if (!namespace || !sourcePath) return "";
    try {
      const { client } = await this.connect();
      if (!(await this.namespaceExists(client, namespace))) return "";
      const collection = await client.openTable(namespace);
      const escaped = String(sourcePath).replace(/'/g, "''");
      // Backtick-quote the identifier. The unquoted bareword works as a FUNCTION arg
      // (starts_with(sourcePath, …) in similarityResponse) but DataFusion case-folds it
      // to `sourcepath` in a binary `=` comparison and throws "No field named sourcepath";
      // double-quotes are parsed as a string literal (matches nothing → 0 rows). Backticks
      // are the identifier quote that resolves the mixed-case column here. (lancedb 0.15.0)
      const rows = await collection
        .query()
        .where(`\`sourcePath\` = '${escaped}'`)
        .select(["aiSummary"])
        .limit(1)
        .toArray();
      const summary = rows?.[0]?.aiSummary;
      return typeof summary === "string" ? summary.trim() : "";
    } catch (e) {
      this.logger(`aiSummaryForPath failed: ${e.message}`);
      return "";
    }
  }

  // AMAdocs: the parallel summary-vector table for a workspace namespace.
  summaryNamespace(namespace = "") {
    return `${namespace}__summaries`;
  }

  /**
   * AMAdocs (summary-search): write/replace the single per-document summary vector for
   * a file in the workspace's "<slug>__summaries" table. Idempotent by sourcePath
   * (delete-then-add) so a re-sync never duplicates a doc's card. Embeds the summary with
   * the SAME engine used for chunk + query vectors (getEmbeddingEngineSelection) so the
   * summary space and the query are comparable. No-op (returns false) when there's no
   * summary text — bridged docs without a summary simply don't appear in breadth search.
   * @returns {Promise<boolean>}
   */
  async upsertSummaryVector({
    namespace = null,
    sourcePath = null,
    aiSummary = "",
    title = "",
    amadocsSource = "",
    sourceMime = "",
    pageCount = 0,
  } = {}) {
    const summary = String(aiSummary ?? "").trim();
    if (!namespace || !sourcePath || !summary) return false;
    try {
      const EmbedderEngine = getEmbeddingEngineSelection();
      const vector = await EmbedderEngine.embedTextInput(summary);
      if (!Array.isArray(vector) || vector.length === 0) return false;

      const sumNS = this.summaryNamespace(namespace);
      const { client } = await this.connect();
      if (await this.namespaceExists(client, sumNS)) {
        const collection = await client.openTable(sumNS);
        const escaped = String(sourcePath).replace(/'/g, "''");
        await collection.delete(`\`sourcePath\` = '${escaped}'`);
      }
      const row = summaryRow({
        sourcePath,
        title,
        aiSummary: summary,
        amadocsSource,
        sourceMime,
        pageCount,
      });
      await this.updateOrCreateCollection(
        client,
        [{ id: uuidv4(), vector, ...row }],
        sumNS
      );
      return true;
    } catch (e) {
      this.logger(`upsertSummaryVector failed: ${e.message}`);
      return false;
    }
  }

  /**
   * AMAdocs (summary-search): remove a document's summary vector (on delete/move) so a
   * stale card can't survive in breadth search. Keyed by exact sourcePath. Never throws.
   * @returns {Promise<boolean>}
   */
  async deleteSummaryVector({ namespace = null, sourcePath = null } = {}) {
    if (!namespace || !sourcePath) return false;
    try {
      const sumNS = this.summaryNamespace(namespace);
      const { client } = await this.connect();
      if (!(await this.namespaceExists(client, sumNS))) return false;
      const collection = await client.openTable(sumNS);
      const escaped = String(sourcePath).replace(/'/g, "''");
      await collection.delete(`\`sourcePath\` = '${escaped}'`);
      return true;
    } catch (e) {
      this.logger(`deleteSummaryVector failed: ${e.message}`);
      return false;
    }
  }

  /**
   * AMAdocs (summary-search): breadth-scope retrieval over per-document summary vectors.
   * Returns one result per matching document (the "librarian card" view) instead of
   * chunk fragments. Mirrors similarityResponse's shape so the chat pipeline + folder
   * result-card UI consume it unchanged. scopePath is the folder prefix (trailing slash);
   * null = whole workspace (drive/global). Falls back to an empty result when the summary
   * table doesn't exist yet (corpus not backfilled) — caller can then choose chunk search.
   * @returns {Promise<{contextTexts:string[], sources:object[], message:(string|false)}>}
   */
  async summarySearch({
    namespace = null,
    input = "",
    LLMConnector = null,
    similarityThreshold = 0.2, // summary vectors run lower than chunks — see stream.js note
    topN = 10,
    scopePath = null,
  } = {}) {
    if (!namespace || !input || !LLMConnector)
      throw new Error("Invalid request to summarySearch.");

    const sumNS = this.summaryNamespace(namespace);
    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, sumNS)))
      return { contextTexts: [], sources: [], message: false, empty: true };

    const queryVector = await LLMConnector.embedTextInput(input);
    const collection = await client.openTable(sumNS);
    let vQuery = collection
      .vectorSearch(queryVector)
      .distanceType("cosine")
      .limit(topN);
    if (scopePath) {
      const escaped = String(scopePath).replace(/'/g, "''");
      vQuery = vQuery.where(`starts_with(sourcePath, '${escaped}')`);
    }
    const response = await vQuery.toArray();

    const contextTexts = [];
    const sourceDocuments = [];
    response.forEach((item) => {
      const similarity = this.distanceToSimilarity(item._distance);
      if (similarity < similarityThreshold) return;
      const { vector: _, ...rest } = item;
      contextTexts.push(rest.text);
      sourceDocuments.push({ ...rest, score: similarity });
    });

    const sources = sourceDocuments.map((metadata, i) => {
      return { metadata: { ...metadata, text: contextTexts[i] } };
    });
    return {
      contextTexts,
      sources: this.curateSources(sources),
      message: false,
    };
  }

  /**
   *
   * @param {LanceClient} client
   * @param {string} namespace
   * @returns
   */
  async namespace(client, namespace = null) {
    if (!namespace) throw new Error("No namespace value provided.");
    const collection = await client.openTable(namespace).catch(() => false);
    if (!collection) return null;

    return {
      ...collection,
    };
  }

  /**
   *
   * @param {LanceClient} client
   * @param {number[]} data
   * @param {string} namespace
   * @returns
   */
  async updateOrCreateCollection(client, data = [], namespace) {
    const hasNamespace = await this.hasNamespace(namespace);
    if (hasNamespace) {
      const collection = await client.openTable(namespace);
      await collection.add(data);
      return true;
    }

    await client.createTable(namespace, data);
    return true;
  }

  async hasNamespace(namespace = null) {
    if (!namespace) return false;
    const { client } = await this.connect();
    const exists = await this.namespaceExists(client, namespace);
    return exists;
  }

  /**
   *
   * @param {LanceClient} client
   * @param {string} namespace
   * @returns
   */
  async namespaceExists(client, namespace = null) {
    if (!namespace) throw new Error("No namespace value provided.");
    const collections = await client.tableNames();
    return collections.includes(namespace);
  }

  /**
   *
   * @param {LanceClient} client
   * @param {string} namespace
   * @returns
   */
  async deleteVectorsInNamespace(client, namespace = null) {
    await client.dropTable(namespace);
    return true;
  }

  async deleteDocumentFromNamespace(namespace, docId) {
    const { client } = await this.connect();
    const exists = await this.namespaceExists(client, namespace);
    if (!exists) {
      this.logger(
        `deleteDocumentFromNamespace - namespace ${namespace} does not exist.`
      );
      return;
    }

    const { DocumentVectors } = require("../../../models/vectors");
    const table = await client.openTable(namespace);
    const vectorIds = (await DocumentVectors.where({ docId })).map(
      (record) => record.vectorId
    );

    if (vectorIds.length === 0) return;
    await table.delete(`id IN (${vectorIds.map((v) => `'${v}'`).join(",")})`);
    return true;
  }

  async addDocumentToNamespace(
    namespace,
    documentData = {},
    fullFilePath = null,
    skipCache = false
  ) {
    const { DocumentVectors } = require("../../../models/vectors");
    try {
      const { pageContent, docId, ...rawMetadata } = documentData;
      if (!pageContent || pageContent.length == 0) return false;
      const metadata = withAmadocsSchema(rawMetadata);

      this.logger("Adding new vectorized document into namespace", namespace);
      if (!skipCache) {
        const cacheResult = await cachedVectorInformation(fullFilePath);
        if (cacheResult.exists) {
          const { client } = await this.connect();
          const { chunks } = cacheResult;
          const documentVectors = [];
          const submissions = [];

          for (const chunk of chunks) {
            chunk.forEach((chunk) => {
              const id = uuidv4();
              const { id: _id, ...rawMetadata } = chunk.metadata;
              const metadata = withAmadocsSchema(rawMetadata);
              documentVectors.push({ docId, vectorId: id });
              submissions.push({ id: id, vector: chunk.values, ...metadata });
            });
          }

          await this.updateOrCreateCollection(client, submissions, namespace);
          await DocumentVectors.bulkInsert(documentVectors);
          return { vectorized: true, error: null };
        }
      }

      // If we are here then we are going to embed and store a novel document.
      // We have to do this manually as opposed to using LangChains `xyz.fromDocuments`
      // because we then cannot atomically control our namespace to granularly find/remove documents
      // from vectordb.
      const EmbedderEngine = getEmbeddingEngineSelection();
      const textSplitter = new TextSplitter({
        chunkSize: TextSplitter.determineMaxChunkSize(
          await SystemSettings.getValueOrFallback({
            label: "text_splitter_chunk_size",
          }),
          EmbedderEngine?.embeddingMaxChunkLength
        ),
        chunkOverlap: await SystemSettings.getValueOrFallback(
          { label: "text_splitter_chunk_overlap" },
          20
        ),
        chunkHeaderMeta: TextSplitter.buildHeaderMeta(metadata),
        chunkPrefix: EmbedderEngine?.embeddingPrefix,
      });
      const textChunks = await textSplitter.splitText(pageContent);

      this.logger("Snippets created from document:", textChunks.length);
      const documentVectors = [];
      const vectors = [];
      const submissions = [];
      const vectorValues = await EmbedderEngine.embedChunks(textChunks);

      if (!!vectorValues && vectorValues.length > 0) {
        for (const [i, vector] of vectorValues.entries()) {
          const vectorRecord = {
            id: uuidv4(),
            values: vector,
            // [DO NOT REMOVE]
            // LangChain will be unable to find your text if you embed manually and dont include the `text` key.
            // https://github.com/hwchase17/langchainjs/blob/2def486af734c0ca87285a48f1a04c057ab74bdf/langchain/src/vectorstores/pinecone.ts#L64
            metadata: { ...metadata, text: textChunks[i] },
          };

          vectors.push(vectorRecord);
          submissions.push({
            ...vectorRecord.metadata,
            id: vectorRecord.id,
            vector: vectorRecord.values,
          });
          documentVectors.push({ docId, vectorId: vectorRecord.id });
        }
      } else {
        throw new Error(
          "Could not embed document chunks! This document will not be recorded."
        );
      }

      if (vectors.length > 0) {
        const chunks = [];
        for (const chunk of toChunks(vectors, 500)) chunks.push(chunk);

        this.logger("Inserting vectorized chunks into LanceDB collection.");
        const { client } = await this.connect();
        await this.updateOrCreateCollection(client, submissions, namespace);
        await storeVectorResult(chunks, fullFilePath);
      }

      await DocumentVectors.bulkInsert(documentVectors);
      return { vectorized: true, error: null };
    } catch (e) {
      this.logger("addDocumentToNamespace", e.message);
      return { vectorized: false, error: e.message };
    }
  }

  async performSimilaritySearch({
    namespace = null,
    input = "",
    LLMConnector = null,
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
    rerank = false,
    scopePath = null,
  }) {
    if (!namespace || !input || !LLMConnector)
      throw new Error("Invalid request to performSimilaritySearch.");

    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, namespace))) {
      return {
        contextTexts: [],
        sources: [],
        message: "Invalid query - no documents found for workspace!",
      };
    }

    const queryVector = await LLMConnector.embedTextInput(input);
    const result = rerank
      ? await this.rerankedSimilarityResponse({
          client,
          namespace,
          query: input,
          queryVector,
          similarityThreshold,
          topN,
          filterIdentifiers,
          scopePath,
        })
      : await this.similarityResponse({
          client,
          namespace,
          queryVector,
          similarityThreshold,
          topN,
          filterIdentifiers,
          scopePath,
        });

    const { contextTexts, sourceDocuments } = result;
    const sources = sourceDocuments.map((metadata, i) => {
      return { metadata: { ...metadata, text: contextTexts[i] } };
    });
    return {
      contextTexts,
      sources: this.curateSources(sources),
      message: false,
    };
  }

  async "namespace-stats"(reqBody = {}) {
    const { namespace = null } = reqBody;
    if (!namespace) throw new Error("namespace required");
    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, namespace)))
      throw new Error("Namespace by that name does not exist.");
    const stats = await this.namespace(client, namespace);
    return stats
      ? stats
      : { message: "No stats were able to be fetched from DB for namespace" };
  }

  async "delete-namespace"(reqBody = {}) {
    const { namespace = null } = reqBody;
    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, namespace)))
      throw new Error("Namespace by that name does not exist.");

    await this.deleteVectorsInNamespace(client, namespace);
    return {
      message: `Namespace ${namespace} was deleted.`,
    };
  }

  async reset() {
    const { client } = await this.connect();
    LanceDb.#connection = null;
    const fs = require("fs");
    fs.rm(`${client.uri}`, { recursive: true }, () => null);
    return { reset: true };
  }

  curateSources(sources = []) {
    const documents = [];
    for (const source of sources) {
      const { text, vector: _v, _distance: _d, ...rest } = source;
      const metadata = rest.hasOwnProperty("metadata") ? rest.metadata : rest;
      if (Object.keys(metadata).length > 0) {
        documents.push({
          ...metadata,
          ...(text ? { text } : {}),
        });
      }
    }

    return documents;
  }
}

module.exports.LanceDb = LanceDb;
