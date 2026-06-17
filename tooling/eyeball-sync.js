// AMAdocs: CDP driver to eyeball the "Sync a folder" flow in the live Electron app.
// The native folder dialog can't be driven over CDP, so we MOCK window.amadocs.pickFolder
// to return a fixed path — everything downstream (modal, dryRun banner, gnome-sync,
// embed-progress SSE counter, STOP) is the real code against the real engine.
// No puppeteer — raw DevTools protocol. Screenshots in tooling/logs/sync-*.png.
const fs = require("fs");
const OUT = "/mnt/space/k-base/tooling/logs";
const FOLDER = "/mnt/space/teaching_docs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageWs() {
  const res = await fetch("http://127.0.0.1:9222/json");
  const ts = await res.json();
  const p = ts.find((t) => t.type === "page" && /ui\/index\.html/.test(t.url)) || ts.find((t) => t.type === "page");
  if (!p) throw new Error("no page target");
  return p.webSocketDebuggerUrl;
}
function rpc(ws, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const to = setTimeout(() => { ws.removeEventListener("message", onMsg); reject(new Error("rpc timeout: " + method)); }, timeoutMs);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      clearTimeout(to); ws.removeEventListener("message", onMsg);
      if (m.error) return reject(new Error(JSON.stringify(m.error)));
      resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(ws, expression) {
  const r = await rpc(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result && r.result.subtype === "error") throw new Error(r.result.description);
  return r.result ? r.result.value : undefined;
}
async function shot(ws, name) {
  const r = await rpc(ws, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  console.log("  shot ->", `${OUT}/${name}.png`);
}
async function waitFor(ws, expr, { timeout = 60000, label = expr, step = 600 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evalJs(ws, expr)) return true; await sleep(step); }
  throw new Error("timeout waiting for: " + label);
}

(async () => {
  const ws = new WebSocket(await pageWs());
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  await rpc(ws, "Page.enable", {});
  await rpc(ws, "Runtime.enable", {});
  await rpc(ws, "Page.reload", {});
  await sleep(2500);
  await waitFor(ws, "!!document.querySelector('#q')", { label: "ui ready", timeout: 30000 });

  // ---- preconditions ----
  const pre = JSON.parse(await evalJs(ws, `JSON.stringify({
    hasPick: !!(window.amadocs && window.amadocs.pickFolder),
    syncBtnVisible: (()=>{const b=document.querySelector('#syncBtn'); return !!b && !b.classList.contains('hidden');})(),
    wsSlug: WS_SLUG
  })`));
  console.log("PRECONDITIONS:", JSON.stringify(pre));
  await shot(ws, "sync-1-app");

  // ---- open the modal for a fixed folder (skips the native picker, which CDP
  //      can't drive; window.amadocs is a frozen contextBridge object so it can't
  //      be monkeypatched). showSyncModalFor() is the real post-pick code path. ----
  await evalJs(ws, `showSyncModalFor(${JSON.stringify(FOLDER)})`);
  await waitFor(ws, `(()=>{const b=document.querySelector('#syncBanner'); return b && !/Checking/.test(b.textContent);})()`, { label: "dryRun banner" });
  await sleep(300);
  const modal1 = JSON.parse(await evalJs(ws, `JSON.stringify({
    folder: document.querySelector('.sync-folder')?.textContent,
    wsOptions: [...document.querySelectorAll('#syncWs option')].map(o=>o.textContent),
    banner: document.querySelector('#syncBanner')?.textContent,
    goEnabled: !document.querySelector('#syncGo')?.disabled
  })`));
  console.log("MODAL (existing-ws dryRun):", JSON.stringify(modal1, null, 2));
  await shot(ws, "sync-2-banner");

  // ---- switch to a NEW collection ----
  await evalJs(ws, `(()=>{const s=document.querySelector('#syncWs'); s.value='__new__'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(400);
  await evalJs(ws, `(()=>{const n=document.querySelector('#syncNewName'); n.value='Teaching Eyeball'; })()`);
  const modal2 = JSON.parse(await evalJs(ws, `JSON.stringify({
    newRowVisible: !document.querySelector('#syncNewRow')?.classList.contains('hidden'),
    banner: document.querySelector('#syncBanner')?.textContent,
    goEnabled: !document.querySelector('#syncGo')?.disabled
  })`));
  console.log("MODAL (new-collection):", JSON.stringify(modal2, null, 2));
  await shot(ws, "sync-3-newcollection");

  // ---- run it ----
  await evalJs(ws, "document.querySelector('#syncGo').click()");
  console.log("clicked Sync; waiting for progress…");

  // wait for the status bubble + the STOP button, then for real progress (Indexed N)
  await waitFor(ws, `!!document.querySelector('.row.sys .sysbub')`, { label: "status bubble", timeout: 20000 });
  let progressed = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const tx = await evalJs(ws, `(document.querySelector('.row.sys .systx')?.textContent)||''`);
    const m = tx.match(/Indexed (\d+)/);
    if (m && Number(m[1]) >= 2) { console.log("PROGRESS seen:", tx); progressed = true; break; }
    await sleep(800);
  }
  await shot(ws, "sync-4-progress");
  const beforeStop = JSON.parse(await evalJs(ws, `JSON.stringify({
    status: document.querySelector('.row.sys .systx')?.textContent,
    hasStop: !!document.querySelector('.row.sys .sysstop')
  })`));
  console.log("BEFORE STOP:", JSON.stringify(beforeStop));

  // ---- hit STOP (THE #1 RULE kill switch) ----
  await evalJs(ws, `document.querySelector('.row.sys .sysstop')?.click()`);
  console.log("clicked STOP; waiting for the bubble to settle…");
  await waitFor(ws, `(()=>{const b=document.querySelector('.row.sys .sysbub'); return b && (b.classList.contains('err')||b.classList.contains('ok'));})()`, { label: "stopped/settled", timeout: 30000 });
  await sleep(700);
  const afterStop = JSON.parse(await evalJs(ws, `JSON.stringify({
    status: document.querySelector('.row.sys .systx')?.textContent,
    tone: (()=>{const b=document.querySelector('.row.sys .sysbub'); return b.classList.contains('err')?'err':b.classList.contains('ok')?'ok':'?';})(),
    activeWs: WS_SLUG,
    docCount: document.querySelectorAll('#docList li').length
  })`));
  console.log("AFTER STOP:", JSON.stringify(afterStop));
  await shot(ws, "sync-5-stopped");

  console.log("RESULT:", progressed ? "progress counter advanced + STOP settled" : "STOP settled (progress may not have reached 2 before stop)");
  console.log("DONE");
  ws.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
