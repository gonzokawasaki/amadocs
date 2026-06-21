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
//   resources/ollama/bin/ollama            the Ollama runtime binary; its inference
//                                          runner (llama-server) + GPU/CPU libs ship
//                                          alongside in resources/ollama/lib/ollama,
//                                          which ollama finds via ../lib/ollama
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
const OLLAMA_BIN = isPackaged
  ? path.join(RES, "ollama", "bin", "ollama")
  : path.join(ROOT, "tooling", "ollama", "bin", "ollama");

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
    OLLAMA_MODEL_PREF: "granite4.1:3b",
    OLLAMA_MODEL_TOKEN_LIMIT: "4096",
    OLLAMA_RESPONSE_TIMEOUT: "7200000",
    EMBEDDING_ENGINE: "native",
    EMBEDDING_MODEL_PREF: "Xenova/all-MiniLM-L6-v2",
    WHISPER_PROVIDER: "local",
    TTS_PROVIDER: "native",
    STT_PROVIDER: "native",
    DISABLE_TELEMETRY: "true",
    // AMAdocs additions
    VISION_MODEL_PREF: "moondream",
    DOC_SUMMARY_ENABLED: "true", // catalog every file with a bounded summary at ingest (librarian default); full-text Deep search is opt-in per file
    TARGET_OCR_LANG: "eng",
    OCR_PDF_DPI: "150",
    OCR_MIN_CONFIDENCE: "50",
  };
}

const children = [];
function startProc(name, cmd, args, opts = {}) {
  const env = {
    ...process.env,
    OLLAMA_MODELS,
    OLLAMA_HOST: "127.0.0.1:11434",
    OLLAMA_KEEP_ALIVE: "30m", // keep model warm -> avoid repeated cold starts
    ...(isPackaged ? packagedEngineEnv() : { NODE_ENV: "development" }),
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
  // If a dev stack is already running, reuse it.
  const serverUp = await ping("http://127.0.0.1:3001/api/ping");
  if (!serverUp) {
    if (!(await ping("http://127.0.0.1:11434/api/version"))) {
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
          `<body style="font-family:sans-serif;padding:40px;color:#b91c1c">
           <h2>AMAdocs couldn't start its engine</h2><pre>${e.message}</pre></body>`
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
