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
//   GNOME_CADENCE_MS           → steady-state tick interval (default 2 min; min 60s).
//                                A tick is a cheap TinySPARQL-vs-state diff (no model
//                                inference); in the cloud-only build embed/summary/vision
//                                run remotely, so there is no local-GPU reason to space
//                                ticks out, and a no-change tick costs nothing (embeds
//                                fire only when a file actually changed). This is the ONE
//                                knob for "how live it feels" — shorten it if new/changed
//                                files aren't picked up fast enough. We poll rather than
//                                subscribe to TinySPARQL change signals on purpose: a save
//                                / checkout / folder-copy fires a BURST of D-Bus signals,
//                                and coalescing that burst safely is exactly the fiddly bit
//                                a fixed poll sidesteps. See AMAdocs-CADENCE-NOTES.md.
//   GNOME_CADENCE_RESUME_MS    → delay before the first (resume) tick after boot
//                                (default 8s — let the server settle first).
//   GNOME_CADENCE_FOLLOWUP_MS  → short follow-up delay when a tick left work behind
//                                (default 45s — drain overflow without hammering).
//   GNOME_CADENCE_BACKOFF_MAX_MS → cap for the exponential backoff applied after
//                                consecutive tick failures (default 30 min).
const DISABLED = ["1", "true", "yes"].includes(
  String(process.env.GNOME_CADENCE_DISABLED || "").toLowerCase()
);
const clampMs = (v, def, min) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};
const PERIOD_MS = clampMs(process.env.GNOME_CADENCE_MS, 2 * 60_000, 60_000);
const RESUME_MS = clampMs(process.env.GNOME_CADENCE_RESUME_MS, 8_000, 1_000);
const FOLLOWUP_MS = clampMs(process.env.GNOME_CADENCE_FOLLOWUP_MS, 45_000, 5_000);
const BACKOFF_MAX_MS = clampMs(
  process.env.GNOME_CADENCE_BACKOFF_MAX_MS,
  30 * 60_000,
  FOLLOWUP_MS
);

let started = false;
let ticking = false; // re-entrancy guard — only one tick in flight at a time
let timer = null; // the single self-rescheduling timer (adaptive loop)
let failCount = 0; // consecutive tick failures → exponential backoff, reset on success

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

    // MODE-SCOPED: only the current mode's library slug (see Gnome.cadenceSlugs).
    // Resuming another mode's / an eval slug here would embed at the wrong vector
    // dimension and corrupt its LanceDB table (cloud bge-m3 1024 vs local MiniLM 384).
    const slugs = Gnome.cadenceSlugs();
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
          // No `exclude` passed: the legacy /novels/ substring is retired, and the user's
          // opt-out SET (excludes) is read from state inside runSync. Any stale legacy
          // `exclude` on disk self-clears to "" on the next persist.
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

// (Re)arm the single cadence timer. Always unref'd so it never keeps the process
// alive at shutdown.
function schedule(delay) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(loop, delay);
  if (timer.unref) timer.unref();
}

// The self-rescheduling adaptive loop — the ONLY driver. One tick, then decide the next
// delay from the outcome (replaces the old setInterval + separate follow-up chain, which
// left two uncoordinated timers both calling the tick during a drain):
//   • work remains (overflow to drain / a worker still busy) → chase in FOLLOWUP_MS,
//   • tick threw (unexpected) → exponential backoff, capped, so a persistent fault stops
//     retrying-every-period-and-logging-forever; reset to normal on the first success,
//   • otherwise → wait a full PERIOD_MS (steady state).
async function loop() {
  timer = null;
  let remains = false;
  let failed = false;
  try {
    remains = await tick();
    failCount = 0; // success clears any backoff
  } catch (e) {
    failed = true;
    failCount++;
    log(`tick failed (${failCount} in a row): ${e.message}`);
  }
  if (!started) return; // stop() was called while the tick was in flight

  let delay;
  if (failed) {
    delay = Math.min(PERIOD_MS * 2 ** (failCount - 1), BACKOFF_MAX_MS);
  } else if (remains) {
    delay = FOLLOWUP_MS;
  } else {
    delay = PERIOD_MS;
  }
  schedule(delay);
}

// Start the scheduler. Idempotent. Called once from server boot (utils/boot).
function start() {
  if (started) return;
  if (DISABLED) {
    log("disabled via GNOME_CADENCE_DISABLED");
    return;
  }
  started = true;
  failCount = 0;

  // Resume pass shortly after boot (don't block the listen callback); the loop
  // reschedules itself from there.
  schedule(RESUME_MS);

  log(
    `started — resume in ${Math.round(RESUME_MS / 1000)}s, tick every ${Math.round(
      PERIOD_MS / 60_000
    )}m (adaptive)`
  );
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
  failCount = 0;
}

module.exports = { start, stop, tick };
