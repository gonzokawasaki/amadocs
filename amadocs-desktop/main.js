const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Paths: dev layout vs packaged (AppImage) layout.
//
// Dev: the engine lives next to this app in the repo and runs on an nvm Node 18.
// Packaged: everything we spawn is shipped under process.resourcesPath via
// electron-builder `extraResources` (see package.json → build.extraResources):
//   resources/engine/{server,collector}   the AnythingLLM fork (with node_modules)
//   resources/node/node                    a Node 18 binary (engine native modules
//                                          are built against its ABI)
//   (Ollama is NOT bundled — "require Ollama" build.) We reuse an Ollama that's
//   already serving on :11434, else spawn the user's system `ollama` (resolved
//   from PATH / the usual install dirs). If it isn't installed we tell the user
//   to install it rather than failing cryptically.
//   resources/storage-seed/                read-only assets seeded into userData on
//                                          first run (models/, a migrated empty DB)
//
// The AppImage mount is READ-ONLY, so all writable state (SQLite DB, LanceDB,
// originals, vector-cache, pulled Ollama models) must live under userData.
// ---------------------------------------------------------------------------
const isPackaged = app.isPackaged;
const ROOT = path.resolve(__dirname, "..");
const RES = process.resourcesPath;

const ENGINE = isPackaged
  ? path.join(RES, "engine")
  : path.join(ROOT, "anythingllm-upstream");
// "Require Ollama" build: Ollama is not bundled. In dev we keep the old local
// path; packaged, locate the user's system install (PATH + the usual dirs).
// Returns null when Ollama isn't installed, so bootEngine can prompt the user.
function resolveOllama() {
  if (!isPackaged) return path.join(ROOT, "tooling", "ollama", "bin", "ollama");
  const dirs = [
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    path.join(process.env.HOME || "", ".local/bin"),
    ...(process.env.PATH || "").split(path.delimiter),
  ];
  for (const d of dirs) {
    if (!d) continue;
    const c = path.join(d, "ollama");
    if (fs.existsSync(c)) return c;
  }
  return null;
}
const OLLAMA_BIN = resolveOllama();

// Writable locations (packaged: userData; dev: the repo's existing dirs).
const STORAGE_DIR = isPackaged
  ? path.join(app.getPath("userData"), "storage")
  : path.join(ENGINE, "server", "storage");
const OLLAMA_MODELS = isPackaged
  ? path.join(app.getPath("userData"), "ollama-models")
  : path.join(ROOT, "tooling", "ollama-models");
const STORAGE_SEED = isPackaged ? path.join(RES, "storage-seed") : null;

// Find a Node 18 runtime (engine native modules are built against it).
function resolveNode() {
  if (isPackaged) return path.join(RES, "node", "node");
  const home = process.env.HOME || "";
  const candidates = [
    path.join(home, ".nvm/versions/node/v18.18.0/bin/node"),
    "/usr/bin/node",
    "node",
  ];
  for (const c of candidates) {
    if (c === "node" || fs.existsSync(c)) return c;
  }
  return "node";
}
const NODE = resolveNode();

// ---------------------------------------------------------------------------
// AMAdocs mode + key config (drives the in-app Local ⇄ Cloud toggle).
//
// The two product modes are incompatible engines — local (Ollama + MiniLM, 384-dim)
// vs cloud (OpenRouter + bge-m3, 1024-dim) — with SEPARATE LanceDB indexes that can
// never be shared. So switching is a real app relaunch, not a live toggle. The chosen
// mode and the OpenRouter key are persisted to disk so the relaunched process boots
// straight into the new mode: app.relaunch() does NOT carry our in-process env, and a
// secret must never ride in relaunch argv (it shows up in process listings).
//
// Precedence: an explicit CORACLE_PROFILE / OPENROUTER_API_KEY in the environment
// always wins (dev + power users); the files are only consulted as a fallback. Key
// access goes through the readKey()/writeKey() seam so a later move to encrypted
// storage (Electron safeStorage) is a one-spot change.
// ---------------------------------------------------------------------------
const CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config");
const CONFIG_DIR = path.join(CONFIG_HOME, "amadocs");
const MODE_FILE = path.join(CONFIG_DIR, "mode"); // "cloud" | "local"
const KEY_FILE = path.join(CONFIG_DIR, "openrouter.key");
// Pre-rebrand key location — read as a fallback so existing installs keep working.
const LEGACY_KEY_FILE = path.join(CONFIG_HOME, "coracle", "openrouter.key");

function readFileTrim(p) {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch (_) {
    return "";
  }
}

// The OpenRouter key: env wins; else the amadocs key file; else the legacy coracle
// file. Returns "" when unset.
function readKey() {
  if (process.env.OPENROUTER_API_KEY)
    return process.env.OPENROUTER_API_KEY.trim();
  return readFileTrim(KEY_FILE) || readFileTrim(LEGACY_KEY_FILE);
}

// Persist a new key (0600) to the amadocs location. Single writer behind the seam.
function writeKey(key) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, String(key || "").trim() + "\n", { mode: 0o600 });
}

// The persisted in-app mode ("cloud" | "local"); "" when never set. Env
// CORACLE_PROFILE overrides this (handled in resolveProfileName).
function readPersistedMode() {
  const m = readFileTrim(MODE_FILE).toLowerCase();
  return m === "cloud" ? "cloud" : m === "local" ? "local" : "";
}
function writePersistedMode(mode) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(MODE_FILE, (mode === "cloud" ? "cloud" : "local") + "\n");
}

// ---------------------------------------------------------------------------
// First-run setup (packaged only): create the writable storage tree and seed
// the read-only assets that ship in the bundle but the engine must be able to
// read from a writable path (the embedder/OCR/reranker models, and a clean
// pre-migrated SQLite DB so we never run Prisma migrations inside the AppImage).
// ---------------------------------------------------------------------------
function ensurePackagedStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(OLLAMA_MODELS, { recursive: true });
  // AMAdocs: the collector runs from a read-only mount, so its writable working dirs
  // live under STORAGE_DIR. multer (server) does NOT create its destination, and the
  // collector's boot-time wipe reads them — so create both before either process starts.
  // Must match collector/utils/constants.js (WATCH_DIRECTORY / TMP_DIRECTORY) and the
  // server multer packaged hotdir destination.
  fs.mkdirSync(path.join(STORAGE_DIR, "hotdir"), { recursive: true });
  fs.mkdirSync(path.join(STORAGE_DIR, "tmp"), { recursive: true });

  const modelsDir = path.join(STORAGE_DIR, "models");
  const modelsSeed = path.join(STORAGE_SEED, "models");
  if (!fs.existsSync(modelsDir) && fs.existsSync(modelsSeed))
    fs.cpSync(modelsSeed, modelsDir, { recursive: true });

  const db = path.join(STORAGE_DIR, "anythingllm.db");
  const dbSeed = path.join(STORAGE_SEED, "anythingllm.db");
  if (!fs.existsSync(db) && fs.existsSync(dbSeed)) fs.copyFileSync(dbSeed, db);
}

// Per-install secrets — generated once, persisted in userData, reused after.
// (Shipping a hard-coded JWT_SECRET in every copy would be a real auth hole.)
function installSecrets() {
  if (!isPackaged)
    return {
      JWT_SECRET: "dev-secret",
      SIG_KEY: "dev-sig-key-0000000000000000000000000000000000000000000000000000",
      SIG_SALT: "dev-sig-salt-000000000000000000000000000000000000000000000000000",
    };
  const file = path.join(app.getPath("userData"), "secrets.json");
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {}
  }
  const secrets = {
    JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    SIG_KEY: crypto.randomBytes(32).toString("hex"),
    SIG_SALT: crypto.randomBytes(32).toString("hex"),
  };
  fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  return secrets;
}

// AMAdocs: per-boot API token. The engine's :3001 port is otherwise an open,
// unauthenticated localhost API — any page in the user's browser could read,
// upload, or delete their documents while AMAdocs runs. We mint a fresh secret
// each launch, hand it to the engine (AMADOCS_API_TOKEN) so it rejects every
// request that doesn't carry it, and hand the same value to the renderer via the
// preload bridge (see createWindow → additionalArguments, preload.js). Per-boot
// (not persisted) so there's no token at rest to leak.
const API_TOKEN = crypto.randomBytes(32).toString("hex");

// AMAdocs: model "build profiles". The default "lite" profile keeps the
// two-model stack (granite chat + moondream vision) that fits a ~4 GB GPU.
// The "gemma" profile consolidates BOTH generative models onto a single
// Apache-2.0 Gemma 4 multimodal model (chat + summaries + image captions).
// Gemma 4 e2b-qat needs ~8 GB VRAM, so it ships as an opt-in build selected
// with CORACLE_PROFILE=gemma — it deliberately does NOT fit this dev box.
// The embedder (MiniLM, CPU) and Tesseract OCR are unchanged in both.
const MODEL_PROFILES = {
  lite: { chat: "granite4.1:3b", vision: "moondream" },
  gemma: { chat: "gemma4:e2b-it-qat", vision: "gemma4:e2b-it-qat" },
  // "cloud" = frontier inference over ONE OpenRouter key (OPENROUTER_API_KEY).
  // Extraction stays local (GNOME/LocalSearch + OCR); embeddings, summaries, chat
  // and image captions go to OpenRouter. Model ids are OpenRouter catalog ids,
  // overridable via the usual env prefs. Ollama is NOT required in this profile.
  cloud: {
    chat: "anthropic/claude-sonnet-4.6",
    summary: "google/gemini-2.5-flash",
    vision: "google/gemini-2.5-flash",
    embed: "baai/bge-m3",
  },
};
function resolveProfileName() {
  const envName = (process.env.CORACLE_PROFILE || "").toLowerCase();
  if (envName && MODEL_PROFILES[envName]) return envName; // env override wins
  // No env override → the in-app persisted mode. "cloud" → the cloud profile;
  // "local" (or unset) → the default local profile (lite).
  if (readPersistedMode() === "cloud") return "cloud";
  return "lite";
}

// Per-profile engine env, shared by the packaged and dev launch paths. The cloud
// profile swaps the engine-wide provider + embedder to OpenRouter — the custom
// summariser/captioner modules key off the same LLM_PROVIDER switch — while the
// local profiles keep Ollama. Spread this AFTER any local defaults so cloud can
// override LLM_PROVIDER / EMBEDDING_ENGINE. OPENROUTER_API_KEY itself rides in
// from the parent environment (startProc spreads process.env).
function profileEngineEnv() {
  const profileName = resolveProfileName();
  const models = MODEL_PROFILES[profileName];
  if (profileName === "cloud") {
    return {
      CORACLE_PROFILE: profileName,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_MODEL_PREF: models.chat,
      SUMMARY_MODEL_PREF: models.summary,
      VISION_MODEL_PREF: models.vision,
      EMBEDDING_ENGINE: "openrouter",
      EMBEDDING_MODEL_PREF: models.embed,
    };
  }
  return {
    CORACLE_PROFILE: profileName,
    OLLAMA_MODEL_PREF: models.chat,
    VISION_MODEL_PREF: models.vision,
  };
}

// Full engine config for the packaged app. In dev we rely on the engine's
// .env.development; packaged, we pass everything explicitly so there is no
// dependency on a bundled .env, and NODE_ENV=production so the engine's
// "is this dev?" path branches resolve to STORAGE_DIR (not repo paths).
function packagedEngineEnv() {
  const secrets = installSecrets();
  return {
    AMADOCS_API_TOKEN: API_TOKEN,
    NODE_ENV: "production",
    STORAGE_DIR,
    DATABASE_URL: `file:${path.join(STORAGE_DIR, "anythingllm.db")}`,
    SERVER_PORT: "3001",
    ...secrets,
    VECTOR_DB: "lancedb",
    LLM_PROVIDER: "ollama",
    OLLAMA_BASE_PATH: "http://127.0.0.1:11434",
    OLLAMA_MODEL_TOKEN_LIMIT: "4096",
    OLLAMA_RESPONSE_TIMEOUT: "7200000",
    EMBEDDING_ENGINE: "native",
    EMBEDDING_MODEL_PREF: "Xenova/all-MiniLM-L6-v2",
    WHISPER_PROVIDER: "local",
    TTS_PROVIDER: "native",
    STT_PROVIDER: "native",
    DISABLE_TELEMETRY: "true",
    // AMAdocs additions
    DOC_SUMMARY_ENABLED: "true", // catalog every file with a bounded summary at ingest (librarian default); full-text Deep search is opt-in per file
    TARGET_OCR_LANG: "eng",
    OCR_PDF_DPI: "150",
    OCR_MIN_CONFIDENCE: "50",
    // Profile-driven model/provider selection (lite | gemma | cloud) — last so the
    // cloud profile overrides the LLM_PROVIDER / EMBEDDING_ENGINE defaults above.
    ...profileEngineEnv(),
  };
}

const children = [];
function startProc(name, cmd, args, opts = {}) {
  const env = {
    ...process.env,
    OLLAMA_MODELS,
    OLLAMA_HOST: "127.0.0.1:11434",
    OLLAMA_KEEP_ALIVE: "30m", // keep model warm -> avoid repeated cold starts
    ...(isPackaged
      ? packagedEngineEnv()
      : { NODE_ENV: "development", ...profileEngineEnv() }),
    ...(opts.env || {}),
  };
  const p = spawn(cmd, args, { env, cwd: opts.cwd, stdio: "pipe" });
  p.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  p.on("exit", (code) => console.log(`[${name}] exited (${code})`));
  children.push(p);
  return p;
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    if (await ping(url)) return true;
    await wait(1000);
  }
  throw new Error(`${label} did not come up`);
}

async function bootEngine() {
  if (isPackaged) ensurePackagedStorage();
  // Cloud profile: all inference (chat, embeddings, summaries, vision) runs on
  // OpenRouter — Ollama isn't needed, but the key is. Fail loud before boot
  // rather than letting the engine 500 on the first model call.
  const isCloud = resolveProfileName() === "cloud";
  // Populate the key from disk (env wins) so the engine child + the check below both
  // see it after an in-app switch to Cloud, where no env var is present.
  if (isCloud && !process.env.OPENROUTER_API_KEY) {
    const k = readKey();
    if (k) process.env.OPENROUTER_API_KEY = k;
  }
  if (isCloud && !process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "Cloud mode needs an OpenRouter API key.\n\n" +
        "AMAdocs is in Cloud mode, which sends AI work (embeddings, summaries,\n" +
        "chat, image analysis) to OpenRouter, but no key is set. Get a key at\n" +
        "https://openrouter.ai/keys, then switch to Cloud from the dashboard and\n" +
        "paste it — or relaunch with OPENROUTER_API_KEY=<your key>."
    );
  }
  // If a dev stack is already running, reuse it.
  const serverUp = await ping("http://127.0.0.1:3001/api/ping");
  if (!serverUp) {
    if (!isCloud && !(await ping("http://127.0.0.1:11434/api/version"))) {
      if (!OLLAMA_BIN) {
        throw new Error(
          "Ollama isn't installed.\n\n" +
            "AMAdocs runs its AI models locally with Ollama, but couldn't find it.\n" +
            "Install Ollama, then relaunch AMAdocs:\n\n" +
            "  Arch / Manjaro:  sudo pacman -S ollama\n" +
            "  Other Linux:     curl -fsSL https://ollama.com/install.sh | sh\n" +
            "  Or download from https://ollama.com/download"
        );
      }
      startProc("ollama", OLLAMA_BIN, ["serve"]);
      await waitFor("http://127.0.0.1:11434/api/version", "Ollama");
    }
    startProc("collector", NODE, ["index.js"], { cwd: path.join(ENGINE, "collector") });
    startProc("server", NODE, ["index.js"], { cwd: path.join(ENGINE, "server") });
    await waitFor("http://127.0.0.1:3001/api/ping", "AMAdocs engine");
    await waitFor("http://127.0.0.1:8888/", "Document processor");
  }
}

// Reveal a document's original file in the OS file manager (selects the file).
ipcMain.handle("reveal-in-folder", (_e, filePath) => {
  if (!filePath || typeof filePath !== "string") return { ok: false, error: "no-path" };
  if (!fs.existsSync(filePath)) return { ok: false, error: "not-found" };
  shell.showItemInFolder(filePath);
  return { ok: true };
});

// Open a FOLDER in the OS file manager (used for "show where AMAdocs stores your
// files"). Unlike reveal-in-folder, this opens the folder itself, not its parent.
ipcMain.handle("open-folder", async (_e, dirPath) => {
  if (!dirPath || typeof dirPath !== "string") return { ok: false, error: "no-path" };
  if (!fs.existsSync(dirPath)) return { ok: false, error: "not-found" };
  const err = await shell.openPath(dirPath); // returns "" on success
  return err ? { ok: false, error: err } : { ok: true };
});

// Open an external URL in the user's default browser (used by the Cloud dashboard's
// "Manage this key at OpenRouter" link). Restricted to http(s) so the renderer can't
// coax the main process into opening arbitrary schemes.
ipcMain.handle("open-external", async (_e, url) => {
  if (!url || typeof url !== "string") return { ok: false, error: "no-url" };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "bad-scheme" };
  await shell.openExternal(url);
  return { ok: true };
});

// AMAdocs: native folder picker for the "Sync a folder" flow. Returns the chosen
// absolute directory path (or null if cancelled). The engine runs on the same
// machine, so this path is handed straight to POST /workspace/:slug/gnome-sync,
// which reads the OS index (GNOME LocalSearch/TinySPARQL) for that folder.
ipcMain.handle("pick-folder", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Choose a folder to sync",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// Phase 2 file tree: read a directory and return lightweight entry metadata.
// Returns [{name, isDir, size, mtime}] sorted: dirs first, then files, both alpha.
ipcMain.handle("read-dir", async (_e, dirPath) => {
  if (!dirPath || typeof dirPath !== "string") return { ok: false, error: "no-path" };
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
  const results = await Promise.all(
    entries.map(async (ent) => {
      const isDir = ent.isDirectory();
      let size = 0, mtime = 0;
      try {
        const st = await fs.promises.stat(path.join(dirPath, ent.name));
        size = st.size;
        mtime = st.mtimeMs;
      } catch (_) {}
      return { name: ent.name, isDir, size, mtime };
    })
  );
  results.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { ok: true, entries: results };
});

// Phase 2 preview: read a file's raw bytes so the UI can preview ANY local file,
// indexed or not. Preview = "let me see this file"; indexing = "make it searchable"
// stays opt-in (right-click → analyse / folder ⟳ index). Returns {ok, data:<base64>,
// mime} or {ok:false, error}. Path-guarded (must be an existing regular file) and
// size-capped so a stray huge file can't OOM the renderer.
const PREVIEW_MAX_BYTES = 100 * 1024 * 1024;
const PREVIEW_MIME = {
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".tif": "image/tiff", ".tiff": "image/tiff", ".svg": "image/svg+xml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
  ".log": "text/plain", ".json": "application/json", ".xml": "text/xml",
  ".html": "text/html", ".htm": "text/html",
  ".js": "text/plain", ".ts": "text/plain", ".css": "text/plain",
  ".yml": "text/plain", ".yaml": "text/plain", ".sh": "text/plain",
  ".py": "text/plain", ".c": "text/plain", ".cpp": "text/plain", ".h": "text/plain",
};
ipcMain.handle("read-file", async (_e, filePath) => {
  if (!filePath || typeof filePath !== "string") return { ok: false, error: "no-path" };
  let st;
  try {
    st = await fs.promises.stat(filePath);
  } catch (err) {
    return { ok: false, error: err.code || "not-found" };
  }
  if (!st.isFile()) return { ok: false, error: "not-a-file" };
  if (st.size > PREVIEW_MAX_BYTES) return { ok: false, error: "too-large" };
  let buf;
  try {
    buf = await fs.promises.readFile(filePath);
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
  const mime =
    PREVIEW_MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  return { ok: true, data: buf.toString("base64"), mime };
});

// Phase 2 file tree: return the user's home directory path.
ipcMain.handle("home-path", () => app.getPath("home"));

// ── AMAdocs mode toggle (Local ⇄ Cloud) ────────────────────────────────────
// Two incompatible engines with separate indexes → switching is a full relaunch.
// The UI reads the current mode + whether a key is on file to label the switch
// button and decide whether to prompt for a key.
ipcMain.handle("get-mode", () => {
  const mode = resolveProfileName() === "cloud" ? "cloud" : "local";
  return { mode, hasKey: !!readKey() };
});

// Persist a key without switching (first-time entry / rotate). {ok} | {ok:false,error}.
ipcMain.handle("save-key", (_e, key) => {
  const k = String(key || "").trim();
  if (!k) return { ok: false, error: "Empty key." };
  try {
    writeKey(k);
    process.env.OPENROUTER_API_KEY = k;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Switch mode → persist choice (+ key for cloud) then relaunch. Cloud requires a
// key, passed in here or already on disk. Returns {ok} synchronously; the relaunch
// fires just after so this IPC reply reaches the renderer first.
ipcMain.handle("switch-mode", async (_e, arg = {}) => {
  const target = arg && arg.mode === "cloud" ? "cloud" : "local";
  if (target === "cloud") {
    const k = String((arg && arg.key) || "").trim() || readKey();
    if (!k) return { ok: false, error: "Cloud mode needs an OpenRouter key." };
    try {
      writeKey(k);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  try {
    writePersistedMode(target);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  setTimeout(() => relaunchIntoMode(), 150);
  return { ok: true };
});

// The documented trap: if we relaunch before the old engine is down, the fresh
// instance pings :3001, finds the dying old-mode server still up, and reuses it —
// booting the WRONG mode. So SIGTERM our children, wait for :3001 to actually stop
// answering, SIGKILL any survivor, then relaunch.
async function relaunchIntoMode() {
  shutdown(); // SIGTERM the engine (+ any ollama we spawned)
  for (let i = 0; i < 40; i++) {
    if (!(await ping("http://127.0.0.1:3001/api/ping"))) break;
    await wait(250);
  }
  for (const c of children) {
    try {
      c.kill("SIGKILL");
    } catch (_) {}
  }
  app.relaunch();
  app.exit(0);
}

// AMAdocs: browser-style zoom for the whole UI. The native menu bar is hidden,
// so the default View-menu zoom accelerators don't run — wire zoom directly on
// webContents instead. Page zoom scales everything in the renderer: context
// menus, the homepage, file previews. Ctrl/Cmd +/-/0 (keyboard) + Ctrl+wheel.
const ZOOM_MIN = 0.5, ZOOM_MAX = 3.0, ZOOM_STEP = 0.1;
let zoomFactor = 1;
const clampZoom = (z) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
function setupZoom(win) {
  const wc = win.webContents;
  const apply = (next) => { zoomFactor = clampZoom(next); wc.setZoomFactor(zoomFactor); };
  // loadFile (loading.html → index.html) resets zoom; re-apply on each load.
  wc.on("did-finish-load", () => wc.setZoomFactor(zoomFactor));
  // Keyboard. preventDefault also suppresses any default-menu zoom role, so
  // there's no double-stepping.
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    switch (input.key) {
      case "+": case "=": apply(zoomFactor + ZOOM_STEP); event.preventDefault(); break;
      case "-": case "_": apply(zoomFactor - ZOOM_STEP); event.preventDefault(); break;
      case "0":           apply(1);                       event.preventDefault(); break;
    }
  });
  // Ctrl + mouse wheel: Chromium applies the step, we clamp + keep the cache in
  // sync so the keyboard path continues from wherever the wheel left off.
  wc.on("zoom-changed", () => {
    const f = wc.getZoomFactor();
    zoomFactor = clampZoom(f);
    if (f !== zoomFactor) wc.setZoomFactor(zoomFactor);
  });
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "AMAdocs",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
      // AMAdocs: hand the per-boot API token to the renderer (read in preload.js).
      additionalArguments: [`--amadocs-api-token=${API_TOKEN}`],
    },
  });
  win.setMenuBarVisibility(false);
  setupZoom(win);
  win.loadFile(path.join(__dirname, "loading.html"));
}

app.whenReady().then(async () => {
  createWindow();
  try {
    await bootEngine();
    win.loadFile(path.join(__dirname, "ui", "index.html"));
  } catch (e) {
    console.error("Boot failed:", e);
    win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          `<body style="font-family:sans-serif;padding:40px;color:#1f2937;background:#f6f7fb">
           <h2 style="color:#b91c1c">AMAdocs couldn't start its engine</h2>
           <pre style="white-space:pre-wrap;font-size:14px;line-height:1.5">${e.message}</pre></body>`
        )
    );
  }
});

function shutdown() {
  for (const c of children) { try { c.kill(); } catch (_) {} }
}
app.on("window-all-closed", () => { shutdown(); app.quit(); });
app.on("before-quit", shutdown);
process.on("exit", shutdown);
