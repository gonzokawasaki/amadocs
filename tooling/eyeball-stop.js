// AMAdocs: eyeball the mid-sync STOP button (THE #1 RULE kill switch) in the UI.
// Engine launched with EMBED_COOLDOWN_MS=2500 + GNOME_SYNC_CAP=8 so a batch stays
// in-flight long enough to catch. Syncs into a fresh collection, waits for a couple
// of docs to index, screenshots the live STOP button, clicks it, verifies the bubble
// settles to the stopped message.
const fs = require("fs");
const OUT = "/mnt/space/k-base/tooling/logs";
const FOLDER = "/mnt/space/teaching_docs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageWs() {
  const ts = await (await fetch("http://127.0.0.1:9222/json")).json();
  const p = ts.find((t) => t.type === "page" && /index\.html/.test(t.url)) || ts.find((t) => t.type === "page");
  return p.webSocketDebuggerUrl;
}
function rpc(ws, method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const to = setTimeout(() => { ws.removeEventListener("message", onMsg); reject(new Error("rpc timeout: " + method)); }, timeoutMs);
    const onMsg = (ev) => { const m = JSON.parse(ev.data); if (m.id !== id) return; clearTimeout(to); ws.removeEventListener("message", onMsg); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); };
    ws.addEventListener("message", onMsg); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(ws, expression) {
  const r = await rpc(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result && r.result.subtype === "error") throw new Error(r.result.description);
  return r.result ? r.result.value : undefined;
}
async function shot(ws, name) { const r = await rpc(ws, "Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64")); console.log("  shot ->", name); }

(async () => {
  const ws = new WebSocket(await pageWs());
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  await rpc(ws, "Page.enable", {}); await rpc(ws, "Runtime.enable", {});
  await rpc(ws, "Page.reload", {}); await sleep(2500);
  while (!(await ev(ws, "!!document.querySelector('#q')"))) await sleep(500);

  // open modal, pick a fresh collection, sync
  await ev(ws, `showSyncModalFor(${JSON.stringify(FOLDER)})`);
  while (/Checking/.test(await ev(ws, `document.querySelector('#syncBanner')?.textContent||'Checking'`))) await sleep(400);
  await ev(ws, `(()=>{const s=document.querySelector('#syncWs'); s.value='__new__'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(300);
  await ev(ws, `(()=>{document.querySelector('#syncNewName').value='Stop Eyeball';})()`);
  await ev(ws, "document.querySelector('#syncGo').click()");
  console.log("clicked Sync (cap 8, cooldown 2.5s)");

  // wait for a couple of docs to land while the STOP button is live
  let seen = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const tx = await ev(ws, `document.querySelector('.row.sys .systx')?.textContent||''`);
    const m = tx.match(/Indexed (\d+)/);
    if (m && Number(m[1]) >= 2) { seen = tx; break; }
    await sleep(500);
  }
  const live = JSON.parse(await ev(ws, `JSON.stringify({status:document.querySelector('.row.sys .systx')?.textContent,hasStop:!!document.querySelector('.row.sys .sysstop'),stopLabel:document.querySelector('.row.sys .sysstop')?.textContent})`));
  console.log("MID-SYNC:", JSON.stringify(live));
  await shot(ws, "stop-1-midsync");

  // click STOP
  await ev(ws, `document.querySelector('.row.sys .sysstop')?.click()`);
  console.log("clicked STOP");
  const t1 = Date.now();
  while (Date.now() - t1 < 30000) {
    const settled = await ev(ws, `(()=>{const b=document.querySelector('.row.sys .sysbub'); return b && (b.classList.contains('err')||b.classList.contains('ok'));})()`);
    if (settled) break; await sleep(400);
  }
  await sleep(600);
  const after = JSON.parse(await ev(ws, `JSON.stringify({
    status:document.querySelector('.row.sys .systx')?.textContent,
    tone:(()=>{const b=document.querySelector('.row.sys .sysbub'); return !b?'gone':b.classList.contains('err')?'err':b.classList.contains('ok')?'ok':'live';})(),
    docCount:document.querySelectorAll('#docList li').length,
    activeWs:WS_SLUG
  })`));
  console.log("AFTER STOP:", JSON.stringify(after));
  await shot(ws, "stop-2-stopped");
  console.log("DONE");
  ws.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
