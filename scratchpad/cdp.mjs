// Minimal CDP driver for the running Electron renderer (port 9222).
// Usage:
//   node cdp.mjs eval "<js expression>"      → prints JSON result
//   node cdp.mjs shot  <outfile.png>          → screenshots the page
//   node cdp.mjs reload                       → reloads the page
import fs from "node:fs";

const PORT = 9222;
async function pageTarget() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await r.json();
  // The renderer page (index.html), not devtools/service workers.
  const p = list.find(t => t.type === "page" && /index\.html|file:/.test(t.url)) ||
            list.find(t => t.type === "page");
  if (!p) throw new Error("no page target");
  return p.webSocketDebuggerUrl;
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = e => rej(e);
  });
}
let idc = 0;
function send(ws, method, params = {}) {
  const id = ++idc;
  return new Promise((res, rej) => {
    const onMsg = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener("message", onMsg); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const [,, cmd, arg] = process.argv;
const ws = await connect(await pageTarget());
try {
  if (cmd === "eval") {
    const r = await send(ws, "Runtime.evaluate", { expression: arg, returnByValue: true, awaitPromise: true, userGesture: true });
    console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
  } else if (cmd === "shot") {
    await send(ws, "Page.enable");
    const r = await send(ws, "Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(arg, Buffer.from(r.data, "base64"));
    console.log("wrote " + arg);
  } else if (cmd === "reload") {
    await send(ws, "Page.enable");
    await send(ws, "Page.reload", { ignoreCache: true });
    console.log("reloaded");
  } else {
    console.error("unknown cmd");
  }
} finally { ws.close(); }
