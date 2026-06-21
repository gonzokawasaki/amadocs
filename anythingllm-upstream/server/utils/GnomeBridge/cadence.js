// AMAdocs: background indexing cadence scheduler.
//
// The "ride on GNOME" sync (GnomeBridge.runSync) keeps a folder's embeddings in step
// with the OS index, but each call is BOUNDED (GNOME_SYNC_CAP) and the no-limit
// overflow plus any files dropped by a crash/quit mid-batch are deliberately left
// un-finalized so the *next* sync re-sees them (the durable "continue" contract). This
// scheduler is what actually fires those next syncs:
//
//   • on relaunch — resume pending/overflow files for every folder ever synced, and
//   • on a light periodic tick — pick up new/changed/deleted files going forward.
//
// THE #1 RULE ([[k-base-ingest-safety]]) governs every line here:
//   - SERIAL, machine-wide: never dispatch a folder's embed while ANY worker is still
//     embedding (Embed.hasRunningWorker) — one folder at a time, no piling on.
//   - RESPECTS THE GLOBAL STOP: skips entirely while Embed.isIngestPaused() is latched
//     (set by stopAll). The kill switch stays killed until the user explicitly re-syncs
//     or relaunches.
//   - NEVER POKES THE OS INDEXER SILENTLY: runs with reconcile:false, so on a box where
//     LocalSearch is dormant it just no-ops (503) and retries next tick — it never
//     restarts a system service behind the user's back.
//   - BOUNDED: relies on runSync's own per-call cap + the embedder's per-doc cool-down.

const Gnome = require("./index");
const Embed = require("../EmbeddingWorkerManager");

// Off switch + cadence knobs (env, all optional).
//   GNOME_CADENCE_DISABLED=1   → scheduler never starts (dev / opt-out).
//   GNOME_CADENCE_MS           → periodic tick interval (default 15 min; min 60s).
//   GNOME_CADENCE_RESUME_MS    → delay before the first (resume) tick after boot
//                                (default 8s — let the server settle first).
//   GNOME_CADENCE_FOLLOWUP_MS  → short follow-up delay when a tick left work behind
//                                (default 45s — drain overflow without hammering).
const DISABLED = ["1", "true", "yes"].includes(
  String(process.env.GNOME_CADENCE_DISABLED || "").toLowerCase()
);
const clampMs = (v, def, min) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};
const PERIOD_MS = clampMs(process.env.GNOME_CADENCE_MS, 15 * 60_000, 60_000);
const RESUME_MS = clampMs(process.env.GNOME_CADENCE_RESUME_MS, 8_000, 1_000);
const FOLLOWUP_MS = clampMs(process.env.GNOME_CADENCE_FOLLOWUP_MS, 45_000, 5_000);

let started = false;
let ticking = false; // re-entrancy guard — only one tick in flight at a time
let intervalHandle = null;
let followupHandle = null;

function log(...args) {
  console.log("\x1b[35m[gnome-cadence]\x1b[0m", ...args);
}

// One pass over every known folder. Returns true if work remains (so the caller can
// schedule a short follow-up instead of waiting a full period).
async function tick() {
  if (ticking) return false; // a previous tick is still running
  ticking = true;
  let workRemains = false;
  try {
    if (Embed.isIngestPaused()) return false; // global STOP latched — stay stopped
    if (Embed.hasRunningWorker()) {
      // Something is already embedding (a user sync, or our own prior dispatch still
      // draining). Stay serial: let it finish, retry shortly.
      return true;
    }

    const slugs = Gnome.listSyncedSlugs();
    if (slugs.length === 0) return false;

    for (const slug of slugs) {
      // Re-check the guards before EACH folder — a user STOP or a dispatch from the
      // previous folder must halt the loop immediately.
      if (Embed.isIngestPaused()) return false;
      if (Embed.hasRunningWorker()) return true;

      const state = Gnome.loadState(slug);
      if (!state || !state.folder) continue;

      let res;
      try {
        res = await Gnome.runSync({
          slug,
          folder: state.folder,
          exclude: state.exclude ?? "/novels/",
          limit: 0,
          dryRun: false,
          reconcile: false, // never silently restart the OS indexer
          fromScheduler: true, // do NOT clear a STOP-latched pause
        });
      } catch (e) {
        log(`sync error for "${slug}": ${e.message}`);
        continue;
      }

      // 503 = OS indexer not reachable (dormant box). Not an error — just nothing to
      // do this pass; try again next tick.
      if (res.status === 503) continue;

      if (res.status === 202) {
        const { queued = 0, deleted = 0, remaining = 0 } = res.body || {};
        if (queued > 0 || deleted > 0)
          log(`"${slug}": queued ${queued}, deleted ${deleted}, ${remaining} remaining`);
        // Either we just dispatched a batch (a worker is now running → must drain
        // before the next folder) or there is capped-overflow still to do. Both mean
        // "come back soon", and both mean STOP touching folders this pass.
        if (queued > 0 || remaining > 0) {
          workRemains = true;
          break;
        }
      }
    }
  } finally {
    ticking = false;
  }
  return workRemains;
}

// Run a tick and, if it left work behind (overflow to drain or a worker still busy),
// schedule a single short follow-up. The periodic interval is the steady-state driver;
// the follow-up just makes "resume on relaunch" / large-batch drains progress promptly
// instead of waiting a whole period between bounded chunks.
async function runAndChase() {
  let remains = false;
  try {
    remains = await tick();
  } catch (e) {
    log(`tick failed: ${e.message}`);
  }
  if (followupHandle) {
    clearTimeout(followupHandle);
    followupHandle = null;
  }
  if (remains) {
    followupHandle = setTimeout(runAndChase, FOLLOWUP_MS);
    if (followupHandle.unref) followupHandle.unref();
  }
}

// Start the scheduler. Idempotent. Called once from server boot (utils/boot).
function start() {
  if (started) return;
  if (DISABLED) {
    log("disabled via GNOME_CADENCE_DISABLED");
    return;
  }
  started = true;

  // Resume pass shortly after boot (don't block the listen callback).
  const resumeHandle = setTimeout(runAndChase, RESUME_MS);
  if (resumeHandle.unref) resumeHandle.unref();

  // Steady-state periodic tick.
  intervalHandle = setInterval(runAndChase, PERIOD_MS);
  if (intervalHandle.unref) intervalHandle.unref();

  log(
    `started — resume in ${Math.round(RESUME_MS / 1000)}s, tick every ${Math.round(
      PERIOD_MS / 60_000
    )}m`
  );
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
  if (followupHandle) clearTimeout(followupHandle);
  intervalHandle = followupHandle = null;
  started = false;
}

module.exports = { start, stop, tick, runAndChase };
