const path = require("path");
const fs = require("fs");
const {
  reqBody,
  multiUserMode,
  userFromSession,
  safeJsonParse,
} = require("../utils/http");
const { normalizePath, isWithin } = require("../utils/files");
const { Workspace } = require("../models/workspace");
const { Document } = require("../models/documents");
const { DocumentVectors } = require("../models/vectors");
const { WorkspaceChats } = require("../models/workspaceChats");
const { getVectorDbClass } = require("../utils/helpers");
const { handleFileUpload, handlePfpUpload } = require("../utils/files/multer");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { Telemetry } = require("../models/telemetry");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { EventLogs } = require("../models/eventLogs");
const {
  WorkspaceSuggestedMessages,
} = require("../models/workspacesSuggestedMessages");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { convertToChatHistory } = require("../utils/helpers/chat/responses");
const { CollectorApi } = require("../utils/collectorApi");
const {
  determineWorkspacePfpFilepath,
  fetchPfp,
} = require("../utils/files/pfp");
const { getTTSProvider } = require("../utils/TextToSpeech");
const { WorkspaceThread } = require("../models/workspaceThread");

const truncate = require("truncate");
const { purgeDocument } = require("../utils/files/purgeDocument");
const { getModelTag } = require("./utils");
const { searchWorkspaceAndThreads } = require("../utils/helpers/search");
const { workspaceParsedFilesEndpoints } = require("./workspacesParsedFiles");
const {
  workspaceDeletionProtection,
} = require("../utils/middleware/workspaceDeletionProtection");

// AMAdocs: single source of truth for where AMAdocs keeps its OWN retained copy
// of every ingested file (the user's originals live wherever they dropped them
// from). This was duplicated across doc-original / doc-export / document-delete —
// centralized here so the path can never drift between them (Fable note).
function amadocsOriginalsDir() {
  return process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, `../storage/originals`)
    : path.resolve(process.env.STORAGE_DIR, `originals`);
}

// AMAdocs: absolute path to AMAdocs' retained original for a document id, or null.
// The id is a uuid, so a `<id>.<ext>` prefix match is safe from traversal/collision.
function amadocsRetainedOriginal(docId) {
  const dir = amadocsOriginalsDir();
  if (!docId || !fs.existsSync(dir)) return null;
  const match = fs.readdirSync(dir).find((f) => f.startsWith(`${docId}.`));
  return match ? path.resolve(dir, match) : null;
}

// AMAdocs: root of AMAdocs' storage dir (mirrors amadocsOriginalsDir's resolution).
function amadocsStorageRoot() {
  return process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, `../storage`)
    : path.resolve(process.env.STORAGE_DIR);
}

// AMAdocs: the status document. A single source-of-truth Markdown the app opens
// to on launch — index, database, model and version at a glance, generated live
// from the engine. Kept renderer-friendly (headings + short paragraph blocks)
// so it reads cleanly both in AMAdocs' preview pane and any plain Markdown viewer.
async function buildAmadocsStatus() {
  const Gnome = require("../utils/GnomeBridge");
  const fmtDate = (d) => {
    try {
      return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    } catch (_) {
      return "—";
    }
  };

  // ---- database / workspaces ----
  let wsRows = [];
  let totalDocs = 0;
  try {
    const workspaces = await Workspace.where();
    for (const ws of workspaces) {
      const n = await Document.count({ workspaceId: ws.id });
      totalDocs += n;
      wsRows.push({ slug: ws.slug, docs: n });
    }
  } catch (_) {
    /* leave wsRows empty on any model error */
  }

  // ---- GNOME index / synced folders ----
  let gnomeUp = false;
  try {
    gnomeUp = Gnome.available();
  } catch (_) {
    gnomeUp = false;
  }
  const synced = [];
  const summaries = { total: 0, summarised: 0, queued: 0 }; // library-wide AI-summary progress
  try {
    for (const slug of Gnome.listSyncedSlugs()) {
      const st = Gnome.loadState(slug);
      if (!st) continue;
      // Per-folder summary progress (summarised / queued of embedded files) — live while a
      // backfill drains. Best-effort: a bridge without summaryStats just omits the counts.
      let ss = { total: 0, summarised: 0, queued: 0 };
      try {
        if (typeof Gnome.summaryStats === "function") ss = Gnome.summaryStats(slug);
      } catch (_) {
        /* keep zeros if the count fails */
      }
      summaries.total += ss.total;
      summaries.summarised += ss.summarised;
      summaries.queued += ss.queued;
      synced.push({
        slug,
        folder: st.folder || "?",
        lastSync: st.lastSync,
        files: st.files ? Object.keys(st.files).length : 0,
        summarised: ss.summarised,
        queued: ss.queued,
      });
    }
  } catch (_) {
    /* no synced folders */
  }

  // ---- model / engine ----
  const chatModel = process.env.OLLAMA_MODEL_PREF || "(system default)";
  const embedder = process.env.EMBEDDING_MODEL_PREF || "Xenova/all-MiniLM-L6-v2";
  const llmProvider = process.env.LLM_PROVIDER || "ollama";
  const vectorDb = process.env.VECTOR_DB || "lancedb";
  let engineVersion = "?";
  try {
    engineVersion = require("../package.json").version;
  } catch (_) {
    /* ignore */
  }

  // ---- indexing pace (the user-set rest between summaries; Homepage slider) ----
  let paceMs = 30000;
  try {
    paceMs = Gnome.getPaceMs();
  } catch (_) {
    /* keep the default if the bridge can't report it */
  }

  // ---- structured data (consumed by the homepage; mirrors the markdown below) ----
  const data = {
    generatedAt: Date.now(),
    engine: { version: engineVersion, node: process.version, llmProvider, vectorDb },
    model: { chat: chatModel, embedder },
    gnome: { connected: gnomeUp },
    library: { totalDocs, workspaces: wsRows.length, wsRows },
    summaries,
    synced,
    pace: { summaryCooldownMs: paceMs },
  };

  // ---- assemble ----
  const lines = [];
  lines.push(`# AMAdocs`);
  lines.push("");
  lines.push(`Status generated ${fmtDate(Date.now())}.`);
  lines.push("");

  lines.push(`## Index`);
  lines.push("");
  lines.push(`GNOME indexer (LocalSearch / TinySPARQL): **${gnomeUp ? "connected" : "unavailable"}**`);
  lines.push("");
  if (synced.length) {
    lines.push(`Synced folders:`);
    for (const s of synced)
      lines.push(`- \`${s.folder}\` → **${s.files}** files · ${s.slug} · last sync ${fmtDate(s.lastSync)}`);
  } else {
    lines.push(`No folders synced yet. Use **⟳ index** on a folder, or right-click → analyse a file.`);
  }
  lines.push("");

  lines.push(`## Database`);
  lines.push("");
  lines.push(`Vector store: **${vectorDb}** · **${totalDocs}** documents across **${wsRows.length}** workspaces`);
  lines.push("");
  if (wsRows.length) {
    for (const w of wsRows) lines.push(`- ${w.slug}: **${w.docs}** documents`);
    lines.push("");
  }

  lines.push(`## Model`);
  lines.push("");
  lines.push(`Chat model: **${chatModel}** (via ${llmProvider})`);
  lines.push("");
  lines.push(`Embedder: **${embedder}**`);
  lines.push("");

  lines.push(`## Version`);
  lines.push("");
  lines.push(`Engine: **${engineVersion}** · Node ${process.version}`);
  lines.push("");

  return { markdown: lines.join("\n"), data };
}

// AMAdocs: single source of truth for the "everything AMAdocs understands about a
// document" payload — the AI summary, the AI vision description, any OCR'd text, source
// provenance, and (for photos) the original EXIF + basic image facts. Used by BOTH the
// sidecar export (doc-export → JSON) and the native-metadata embed (doc-export-embedded →
// inside the file) so the two can never drift. Best-effort: EXIF/image facts are null for
// non-photos or on error and never throw.
async function amadocsExtractMetadata({ data, slug, originalFile, ext }) {
  // Split the AI description / OCR text back out of the combined pageContent
  // (asImage writes "Image description:\n…\n\nText found in image:\n…").
  let aiDescription = null;
  let extractedText = null;
  const pc = data.pageContent || "";
  if (/Image description:|Text found in image:/.test(pc)) {
    const d = pc.match(
      /Image description:\s*([\s\S]*?)(?:\n\nText found in image:|$)/
    );
    const o = pc.match(/Text found in image:\s*([\s\S]*)$/);
    aiDescription = d ? d[1].trim() : null;
    extractedText = o ? o[1].trim() : null;
  } else {
    extractedText = pc.trim() || null;
  }

  let exif = null;
  let image = null;
  const IMAGE_EXTS = [
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic",
  ];
  if (originalFile && IMAGE_EXTS.includes(ext)) {
    exif = await require("exifr")
      .parse(originalFile)
      .catch(() => null);
    image = await require("sharp")(originalFile)
      .metadata()
      .then((m) => ({
        width: m.width,
        height: m.height,
        format: m.format,
        space: m.space,
        density: m.density || null,
      }))
      .catch(() => null);
  }

  return {
    exportedBy: "AMAdocs",
    exportedAt: new Date().toISOString(),
    source: {
      filename: data.title || null,
      collection: slug,
      ingestedAt: data.published || null,
      documentId: data.id,
      wordCount: data.wordCount ?? null,
    },
    aiSummary: data.aiSummary || null,
    aiDescription,
    extractedText,
    image,
    exif,
  };
}

function workspaceEndpoints(app) {
  if (!app) return;
  const responseCache = new Map();

  app.post(
    "/workspace/new",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { name = null } = reqBody(request);
        const { workspace, message } = await Workspace.new(name, user?.id);
        await Telemetry.sendTelemetry(
          "workspace_created",
          {
            multiUserMode: multiUserMode(response),
            LLMSelection: process.env.LLM_PROVIDER || "openai",
            Embedder: process.env.EMBEDDING_ENGINE || "inherit",
            VectorDbSelection: process.env.VECTOR_DB || "lancedb",
            TTSSelection: process.env.TTS_PROVIDER || "native",
            LLMModel: getModelTag(),
          },
          user?.id
        );

        await EventLogs.logEvent(
          "workspace_created",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          user?.id
        );
        response.status(200).json({ workspace, message });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { slug = null } = request.params;
        const data = reqBody(request);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        await Workspace.trackChange(currWorkspace, data, user);
        const { workspace, message } = await Workspace.update(
          currWorkspace.id,
          data
        );
        response.status(200).json({ workspace, message });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/upload",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (request, response) {
      try {
        const Collector = new CollectorApi();
        const { originalname } = request.file;
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Document ${originalname} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason } =
          await Collector.processDocument(originalname);
        if (!success) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Document ${originalname} uploaded processed and successfully. It is now available in documents.`
        );
        await Telemetry.sendTelemetry("document_uploaded");
        await EventLogs.logEvent(
          "document_uploaded",
          {
            documentName: originalname,
          },
          response.locals?.user?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-link",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const Collector = new CollectorApi();
        const { link = "" } = reqBody(request);
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Link ${link} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason } = await Collector.processLink(link);
        if (!success) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Link ${link} uploaded processed and successfully. It is now available in documents.`
        );
        await Telemetry.sendTelemetry("link_uploaded");
        await EventLogs.logEvent(
          "link_uploaded",
          { link },
          response.locals?.user?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update-embeddings",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { slug = null } = request.params;
        const { adds = [], deletes = [] } = reqBody(request);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        // AMAdocs: also delete the retained ORIGINAL files for removed docs so
        // the Library stays in sync (the "private copy" we promised the user).
        try {
          if (deletes.length > 0) {
            const fs = require("fs");
            const path = require("path");
            const { fileData } = require("../utils/files");
            const originalsPath = amadocsOriginalsDir();
            if (fs.existsSync(originalsPath)) {
              const stored = fs.readdirSync(originalsPath);
              for (const docpath of deletes) {
                const data = await fileData(docpath).catch(() => null);
                if (!data?.id) continue;
                const match = stored.find((f) => f.startsWith(`${data.id}.`));
                if (match)
                  fs.rmSync(path.resolve(originalsPath, match), { force: true });
              }
            }
          }
        } catch (e) {
          console.error("[update-embeddings] original cleanup failed:", e.message);
        }

        await Document.removeDocuments(
          currWorkspace,
          deletes,
          response.locals?.user?.id
        );

        const {
          isNativeEmbedder,
          embedFiles,
        } = require("../utils/EmbeddingWorkerManager");

        if (isNativeEmbedder() && adds.length > 0) {
          await embedFiles(
            currWorkspace.slug,
            adds,
            currWorkspace.id,
            response.locals?.user?.id ?? null
          );
          const updatedWorkspace = await Workspace.get({
            id: currWorkspace.id,
          });
          response
            .status(200)
            .json({ workspace: updatedWorkspace, message: null });
          return;
        }

        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          currWorkspace,
          adds,
          response.locals?.user?.id
        );
        const updatedWorkspace = await Workspace.get({ id: currWorkspace.id });
        response.status(200).json({
          workspace: updatedWorkspace,
          message:
            failedToEmbed.length > 0
              ? `${failedToEmbed.length} documents failed to add.\n\n${errors
                  .map((msg) => `${msg}`)
                  .join("\n\n")}`
              : null,
        });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  // AMAdocs: "ride on GNOME" — index a folder's OS-extracted text into this
  // workspace and keep it fresh incrementally, without re-parsing files. The OS
  // desktop indexer (LocalSearch/TinySPARQL) already crawled + extracted the text;
  // we just add embeddings + the citation loop on top. FIRST call full-indexes the
  // folder (embeds every file LocalSearch has text for, up to optional `limit`);
  // LATER calls delta-sync (re-embed only new/changed via nfo:fileLastModified, drop
  // deleted). Productionized form of tooling/tinysparql-{bridge,sync}.js. See
  // utils/GnomeBridge. Body: { folder, exclude?="/novels/", limit?=0, dryRun?=false }.
  app.post(
    "/workspace/:slug/gnome-sync",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = null } = request.params;
        const {
          folder = null,
          exclude = "/novels/",
          limit = 0,
          dryRun = false,
          reconcile = false,
        } = reqBody(request);

        // AMAdocs: the whole durable PLAN/EXECUTE/finalize-on-confirm orchestration now
        // lives in GnomeBridge.runSync so the background cadence scheduler shares ONE
        // code path with this endpoint (see utils/GnomeBridge). It returns the
        // HTTP-style status + body we relay verbatim (400/503/200-dryRun/202-execute).
        const Gnome = require("../utils/GnomeBridge");
        const { status, body } = await Gnome.runSync({
          slug,
          folder,
          exclude,
          limit,
          dryRun,
          reconcile,
          userId: response.locals?.user?.id ?? null,
        });
        return response.status(status).json(body);
      } catch (e) {
        console.error("[gnome-sync] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: on-demand single-file backstop — run AMAdocs' OWN extractor (OCR + vision
  // for images, mammoth for office docs, OCR for scanned PDFs) over ONE file GNOME
  // couldn't read, then embed it. This is the right-click "analyse with AI" path for
  // images / image-only PDFs that bulk folder sync deliberately skips. Body: { path }.
  app.post(
    "/workspace/:slug/analyse-file",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = null } = request.params;
        const { path: filePath = null } = reqBody(request);
        const Gnome = require("../utils/GnomeBridge");
        const result = await Gnome.backstopFile(slug, filePath, {
          userId: response.locals?.user?.id ?? null,
        });
        return response.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        console.error("[analyse-file] error:", e);
        response.status(500).json({ ok: false, error: e.message });
      }
    }
  );

  // AMAdocs: "Re-summarise" — (re)generate the granite per-doc summary for already-indexed
  // files. The cadence only re-touches new/changed files, so files indexed before
  // summaries-by-default (or before a summary prompt/model change) never (re)gain a summary on
  // their own. GnomeBridge.resummarize stamps them as "changed"; we then kick ONE bounded
  // runSync to start re-summarising now, and the background cadence drains the rest — the same
  // serial/capped/cooled/durable path as the backfill. Body: { onlyMissing?=true }.
  app.post(
    "/workspace/:slug/resummarize",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = null } = request.params;
        const { onlyMissing = true } = reqBody(request);
        const Gnome = require("../utils/GnomeBridge");

        const flip = Gnome.resummarize(slug, { onlyMissing });
        if (!flip.ok) return response.status(400).json(flip);
        if (flip.flipped === 0)
          return response.status(200).json({ ...flip, queued: 0, remaining: 0 });

        // Re-read the folder from saved state so we drive the same path as the cadence cron.
        const state = Gnome.loadState(slug);
        const { status, body } = await Gnome.runSync({
          slug,
          folder: state.folder,
          exclude: state.exclude ?? "/novels/",
          limit: 0,
          dryRun: false,
          userId: response.locals?.user?.id ?? null,
        });
        return response.status(status).json({ ...flip, ...body });
      } catch (e) {
        console.error("[resummarize] error:", e);
        response.status(500).json({ ok: false, error: e.message });
      }
    }
  );

  // AMAdocs (THE #1 RULE kill switch): instantly halt embedding/ingest for THIS
  // workspace — drops the queue and SIGTERMs the worker child. Does not touch
  // in-flight chat. Pairs with POST /system/stop-all for a global halt.
  app.post(
    "/workspace/:slug/embedding-stop",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = null } = request.params;
        const { stopWorkspace } = require("../utils/EmbeddingWorkerManager");
        const stopped = stopWorkspace(slug);
        response.status(200).json({ stopped });
      } catch (e) {
        console.error("[embedding-stop] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.delete(
    "/workspace/:slug",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      workspaceDeletionProtection,
    ],
    async (request, response) => {
      try {
        const { slug = "" } = request.params;
        const user = await userFromSession(request, response);
        const VectorDb = getVectorDbClass();
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        await WorkspaceChats.delete({ workspaceId: Number(workspace.id) });
        await DocumentVectors.deleteForWorkspace(workspace.id);
        await Document.delete({ workspaceId: Number(workspace.id) });
        await Workspace.delete({ id: Number(workspace.id) });

        await EventLogs.logEvent(
          "workspace_deleted",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          response.locals?.user?.id
        );

        try {
          await VectorDb["delete-namespace"]({ namespace: slug });
        } catch (e) {
          console.error(e.message);
        }
        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/reset-vector-db",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = "" } = request.params;
        const user = await userFromSession(request, response);
        const VectorDb = getVectorDbClass();
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        await DocumentVectors.deleteForWorkspace(workspace.id);
        await Document.delete({ workspaceId: Number(workspace.id) });

        await EventLogs.logEvent(
          "workspace_vectors_reset",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          response.locals?.user?.id
        );

        try {
          await VectorDb["delete-namespace"]({ namespace: slug });
        } catch (e) {
          console.error(e.message);
        }
        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspaces",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspaces = multiUserMode(response)
          ? await Workspace.whereWithUser(user)
          : await Workspace.where();

        response.status(200).json({ workspaces });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { slug } = request.params;
        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        response.status(200).json({ workspace });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/chats",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { slug } = request.params;
        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        const history = multiUserMode(response)
          ? await WorkspaceChats.forWorkspaceByUser(workspace.id, user.id)
          : await WorkspaceChats.forWorkspace(workspace.id);
        response.status(200).json({ history: convertToChatHistory(history) });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/delete-chats",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { chatIds = [] } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;

        if (!workspace || !Array.isArray(chatIds)) {
          response.sendStatus(400).end();
          return;
        }

        // This works for both workspace and threads.
        // we simplify this by just looking at workspace<>user overlap
        // since they are all on the same table.
        await WorkspaceChats.delete({
          id: { in: chatIds.map((id) => Number(id)) },
          user_id: user?.id ?? null,
          workspaceId: workspace.id,
        });

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/delete-edited-chats",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { startingId } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;

        await WorkspaceChats.delete({
          workspaceId: workspace.id,
          thread_id: null,
          user_id: user?.id,
          id: { gte: Number(startingId) },
        });

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update-chat",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { chatId, newText = null, role = "assistant" } = reqBody(request);
        if (!newText || !String(newText).trim())
          throw new Error("Cannot save empty edit");

        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const existingChat = await WorkspaceChats.get({
          workspaceId: workspace.id,
          thread_id: null,
          user_id: user?.id,
          id: Number(chatId),
        });
        if (!existingChat) throw new Error("Invalid chat.");

        if (role === "user") {
          await WorkspaceChats._update(existingChat.id, {
            prompt: String(newText),
          });
        } else {
          const chatResponse = safeJsonParse(existingChat.response, null);
          if (!chatResponse) throw new Error("Failed to parse chat response");
          await WorkspaceChats._update(existingChat.id, {
            response: JSON.stringify({
              ...chatResponse,
              text: String(newText),
            }),
          });
        }

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/chat-feedback/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { chatId } = request.params;
        const { feedback = null } = reqBody(request);
        const user = await userFromSession(request, response);
        const existingChat = await WorkspaceChats.get({
          id: Number(chatId),
          workspaceId: response.locals.workspace.id,
          user_id: user?.id,
        });

        if (!existingChat) return response.status(404).json({ success: false });
        await WorkspaceChats.updateFeedbackScore(chatId, feedback);
        return response.status(200).json({ success: true });
      } catch (error) {
        console.error("Error updating chat feedback:", error);
        response.status(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/suggested-messages",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const suggestedMessages =
          await WorkspaceSuggestedMessages.getMessages(slug);
        response.status(200).json({ success: true, suggestedMessages });
      } catch (error) {
        console.error("Error fetching suggested messages:", error);
        response
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/suggested-messages",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { messages = [] } = reqBody(request);
        const { slug } = request.params;
        if (!Array.isArray(messages)) {
          return response.status(400).json({
            success: false,
            message: "Invalid message format. Expected an array of messages.",
          });
        }

        await WorkspaceSuggestedMessages.saveAll(messages, slug);
        return response.status(200).json({
          success: true,
          message: "Suggested messages saved successfully.",
        });
      } catch (error) {
        console.error("Error processing the suggested messages:", error);
        response.status(500).json({
          success: true,
          message: "Error saving the suggested messages.",
        });
      }
    }
  );

  app.post(
    "/workspace/:slug/update-pin",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const { docPath, pinStatus = false } = reqBody(request);
        const workspace = response.locals.workspace;

        const document = await Document.get({
          workspaceId: workspace.id,
          docpath: docPath,
        });
        if (!document) return response.sendStatus(404).end();

        await Document.update(document.id, { pinned: pinStatus });
        return response.status(200).end();
      } catch (error) {
        console.error("Error processing the pin status update:", error);
        return response.status(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/tts/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async function (request, response) {
      try {
        const { chatId } = request.params;
        const workspace = response.locals.workspace;
        const user = await userFromSession(request, response);
        const cacheKey = `${workspace.slug}:${chatId}`;
        const wsChat = await WorkspaceChats.get({
          id: Number(chatId),
          workspaceId: workspace.id,
          user_id: user?.id,
        });

        if (!wsChat) return response.sendStatus(404);
        const cachedResponse = responseCache.get(cacheKey);
        if (cachedResponse) {
          response.writeHead(200, {
            "Content-Type": cachedResponse.mime || "audio/mpeg",
          });
          response.end(cachedResponse.buffer);
          return;
        }

        const text = safeJsonParse(wsChat.response, null)?.text;
        if (!text) return response.sendStatus(204).end();

        const TTSProvider = getTTSProvider();
        const buffer = await TTSProvider.ttsBuffer(text);
        if (buffer === null) return response.sendStatus(204).end();

        responseCache.set(cacheKey, { buffer, mime: "audio/mpeg" });
        response.writeHead(200, {
          "Content-Type": "audio/mpeg",
        });
        response.end(buffer);
        return;
      } catch (error) {
        console.error("Error processing the TTS request:", error);
        response.status(500).json({ message: "TTS could not be completed" });
      }
    }
  );

  app.get(
    "/workspace/:slug/pfp",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const cachedResponse = responseCache.get(slug);

        if (cachedResponse) {
          response.writeHead(200, {
            "Content-Type": cachedResponse.mime || "image/png",
          });
          response.end(cachedResponse.buffer);
          return;
        }

        const pfpPath = await determineWorkspacePfpFilepath(slug);

        if (!pfpPath) {
          response.sendStatus(204).end();
          return;
        }

        const { found, buffer, mime } = fetchPfp(pfpPath);
        if (!found) {
          response.sendStatus(204).end();
          return;
        }

        responseCache.set(slug, { buffer, mime });

        response.writeHead(200, {
          "Content-Type": mime || "image/png",
        });
        response.end(buffer);
        return;
      } catch (error) {
        console.error("Error processing the logo request:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-pfp",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handlePfpUpload,
    ],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const uploadedFileName = request.randomFileName;
        if (!uploadedFileName) {
          return response.status(400).json({ message: "File upload failed." });
        }

        const workspaceRecord = await Workspace.get({
          slug,
        });

        const oldPfpFilename = workspaceRecord.pfpFilename;
        if (oldPfpFilename) {
          const storagePath = path.join(__dirname, "../storage/assets/pfp");
          const oldPfpPath = path.join(
            storagePath,
            normalizePath(workspaceRecord.pfpFilename)
          );
          if (!isWithin(path.resolve(storagePath), path.resolve(oldPfpPath)))
            throw new Error("Invalid path name");
          if (fs.existsSync(oldPfpPath)) fs.unlinkSync(oldPfpPath);
        }

        const { workspace, message } = await Workspace._update(
          workspaceRecord.id,
          {
            pfpFilename: uploadedFileName,
          }
        );

        return response.status(workspace ? 200 : 500).json({
          message: workspace
            ? "Profile picture uploaded successfully."
            : message,
        });
      } catch (error) {
        console.error("Error processing the profile picture upload:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.delete(
    "/workspace/:slug/remove-pfp",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const workspaceRecord = await Workspace.get({
          slug,
        });
        const oldPfpFilename = workspaceRecord.pfpFilename;

        if (oldPfpFilename) {
          const storagePath = path.join(__dirname, "../storage/assets/pfp");
          const oldPfpPath = path.join(
            storagePath,
            normalizePath(oldPfpFilename)
          );
          if (!isWithin(path.resolve(storagePath), path.resolve(oldPfpPath)))
            throw new Error("Invalid path name");
          if (fs.existsSync(oldPfpPath)) fs.unlinkSync(oldPfpPath);
        }

        const { workspace, message } = await Workspace._update(
          workspaceRecord.id,
          {
            pfpFilename: null,
          }
        );

        // Clear the cache
        responseCache.delete(slug);

        return response.status(workspace ? 200 : 500).json({
          message: workspace
            ? "Profile picture removed successfully."
            : message,
        });
      } catch (error) {
        console.error("Error processing the profile picture removal:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/fork",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const { chatId, threadSlug } = reqBody(request);
        if (!chatId)
          return response.status(400).json({ message: "chatId is required" });

        // Get threadId we are branching from if that request body is sent
        // and is a valid thread slug.
        const threadId = !!threadSlug
          ? (
              await WorkspaceThread.get({
                slug: String(threadSlug),
                workspace_id: workspace.id,
              })
            )?.id ?? null
          : null;
        const chatsToFork = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            user_id: user?.id,
            include: true, // only duplicate visible chats
            thread_id: threadId,
            api_session_id: null, // Do not include API session chats.
            id: { lte: Number(chatId) },
          },
          null,
          { id: "asc" }
        );

        const { thread: newThread, message: threadError } =
          await WorkspaceThread.new(workspace, user?.id);
        if (threadError)
          return response.status(500).json({ error: threadError });

        let lastMessageText = "";
        const chatsData = chatsToFork.map((chat) => {
          const chatResponse = safeJsonParse(chat.response, {});
          if (chatResponse?.text) lastMessageText = chatResponse.text;

          return {
            workspaceId: workspace.id,
            prompt: chat.prompt,
            response: JSON.stringify(chatResponse),
            user_id: user?.id,
            thread_id: newThread.id,
          };
        });
        await WorkspaceChats.bulkCreate(chatsData);
        await WorkspaceThread.update(newThread, {
          name: !!lastMessageText
            ? truncate(lastMessageText, 22)
            : "Forked Thread",
        });

        await EventLogs.logEvent(
          "thread_forked",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
            threadName: newThread.name,
          },
          user?.id
        );
        response.status(200).json({ newThreadSlug: newThread.slug });
      } catch (e) {
        console.error(e.message, e);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.put(
    "/workspace/workspace-chats/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { id } = request.params;
        const user = await userFromSession(request, response);
        const validChat = await WorkspaceChats.get({
          id: Number(id),
          user_id: user?.id ?? null,
        });
        if (!validChat)
          return response
            .status(404)
            .json({ success: false, error: "Chat not found." });

        await WorkspaceChats._update(validChat.id, { include: false });
        response.json({ success: true, error: null });
      } catch (e) {
        console.error(e.message, e);
        response.status(500).json({ success: false, error: "Server error" });
      }
    }
  );

  /** Handles the uploading and embedding in one-call by uploading via drag-and-drop in chat container. */
  app.post(
    "/workspace/:slug/upload-and-embed",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (request, response) {
      try {
        const { slug = null } = request.params;
        const user = await userFromSession(request, response);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        const Collector = new CollectorApi();
        const { originalname } = request.file;
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Document ${originalname} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason, documents } =
          await Collector.processDocument(originalname);
        if (!success || documents?.length === 0) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Document ${originalname} uploaded processed and successfully. It is now available in documents.`
        );
        await Telemetry.sendTelemetry("document_uploaded");
        await EventLogs.logEvent(
          "document_uploaded",
          {
            documentName: originalname,
          },
          response.locals?.user?.id
        );

        const document = documents[0];
        // AMAdocs: by default a dropped file is only CATALOGED — embed just its
        // ~120-word summary card so the AI librarian can find it, without a full
        // scan. Full-text search is opt-in per file via the "Deep search" action
        // (POST /workspace/:slug/doc-deep-search).
        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          currWorkspace,
          [document.location],
          response.locals?.user?.id,
          { mode: "summary" }
        );

        if (failedToEmbed.length > 0)
          return response
            .status(200)
            .json({ success: false, error: errors?.[0], document: null });

        response.status(200).json({
          success: true,
          error: null,
          document: { id: document.id, location: document.location },
        });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/remove-and-unembed",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (request, response) {
      try {
        const { slug = null } = request.params;
        const body = reqBody(request);
        const user = await userFromSession(request, response);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace || !body.documentLocation)
          return response.sendStatus(400).end();

        // Will delete the document from the entire system + wil unembed it.
        await purgeDocument(body.documentLocation);
        response.status(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/prompt-history",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_, response) => {
      try {
        response.status(200).json({
          history: await Workspace.promptHistory({
            workspaceId: response.locals.workspace.id,
          }),
        });
      } catch (error) {
        console.error("Error fetching prompt history:", error);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/prompt-history",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (_, response) => {
      try {
        response.status(200).json({
          success: await Workspace.deleteAllPromptHistory({
            workspaceId: response.locals.workspace.id,
          }),
        });
      } catch (error) {
        console.error("Error clearing prompt history:", error);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/prompt-history/:id",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const { id } = request.params;
        response.status(200).json({
          success: await Workspace.deletePromptHistory({
            workspaceId: response.locals.workspace.id,
            id: Number(id),
          }),
        });
      } catch (error) {
        console.error("Error deleting prompt history:", error);
        response.sendStatus(500).end();
      }
    }
  );

  /**
   * Searches for workspaces and threads by thread name or workspace name.
   * Only returns assets owned by the user (if multi-user mode is enabled).
   */
  app.post(
    "/workspace/search",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { searchTerm } = reqBody(request);
        const searchResults = await searchWorkspaceAndThreads(
          searchTerm,
          response.locals?.user
        );
        response.status(200).json(searchResults);
      } catch (error) {
        console.error("Error searching for workspaces:", error);
        response.sendStatus(500).end();
      }
    }
  );

  // SSE endpoint for embedding progress
  app.get(
    "/workspace/:slug/embed-progress",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const {
          addSSEConnection,
          removeSSEConnection,
        } = require("../utils/EmbeddingWorkerManager");

        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
        addSSEConnection(workspace.slug, response);
        request.on("close", () => {
          removeSSEConnection(workspace.slug, response);
        });
      } catch (e) {
        console.error(e.message, e);
        response.status(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/embed-queue",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { filename } = reqBody(request);
        if (!filename) {
          response
            .status(400)
            .json({ success: false, error: "Missing filename" });
          return;
        }

        const { removeQueuedFile } = require("../utils/EmbeddingWorkerManager");
        const sent = removeQueuedFile(workspace.slug, filename);
        response.status(200).json({ success: sent });
      } catch (e) {
        console.error(e.message, e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/workspace/:slug/is-agent-command-available",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_, response) => {
      try {
        response.status(200).json({
          showAgentCommand: await Workspace.isAgentCommandAvailable(
            response.locals.workspace
          ),
        });
      } catch (error) {
        console.error("Error checking if agent command is available:", error);
        response.status(500).json({ showAgentCommand: true });
      }
    }
  );

  // AMAdocs: return a single document's extracted text for the in-app viewer pane.
  app.get(
    "/workspace/:slug/doc-view",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const docpath = request.query.path;
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });
        const { fileData } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data)
          return response.status(404).json({ error: "Document not found" });
        response.status(200).json({
          title: data.title || "Document",
          pageContent: data.pageContent || "",
          wordCount: data.wordCount || null,
          docAuthor: data.docAuthor || null,
          description: data.description || null,
          aiSummary: data.aiSummary || null, // AMAdocs: ingest-time gist for the semantic file browser
          pages: Array.isArray(data.pages) ? data.pages : null, // AMAdocs: page ranges for jump-to-page
        });
      } catch (e) {
        console.error("[doc-view] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: generate a short "catalog card" summary for ONE document on demand
  // (the right-click "Summarize" action). Uses the workspace's chat model. The
  // summary is cached on the document JSON (`aiSummary`); a cached value is returned
  // immediately unless `force` is set. This is the on-demand counterpart to the
  // opt-in auto-summarise-at-ingest path (DOC_SUMMARY_ENABLED).
  app.post(
    "/workspace/:slug/doc-summarize",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { path: docpath, force = false } = reqBody(request);
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });

        const {
          fileData,
          documentsPath,
          normalizePath,
          isWithin,
        } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data)
          return response.status(404).json({ error: "Document not found" });

        if (data.aiSummary && !force)
          return response
            .status(200)
            .json({ summary: data.aiSummary, cached: true });

        const DocSummary = require("../utils/DocSummary");
        const summary = await new DocSummary({
          model: workspace?.chatModel || process.env.OLLAMA_MODEL_PREF || null,
        }).summarize(data.pageContent || "", {
          title: data.title,
          pages: Array.isArray(data.pages) ? data.pages : null,
        });

        if (!summary)
          return response.status(200).json({
            summary: null,
            cached: false,
            error:
              "Couldn’t generate a summary — the AI model may still be downloading.",
          });

        // Persist the summary back onto the document JSON (path-traversal safe).
        try {
          const fs = require("fs");
          const fullPath = path.resolve(documentsPath, normalizePath(docpath));
          if (isWithin(documentsPath, fullPath) && fs.existsSync(fullPath)) {
            data.aiSummary = summary;
            fs.writeFileSync(fullPath, JSON.stringify(data, null, 4), {
              encoding: "utf-8",
            });
          }
        } catch (werr) {
          console.error("[doc-summarize] write-back failed:", werr.message);
        }

        response.status(200).json({ summary, cached: false });
      } catch (e) {
        console.error("[doc-summarize] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: "Deep search" a single document on demand (the right-click action).
  // By default a dropped file is only CATALOGED — its ~120-word summary card is
  // embedded so the librarian can find it, but the full text is not. This upgrades
  // ONE file to full-text semantic search IN PLACE: drop the summary vectors and
  // re-embed the document's full content under the SAME docId, keeping the
  // workspace_documents row and the retained original file untouched. Idempotent
  // (re-running just re-embeds the full text again).
  app.post(
    "/workspace/:slug/doc-deep-search",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { path: docpath } = reqBody(request);
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });

        const docRow = await Document.get({
          docpath,
          workspaceId: workspace.id,
        });
        if (!docRow)
          return response
            .status(404)
            .json({ error: "Document is not in this workspace." });

        const { fileData } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data || !data.pageContent)
          return response
            .status(404)
            .json({ error: "Document content not found." });

        const prisma = require("../utils/prisma");
        const VectorDb = getVectorDbClass();
        const docId = docRow.docId;

        // Drop the existing (summary-only) vectors for this doc, then clear the stale
        // docId→vectorId rows (deleteDocumentFromNamespace only removes them from the
        // vector table, not the DB mapping), then re-embed the FULL text under the
        // same docId. skipCache=true is REQUIRED: the vector cache is keyed on docpath
        // and still holds the summary chunks, so without it the re-embed would just
        // restore the summary instead of the full text.
        await VectorDb.deleteDocumentFromNamespace(workspace.slug, docId);
        await prisma.document_vectors.deleteMany({ where: { docId } });
        const { vectorized, error } = await VectorDb.addDocumentToNamespace(
          workspace.slug,
          { ...data, docId },
          docpath,
          true // skipCache
        );
        if (!vectorized)
          return response.status(200).json({
            success: false,
            error: error || "Could not deep search this document.",
          });

        // Flag the row as deep-searched so the UI reflects it and it survives reloads.
        try {
          const meta = safeJsonParse(docRow.metadata, {});
          meta.amadocsSearchMode = "deep";
          await prisma.workspace_documents.update({
            where: { id: docRow.id },
            data: { metadata: JSON.stringify(meta) },
          });
        } catch (merr) {
          console.error("[doc-deep-search] mode flag failed:", merr.message);
        }

        response.status(200).json({ success: true, error: null, mode: "deep" });
      } catch (e) {
        console.error("[doc-deep-search] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: stream a document's ORIGINAL file (PDF/DOCX/image/etc.) so the
  // in-app viewer can show the "pretty" version with graphics & layout. The AI
  // still reads the extracted text (doc-view); this is for the human only.
  app.get(
    "/workspace/:slug/doc-original",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const fs = require("fs");
        const path = require("path");
        const docpath = request.query.path;
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });

        const { fileData } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data || !data.id)
          return response.status(404).json({ error: "Document not found" });

        const MIME = {
          ".pdf": "application/pdf",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".bmp": "image/bmp",
          ".docx":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".xlsx":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ".csv": "text/csv",
          ".txt": "text/plain",
          ".md": "text/markdown",
        };
        const streamFile = (absPath) => {
          const ext = path.extname(absPath).toLowerCase();
          response.setHeader(
            "Content-Type",
            MIME[ext] || "application/octet-stream"
          );
          return response.sendFile(path.resolve(absPath));
        };

        const originalsPath = amadocsOriginalsDir();

        // Find the stored original by document id (<id><ext>). The id is a uuid
        // so a prefix match is safe from traversal/collision.
        let match = null;
        if (fs.existsSync(originalsPath)) {
          match = fs
            .readdirSync(originalsPath)
            .find((f) => f.startsWith(`${data.id}.`));
        }
        if (match) return streamFile(path.resolve(originalsPath, match));

        // AMAdocs: in-place docs (TinySPARQL ride-on OR collector-backstop) have no
        // retained original — they reference the user's real file via sourcePath.
        // Stream that so they're first-class for the viewer + citation loop
        // (passage-highlight works via PDF.js text-match; only the page-number chip
        // label is unavailable, since flat extracted text has no page ranges).
        if (data.amadocsSource && data.sourcePath) {
          try {
            if (fs.statSync(data.sourcePath).isFile())
              return streamFile(data.sourcePath);
          } catch (_) {
            /* file moved/unreadable — fall through to 404 */
          }
        }
        return response
          .status(404)
          .json({ error: "No original retained for this document" });
      } catch (e) {
        console.error("[doc-original] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: export a photo together with everything AMAdocs understands about it —
  // the AI vision description, any OCR'd text, the original camera EXIF, and source
  // provenance — as a ZIP: the original file (untouched) + a readable JSON sidecar.
  // This lets the AI's understanding travel WITH the photo into other tools. Originals
  // are never modified; we stream a copy. Sidecar form (no embedding) keeps it
  // format-agnostic (PNG/JPG/HEIC/…) and robust.
  app.get(
    "/workspace/:slug/doc-export",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const fs = require("fs");
        const path = require("path");
        const archiver = require("archiver");
        const docpath = request.query.path;
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });

        const { fileData } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data || !data.id)
          return response.status(404).json({ error: "Document not found" });

        const originalsPath = amadocsOriginalsDir();
        // Find the retained original by uuid prefix (<id><ext>) — traversal-safe.
        let match = null;
        if (fs.existsSync(originalsPath))
          match = fs
            .readdirSync(originalsPath)
            .find((f) => f.startsWith(`${data.id}.`));
        if (!match)
          return response
            .status(404)
            .json({ error: "No original retained for this document" });
        const originalFile = path.resolve(originalsPath, match);
        const ext = path.extname(match).toLowerCase();

        const displayName = data.title || match;
        const baseName = displayName.replace(/\.[^.]+$/, "");
        const safeName = baseName.replace(/[^\w.-]+/g, "_") || "photo";
        // Same payload the native-metadata embed writes — one source of truth.
        const sidecar = await amadocsExtractMetadata({
          data,
          slug: request.params.slug,
          originalFile,
          ext,
        });

        response.setHeader("Content-Type", "application/zip");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-export.zip"`
        );
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (e) => {
          console.error("[doc-export] archive error:", e);
          if (!response.headersSent) response.status(500);
          try {
            response.end();
          } catch (_) {}
        });
        archive.pipe(response);
        archive.file(originalFile, { name: displayName });
        archive.append(JSON.stringify(sidecar, null, 2), {
          name: `${baseName}.amadocs.json`,
        });
        await archive.finalize();
      } catch (e) {
        console.error("[doc-export] error:", e);
        if (!response.headersSent)
          response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: download a COPY of a document with its AI summary embedded in the file's
  // OWN native metadata (PDF /Subject, Office dc:description, JPEG EXIF, PNG iTXt), so
  // the gist travels inside the file. The user's source is NEVER touched — we read the
  // retained original into a buffer, embed, and stream a new file. Major formats only
  // (jpg/png/pdf/office); others 415. Generates the summary on the fly if not cached.
  app.get(
    "/workspace/:slug/doc-export-embedded",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const fs = require("fs");
        const docpath = request.query.path;
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });

        const {
          fileData,
          documentsPath,
          normalizePath,
          isWithin,
        } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data || !data.id)
          return response.status(404).json({ error: "Document not found" });

        const originalFile = amadocsRetainedOriginal(data.id);
        if (!originalFile)
          return response
            .status(404)
            .json({ error: "No original retained for this document" });
        const ext = path.extname(originalFile).toLowerCase();

        const {
          embedMetadata,
          SUPPORTED_EMBED_EXTS,
        } = require("../utils/MetadataEmbed");
        if (!SUPPORTED_EMBED_EXTS.includes(ext))
          return response.status(415).json({
            error: `Embedding metadata into ${ext} files isn’t supported yet.`,
          });

        // Use the cached summary, or generate one now with the workspace's chat model.
        let summary = data.aiSummary;
        if (!summary) {
          const DocSummary = require("../utils/DocSummary");
          summary = await new DocSummary({
            model:
              response.locals.workspace?.chatModel ||
              process.env.OLLAMA_MODEL_PREF ||
              null,
          }).summarize(data.pageContent || "", {
            title: data.title,
            pages: Array.isArray(data.pages) ? data.pages : null,
          });
          if (summary) {
            try {
              const full = path.resolve(documentsPath, normalizePath(docpath));
              if (isWithin(documentsPath, full) && fs.existsSync(full)) {
                data.aiSummary = summary;
                fs.writeFileSync(full, JSON.stringify(data, null, 4));
              }
            } catch (werr) {
              console.error("[doc-export-embedded] write-back:", werr.message);
            }
          }
        }
        if (!summary)
          return response.status(200).json({
            summary: null,
            error:
              "Couldn’t generate a summary — the AI model may still be downloading.",
          });

        // Build the full payload (summary + AI description + OCR + provenance + EXIF) and
        // embed ALL of it into the file's native metadata — the same data the sidecar JSON
        // carries, now travelling inside the file itself.
        const metadata = await amadocsExtractMetadata({
          data,
          slug: request.params.slug,
          originalFile,
          ext,
        });
        const original = fs.readFileSync(originalFile);
        const out = await embedMetadata({ buffer: original, ext, metadata });
        if (!out || !out.buffer)
          return response
            .status(500)
            .json({ error: "Couldn’t embed the metadata into this file." });

        const displayName = data.title || path.basename(originalFile);
        const base = displayName.replace(/\.[^.]+$/, "");
        const safeBase = base.replace(/[^\w.-]+/g, "_") || "document";
        response.setHeader("Content-Type", out.contentType);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeBase}-with-info${ext}"`
        );
        response.send(out.buffer);
      } catch (e) {
        console.error("[doc-export-embedded] error:", e);
        if (!response.headersSent)
          response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: the absolute path of AMAdocs' OWN retained copy of a document, so the
  // UI's "show in file manager" still works when we don't know where the user's
  // original came from. Transparency: a user's files are never hidden from them —
  // they can always find AMAdocs' copy on disk, on their own machine.
  app.get(
    "/workspace/:slug/original-location",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const docpath = request.query.path;
        if (!docpath)
          return response.status(400).json({ error: "Missing document path" });
        const { fileData } = require("../utils/files");
        const data = await fileData(docpath); // path-traversal protected
        if (!data || !data.id)
          return response.status(404).json({ ok: false, error: "not-found" });
        const original = amadocsRetainedOriginal(data.id);
        if (!original)
          return response.status(404).json({ ok: false, error: "not-found" });
        response.status(200).json({ ok: true, path: original });
      } catch (e) {
        console.error("[original-location] error:", e);
        response.status(500).json({ ok: false, error: e.message });
      }
    }
  );

  // AMAdocs: where AMAdocs keeps every file's retained copy on this computer.
  // Surfaced in the UI so the user can open the folder and see/manage their docs
  // directly — they own the files and the machine; nothing is hidden from them.
  app.get(
    "/system/storage-location",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_request, response) => {
      try {
        const dir = amadocsOriginalsDir();
        response
          .status(200)
          .json({ ok: true, path: dir, exists: fs.existsSync(dir) });
      } catch (e) {
        response.status(500).json({ ok: false, error: e.message });
      }
    }
  );

  // AMAdocs: curated catalog of models the user may DOWNLOAD from inside the app.
  // This is the single source of truth for what's offered — every entry is an
  // OSI-permissive licence (MIT / Apache-2.0) so the product never pulls a
  // research/non-commercial model. The pull endpoint refuses anything not here.
  // Sizes are approximate (4-bit quantised) and only used for display.
  const AMADOCS_MODEL_CATALOG = [
    { id: "granite4.1:3b", name: "Granite 4 (small)", license: "Apache-2.0", sizeGB: 2.1, desc: "IBM · tuned to answer from your documents, not guess · the default", default: true },
    { id: "phi4-mini", name: "Phi-4 mini", license: "MIT", sizeGB: 2.5, desc: "Sharp all-rounder · Microsoft" },
    { id: "phi3.5", name: "Phi-3.5", license: "MIT", sizeGB: 2.2, desc: "Older balanced all-rounder · Microsoft" },
    { id: "qwen3:1.7b", name: "Qwen 3 (small)", license: "Apache-2.0", sizeGB: 1.4, desc: "Light & fast · great on modest laptops" },
    { id: "qwen3:4b", name: "Qwen 3", license: "Apache-2.0", sizeGB: 2.6, desc: "Strong all-rounder · needs more memory" },
    { id: "mistral", name: "Mistral", license: "Apache-2.0", sizeGB: 4.1, desc: "Larger · best on a powerful computer" },
    // type:"vision" — not a chat model. It lets AMAdocs "see" images so photos,
    // whiteboards, receipts and screenshots become searchable. The UI offers it
    // to download but never lists it as a chat model to switch to.
    { id: "moondream", name: "Image understanding", license: "Apache-2.0", sizeGB: 1.7, desc: "Lets AMAdocs read photos & scans · makes images searchable", type: "vision" },
  ];

  // AMAdocs: the download catalog (permissive models the app offers to fetch).
  app.get(
    "/system/model-catalog",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_request, response) => {
      response.status(200).json({ models: AMADOCS_MODEL_CATALOG });
    }
  );

  // AMAdocs: download (pull) a permissive model from Ollama, streaming progress
  // to the UI as SSE. Refuses any model not in the curated catalog above.
  app.post(
    "/system/pull-model",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      const { model } = reqBody(request);
      const allowed = AMADOCS_MODEL_CATALOG.some((m) => m.id === model);
      if (!model || !allowed)
        return response
          .status(400)
          .json({ error: "That model isn't available for download." });
      if (!process.env.OLLAMA_BASE_PATH)
        return response.status(500).json({ error: "No local AI runtime found." });

      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders?.();
      const send = (obj) => response.write(`data: ${JSON.stringify(obj)}\n\n`);

      const controller = new AbortController();
      request.on("close", () => controller.abort());

      try {
        const ollama = await fetch(
          `${process.env.OLLAMA_BASE_PATH}/api/pull`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, stream: true }),
            signal: controller.signal,
          }
        );
        if (!ollama.ok || !ollama.body)
          throw new Error(`runtime returned ${ollama.status}`);

        // Ollama streams newline-delimited JSON; relay each line as an SSE event
        // with a normalised percent so the UI can draw one progress bar.
        const reader = ollama.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            let j;
            try {
              j = JSON.parse(line);
            } catch (_) {
              continue;
            }
            if (j.error) {
              send({ error: j.error });
              return response.end();
            }
            const percent =
              j.total && j.completed
                ? Math.round((j.completed / j.total) * 100)
                : null;
            send({
              status: j.status || "",
              completed: j.completed || 0,
              total: j.total || 0,
              percent,
            });
          }
        }
        send({ done: true });
        response.end();
      } catch (e) {
        if (controller.signal.aborted) return; // client navigated away
        console.error("[pull-model] error:", e);
        send({ error: "Download failed. Check your internet connection." });
        response.end();
      }
    }
  );

  // AMAdocs: status document. The app opens to this on launch (rendered in the
  // preview pane) so index/database/model/version live in one uncluttered place
  // instead of a settings screen. Generated live, persisted to
  // storage/AMADOCS-STATUS.md (a real Markdown file the app keeps current), and
  // returned as { markdown } for the renderer.
  app.get(
    "/amadocs-status",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_request, response) => {
      try {
        const { markdown, data } = await buildAmadocsStatus();
        try {
          fs.writeFileSync(
            path.resolve(amadocsStorageRoot(), "AMADOCS-STATUS.md"),
            markdown,
            "utf8"
          );
        } catch (_) {
          /* preview still works even if the file write fails */
        }
        response.status(200).json({ markdown, data });
      } catch (e) {
        console.error("[amadocs-status] error:", e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // AMAdocs: set the indexing PACE — the rest the worker takes between summaries (the
  // Homepage slider). One honest user-controlled knob for thermal/quiet trade-offs instead
  // of brittle per-machine auto-tuning; persisted by GnomeBridge and read live on the next
  // sync (no restart). Body: { summaryCooldownMs }. Returns the clamped value stored.
  app.post(
    "/amadocs-settings",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { summaryCooldownMs } = reqBody(request);
        const Gnome = require("../utils/GnomeBridge");
        const stored = Gnome.setPaceMs(summaryCooldownMs);
        response.status(200).json({ ok: true, pace: { summaryCooldownMs: stored } });
      } catch (e) {
        console.error("[amadocs-settings] error:", e);
        response.status(400).json({ ok: false, error: e.message });
      }
    }
  );

  // Parsed Files in separate endpoint just to keep the workspace endpoints clean
  workspaceParsedFilesEndpoints(app);
}

module.exports = { workspaceEndpoints };
