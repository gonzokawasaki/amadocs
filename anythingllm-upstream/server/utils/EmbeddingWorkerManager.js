const path = require("path");
const { EventLogs } = require("../models/eventLogs");

/** @type {Map<string, { worker: ChildProcess, jobId: string }>} */
const runningWorkers = new Map();

/** @type {Map<string, Set<import("express").Response>>} */
const sseConnections = new Map();

/** @type {Map<string, object[]>} Buffered events per workspace for SSE replay */
const eventHistory = new Map();

// AMAdocs (THE #1 RULE): a global STOP must *stay* stopped. The hard STOP suspends
// all ingest; if the background cadence scheduler ([[k-base-ingest-safety]]) just
// re-dispatched a delta-sync seconds later it would defeat the kill switch. So
// stopAll() latches this flag and the cadence scheduler skips while it is set. It is
// cleared only by an EXPLICIT user-driven sync (real, non-dryRun gnome-sync run) or a
// fresh app launch (the flag is in-memory) — never silently by the scheduler itself.
let ingestPaused = false;
function isIngestPaused() {
  return ingestPaused;
}
function setIngestPaused(value) {
  ingestPaused = !!value;
}
// Is ANY embedding worker currently running? The cadence scheduler uses this to stay
// strictly serial machine-wide — it won't dispatch a new folder's embed while another
// workspace is still embedding.
function hasRunningWorker() {
  return runningWorkers.size > 0;
}

/**
 * Write an SSE event payload to all connected clients for a workspace.
 * Also called by Document.addDocuments for the non-native embedder path.
 */
function emitProgress(slug, event) {
  if (typeof event === "object" && event !== null) {
    if (!eventHistory.has(slug)) eventHistory.set(slug, []);
    eventHistory.get(slug).push(event);

    if (event.type === "all_complete")
      setTimeout(() => eventHistory.delete(slug), 10_000);
  }

  const connections = sseConnections.get(slug);
  if (!connections || connections.size === 0) return;
  const data = `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`;
  for (const res of connections) {
    try {
      res.write(data);
    } catch {
      connections.delete(res);
    }
  }
}

function logEmbeddingEvent(msg) {
  EventLogs.logEvent(
    "workspace_documents_added",
    {
      workspaceName: msg.workspaceSlug,
      embeddedFiles: msg.embeddedFiles ?? [],
      failedFiles: msg.failedFiles ?? [],
      embedded: msg.embedded ?? 0,
      failed: msg.failed ?? 0,
    },
    msg.userId ?? null
  ).catch(() => {});
}

function addSSEConnection(slug, res) {
  if (!sseConnections.has(slug)) sseConnections.set(slug, new Set());
  sseConnections.get(slug).add(res);

  // Only replay buffered events when a worker is actively running.
  // If the worker has already exited the history is stale (e.g. contains
  // all_complete from a previous run) and replaying it would poison a
  // new SSE connection opened for a subsequent embedding job.
  if (!runningWorkers.has(slug)) return;

  const history = eventHistory.get(slug);
  if (history) {
    for (const event of history) {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        break;
      }
    }
  }
}

function removeSSEConnection(slug, res) {
  const set = sseConnections.get(slug);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseConnections.delete(slug);
}

/**
 * Dispatch files to an embedding worker for the native embedder.
 * If a worker is already running for this workspace, appends files to it.
 * Otherwise spawns a new worker via BackgroundService.
 *
 * @param {string} slug - Workspace slug
 * @param {string[]} files - Document paths to embed
 * @param {number} workspaceId - Workspace DB id
 * @param {number|null} userId
 * @param {{onDocComplete?: (docpath: string) => void, onDocFailed?: (docpath: string, error: string) => void, onComplete?: (summary: object) => void}} [hooks]
 *   AMAdocs: optional in-process callbacks invoked from the worker message switch.
 *   Used by gnome-sync to finalize durable state per CONFIRMED doc (not at dispatch
 *   time, which would lie if the worker later crashed). No protocol change for other
 *   callers — they simply pass no hooks.
 */
async function embedFiles(slug, files, workspaceId, userId, hooks = {}) {
  if (runningWorkers.has(slug)) {
    const entry = runningWorkers.get(slug);
    try {
      // Adopt the latest caller's finalize hooks so appended files are tracked too.
      entry.hooks = hooks;
      entry.worker.send({
        type: "add_files",
        files,
        cooldownMs: embedCooldownMs(),
      });
      return;
    } catch {
      runningWorkers.delete(slug);
    }
  }

  // Clear stale event history from any previous run so new SSE
  // connections don't replay old events (including all_complete).
  eventHistory.delete(slug);

  const { BackgroundService } = require("./BackgroundWorkers");
  const bg = new BackgroundService();
  const scriptPath = path.resolve(bg.jobsRoot, "embedding-worker.js");
  const { worker, jobId } = await bg.spawnWorker(scriptPath);

  runningWorkers.set(slug, { worker, jobId, hooks, stopped: false });
  let workerCompleted = false;
  worker.on("message", (msg) => {
    if (!msg || !msg.type) return;
    // Read hooks off the entry each time so a later embedFiles() that appended
    // files (and replaced the hooks) is honoured.
    const h = runningWorkers.get(slug)?.hooks || {};
    if (msg.type === "doc_complete") h.onDocComplete?.(msg.filename);
    else if (msg.type === "doc_failed") h.onDocFailed?.(msg.filename, msg.error);
    else if (msg.type === "all_complete") {
      workerCompleted = true;
      logEmbeddingEvent(msg);
      h.onComplete?.(msg);
    }
    emitProgress(slug, msg);
  });

  worker.on("exit", (code) => {
    const entry = runningWorkers.get(slug);
    const wasStopped = entry?.worker === worker && entry?.stopped;
    if (entry?.worker === worker) {
      runningWorkers.delete(slug);
    }
    bg.removeJob(jobId).catch(() => {});

    // AMAdocs: a deliberate STOP exited the worker — emit a clean `stopped`, NOT the
    // "exited unexpectedly" all_complete that would otherwise fire.
    if (wasStopped) {
      emitProgress(slug, { type: "stopped", workspaceSlug: slug });
      return;
    }

    if (!workerCompleted) {
      emitProgress(slug, {
        type: "all_complete",
        workspaceSlug: slug,
        error: `Worker exited unexpectedly (code ${code ?? "unknown"})`,
        embedded: 0,
        failed: 0,
      });
    }
  });

  worker.on("error", (err) => {
    console.error(
      `[EmbeddingWorkerManager] Worker error for ${slug}:`,
      err.message
    );
    if (runningWorkers.get(slug)?.worker === worker) {
      runningWorkers.delete(slug);
    }
  });

  worker.send({
    type: "embed",
    files,
    workspaceSlug: slug,
    workspaceId,
    userId,
    cooldownMs: embedCooldownMs(),
  });
}

/**
 * AMAdocs (THE #1 RULE kill switch): instantly halt embedding for one workspace.
 * Sends a `stop` (so the worker drops its queue + acks) then SIGTERMs the child as a
 * hard backstop. The worker's `exit` handler clears runningWorkers and emits
 * `stopped`. Does NOT touch in-flight chat — this is the ingest stop only.
 * @param {string} slug
 * @returns {boolean} true if a worker was running and was signalled
 */
function stopWorkspace(slug) {
  const entry = runningWorkers.get(slug);
  if (!entry) return false;
  entry.stopped = true;
  try {
    entry.worker.send({ type: "stop" });
  } catch {
    /* worker may already be gone */
  }
  try {
    entry.worker.kill("SIGTERM");
  } catch {
    /* worker may already have exited */
  }
  eventHistory.delete(slug);
  return true;
}

/**
 * AMAdocs: global STOP — halt embedding across every workspace.
 * @returns {string[]} the slugs that had a running worker
 */
function stopAll() {
  // Latch the global pause so the background cadence scheduler doesn't quietly
  // resume embedding right after the user hit STOP. Cleared only by an explicit
  // user-driven sync or the next app launch.
  ingestPaused = true;
  const slugs = [...runningWorkers.keys()];
  for (const slug of slugs) stopWorkspace(slug);
  return slugs;
}

/**
 * Remove a queued (not yet processing) file from the embedding worker.
 * @param {string} slug - Workspace slug
 * @param {string} filename - Document path to dequeue
 * @returns {boolean} true if the message was sent to the worker
 */
function removeQueuedFile(slug, filename) {
  const entry = runningWorkers.get(slug);
  if (!entry) return false;
  try {
    entry.worker.send({ type: "remove_file", filename });
  } catch {
    return false;
  }

  // Scrub the file from the event history so replayed SSE state is consistent.
  const history = eventHistory.get(slug);
  if (history) {
    const cleaned = history.filter(
      (e) => !(e.filename === filename && e.type !== "file_removed")
    );
    for (const e of cleaned) {
      if (e.type === "batch_starting" && e.filenames) {
        e.filenames = e.filenames.filter((f) => f !== filename);
        e.totalDocs = e.filenames.length;
      }
    }
    eventHistory.set(slug, cleaned);
  }
  return true;
}

function isNativeEmbedder() {
  const engine = process.env.EMBEDDING_ENGINE;
  return !engine || engine === "native";
}

// AMAdocs (THE #1 RULE — "don't kill their machine"): deliberate cool-down between
// documents so a long ingest never pins the machine. Read once per dispatch from
// EMBED_COOLDOWN_MS (ms); default 750ms, set 0 in dev for fast iteration. A negative
// or non-numeric value falls back to the default.
function embedCooldownMs() {
  const v = Number(process.env.EMBED_COOLDOWN_MS);
  return Number.isFinite(v) && v >= 0 ? v : 750;
}

module.exports = {
  emitProgress,
  addSSEConnection,
  removeSSEConnection,
  embedFiles,
  removeQueuedFile,
  isNativeEmbedder,
  stopWorkspace,
  stopAll,
  isIngestPaused,
  setIngestPaused,
  hasRunningWorker,
};
