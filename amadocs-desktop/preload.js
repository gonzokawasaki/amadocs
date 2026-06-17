const { contextBridge, ipcRenderer, webUtils } = require("electron");

// AMAdocs: the per-boot API token, passed from main via webPreferences
// additionalArguments (see main.js createWindow). Exposed to the UI so it can
// authenticate every engine call. Empty when launched without it (e.g. browser
// dev stack), in which case the engine gate is off too.
const tokenArg = process.argv.find((a) => a.startsWith("--amadocs-api-token="));
const apiToken = tokenArg ? tokenArg.slice("--amadocs-api-token=".length) : "";

// Minimal, safe bridge exposed to the UI as window.amadocs
contextBridge.exposeInMainWorld("amadocs", {
  isDesktop: true,
  apiToken,

  // Reveal a file in the OS file manager (Explorer / Finder / Files), selecting it.
  revealInFolder: (filePath) => ipcRenderer.invoke("reveal-in-folder", filePath),

  // Open a folder (not a file) in the OS file manager — for "show where AMAdocs
  // stores your files," so a user can always find their docs on their own disk.
  openFolder: (dirPath) => ipcRenderer.invoke("open-folder", dirPath),

  // Native folder picker for the "Sync a folder" flow → resolves to the chosen
  // absolute directory path, or null if the user cancelled.
  pickFolder: () => ipcRenderer.invoke("pick-folder"),

  // Resolve the real filesystem path of a dropped/chosen File.
  // webUtils.getPathForFile is the sandbox-safe replacement for the old File.path.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch (_) {
      return file && file.path ? file.path : null;
    }
  },
});
