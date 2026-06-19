const { v4: uuidv4 } = require("uuid");
const { getVectorDbClass } = require("../utils/helpers");
const prisma = require("../utils/prisma");
const { Telemetry } = require("./telemetry");
const { EventLogs } = require("./eventLogs");
const { safeJsonParse } = require("../utils/http");
const { getModelTag } = require("../endpoints/utils");

// AMAdocs: the bounded text embedded for a CATALOGED (not deep-searched) document.
// Prefers the ~120-word AI summary (prefixed with the title so a "which file is the X
// report" query retrieves it well). Falls back to a short leading slice when there is
// no summary yet (e.g. the model was unavailable at ingest, or an image whose vision
// caption — already short — IS its gist), so the file stays findable while keeping the
// per-file embed cost bounded.
function catalogText(data = {}) {
  const summary = String(data?.aiSummary || "").trim();
  if (summary) {
    const title = String(data?.title || "").trim();
    return title ? `${title}\n\n${summary}` : summary;
  }
  return String(data?.pageContent || "").slice(0, 2000);
}

const Document = {
  writable: ["pinned", "watched", "lastUpdatedAt"],
  /**
   * @param {import("@prisma/client").workspace_documents} document - Document PrismaRecord
   * @returns {{
   *  metadata: (null|object),
   *  type: import("./documentSyncQueue.js").validFileType,
   *  source: string
   * }}
   */
  parseDocumentTypeAndSource: function (document) {
    const metadata = safeJsonParse(document.metadata, null);
    if (!metadata) return { metadata: null, type: null, source: null };

    // Parse the correct type of source and its original source path.
    const idx = metadata.chunkSource.indexOf("://");
    const [type, source] = [
      metadata.chunkSource.slice(0, idx),
      metadata.chunkSource.slice(idx + 3),
    ];
    return { metadata, type, source: this._stripSource(source, type) };
  },

  forWorkspace: async function (workspaceId = null) {
    if (!workspaceId) return [];
    return await prisma.workspace_documents.findMany({
      where: { workspaceId },
    });
  },

  delete: async function (clause = {}) {
    try {
      await prisma.workspace_documents.deleteMany({ where: clause });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  get: async function (clause = {}) {
    try {
      const document = await prisma.workspace_documents.findFirst({
        where: clause,
      });
      return document || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    include = null,
    select = null
  ) {
    try {
      const results = await prisma.workspace_documents.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
        ...(include !== null ? { include } : {}),
        ...(select !== null ? { select: { ...select } } : {}),
      });
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  // AMAdocs: `mode` controls WHAT gets embedded for a document:
  //   - "deep"    (default) → the full document text (full-text semantic search)
  //   - "summary"           → only the ~120-word "catalog card" gist, so the file is
  //                           findable by the AI librarian without a full scan (the
  //                           ingest default; full-text is upgraded later per file via
  //                           the "Deep search" action). The on-disk document JSON
  //                           keeps its full pageContent either way — only the embedded
  //                           text differs. The chosen mode is tagged onto the
  //                           workspace_documents metadata as `amadocsSearchMode`.
  addDocuments: async function (
    workspace,
    additions = [],
    userId = null,
    { mode = "deep" } = {}
  ) {
    const VectorDb = getVectorDbClass();
    if (additions.length === 0) return { failed: [], embedded: [] };
    const { fileData } = require("../utils/files");
    const { emitProgress } = require("../utils/EmbeddingWorkerManager");
    const embedded = [];
    const failedToEmbed = [];
    const errors = new Set();

    emitProgress(workspace.slug, {
      type: "batch_starting",
      workspaceSlug: workspace.slug,
      userId,
      filenames: additions,
      totalDocs: additions.length,
    });

    for (const [index, path] of additions.entries()) {
      const docProgress = {
        workspaceSlug: workspace.slug,
        userId,
        filename: path,
        docIndex: index,
        totalDocs: additions.length,
      };

      const data = await fileData(path);
      if (!data) {
        emitProgress(workspace.slug, {
          type: "doc_failed",
          ...docProgress,
          error: "Failed to load file data",
        });
        continue;
      }

      const docId = uuidv4();
      const { pageContent: _pageContent, ...metadata } = data;
      metadata.amadocsSearchMode = mode; // AMAdocs: catalog (summary) vs deep (full-text)
      const newDoc = {
        docId,
        filename: path.split("/")[1],
        docpath: path,
        workspaceId: workspace.id,
        metadata: JSON.stringify(metadata),
      };

      emitProgress(workspace.slug, { type: "doc_starting", ...docProgress });

      global.__embeddingProgress = {
        workspaceSlug: workspace.slug,
        filename: path,
        userId,
      };

      // AMAdocs: in catalog ("summary") mode we embed only the gist, not the whole
      // file. The full text still lives in the on-disk JSON (data.pageContent) for the
      // viewer/citations; we just feed a bounded card to the embedder here.
      const embedPageContent =
        mode === "summary" ? catalogText(data) : data.pageContent;
      const { vectorized, error } = await VectorDb.addDocumentToNamespace(
        workspace.slug,
        { ...data, pageContent: embedPageContent, docId },
        path
      );

      if (!vectorized) {
        console.error(
          "Failed to vectorize",
          metadata?.title || newDoc.filename
        );
        failedToEmbed.push(metadata?.title || newDoc.filename);
        errors.add(error);
        emitProgress(workspace.slug, {
          type: "doc_failed",
          ...docProgress,
          error: error || "Unknown error",
        });
        continue;
      }

      try {
        await prisma.workspace_documents.create({ data: newDoc });
        embedded.push(path);
        emitProgress(workspace.slug, {
          type: "doc_complete",
          ...docProgress,
        });
      } catch (error) {
        console.error(error.message);
        emitProgress(workspace.slug, {
          type: "doc_failed",
          ...docProgress,
          error: "Failed to save document record",
        });
      }
    }

    global.__embeddingProgress = null;

    emitProgress(workspace.slug, {
      type: "all_complete",
      workspaceSlug: workspace.slug,
      userId,
      totalDocs: additions.length,
      embedded: embedded.length,
      failed: failedToEmbed.length,
    });

    await Telemetry.sendTelemetry("documents_embedded_in_workspace", {
      LLMSelection: process.env.LLM_PROVIDER || "openai",
      Embedder: process.env.EMBEDDING_ENGINE || "inherit",
      VectorDbSelection: process.env.VECTOR_DB || "lancedb",
      TTSSelection: process.env.TTS_PROVIDER || "native",
      LLMModel: getModelTag(),
    });
    await EventLogs.logEvent(
      "workspace_documents_added",
      {
        workspaceName: workspace?.name || "Unknown Workspace",
        numberOfDocumentsAdded: additions.length,
      },
      userId
    );
    return { failedToEmbed, errors: Array.from(errors), embedded };
  },

  removeDocuments: async function (workspace, removals = [], userId = null) {
    const VectorDb = getVectorDbClass();
    if (removals.length === 0) return;

    for (const path of removals) {
      const document = await this.get({
        docpath: path,
        workspaceId: workspace.id,
      });
      if (!document) continue;
      await VectorDb.deleteDocumentFromNamespace(
        workspace.slug,
        document.docId
      );

      try {
        await prisma.workspace_documents.delete({
          where: { id: document.id, workspaceId: workspace.id },
        });
        await prisma.document_vectors.deleteMany({
          where: { docId: document.docId },
        });
      } catch (error) {
        console.error(error.message);
      }
    }

    await EventLogs.logEvent(
      "workspace_documents_removed",
      {
        workspaceName: workspace?.name || "Unknown Workspace",
        numberOfDocuments: removals.length,
      },
      userId
    );
    return true;
  },

  count: async function (clause = {}, limit = null) {
    try {
      const count = await prisma.workspace_documents.count({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
      });
      return count;
    } catch (error) {
      console.error("FAILED TO COUNT DOCUMENTS.", error.message);
      return 0;
    }
  },
  update: async function (id = null, data = {}) {
    if (!id) throw new Error("No workspace document id provided for update");

    const validKeys = Object.keys(data).filter((key) =>
      this.writable.includes(key)
    );
    if (validKeys.length === 0)
      return { document: { id }, message: "No valid fields to update!" };

    try {
      const document = await prisma.workspace_documents.update({
        where: { id },
        data,
      });
      return { document, message: null };
    } catch (error) {
      console.error(error.message);
      return { document: null, message: error.message };
    }
  },
  _updateAll: async function (clause = {}, data = {}) {
    try {
      await prisma.workspace_documents.updateMany({
        where: clause,
        data,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },
  content: async function (docId) {
    if (!docId) throw new Error("No workspace docId provided!");
    const document = await this.get({ docId: String(docId) });
    if (!document) throw new Error(`Could not find a document by id ${docId}`);

    const { fileData } = require("../utils/files");
    const data = await fileData(document.docpath);
    return { title: data.title, content: data.pageContent };
  },
  contentByDocPath: async function (docPath) {
    const { fileData } = require("../utils/files");
    const data = await fileData(docPath);
    return { title: data.title, content: data.pageContent };
  },

  // Some data sources have encoded params in them we don't want to log - so strip those details.
  _stripSource: function (sourceString, type) {
    if (["confluence", "github"].includes(type)) {
      const _src = new URL(sourceString);
      _src.search = ""; // remove all search params that are encoded for resync.
      return _src.toString();
    }

    return sourceString;
  },

  /**
   * Functions for the backend API endpoints - not to be used by the frontend or elsewhere.
   * @namespace api
   */
  api: {
    /**
     * Process a document upload from the API and upsert it into the database. This
     * functionality should only be used by the backend /v1/documents/upload endpoints for post-upload embedding.
     * @param {string} wsSlugs - The slugs of the workspaces to embed the document into, will be comma-separated list of workspace slugs
     * @param {string} docLocation - The location/path of the document that was uploaded
     * @returns {Promise<boolean>} - True if the document was uploaded successfully, false otherwise
     */
    uploadToWorkspace: async function (wsSlugs = "", docLocation = null) {
      if (!docLocation)
        return console.log(
          "No document location provided for embedding",
          docLocation
        );

      const slugs = wsSlugs
        .split(",")
        .map((slug) => String(slug)?.trim()?.toLowerCase());
      if (slugs.length === 0)
        return console.log(`No workspaces provided got: ${wsSlugs}`);

      const { Workspace } = require("./workspace");
      const workspaces = await Workspace.where({ slug: { in: slugs } });
      if (workspaces.length === 0)
        return console.log("No valid workspaces found for slugs: ", slugs);

      // Upsert the document into each workspace - do this sequentially
      // because the document may be large and we don't want to overwhelm the embedder, plus on the first
      // upsert we will then have the cache of the document - making n+1 embeds faster. If we parallelize this
      // we will have to do a lot of extra work to ensure that the document is not embedded more than once.
      for (const workspace of workspaces) {
        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          workspace,
          [docLocation]
        );
        if (failedToEmbed.length > 0)
          return console.log(
            `Failed to embed document into workspace ${workspace.slug}`,
            errors
          );
        console.log(`Document embedded into workspace ${workspace.slug}...`);
      }

      return true;
    },
  },
};

module.exports = { Document };
