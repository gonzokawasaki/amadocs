// Minimal CDP driver for the live AMAdocs run. Uses Node 22's global WebSocket.
// Usage: node cdp.js eval '<js expression>'   -> prints JSON result of evaluating in the page
//        node cdp.js wsurl                    -> prints the page ws debugger url
const PAGE_WS = process.env.PAGE_WS;

async function getPageWs() {
  const res = await fetch("http://127.0.0.1:9222/json");
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page" && /ui\/index\.html/.test(t.url)) || targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  return page.webSocketDebuggerUrl;
}

function evalInPage(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (m.error) return reject(new Error(JSON.stringify(m.error)));
      const r = m.result?.result;
      if (r && r.subtype === "error") return reject(new Error(r.description));
      resolve(r ? r.value : undefined);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    }));
  });
}

(async () => {
  const wsUrl = PAGE_WS || (await getPageWs());
  if (process.argv[2] === "wsurl") { console.log(wsUrl); return; }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const expr = process.argv[3];
  const val = await evalInPage(ws, expr);
  console.log(typeof val === "string" ? val : JSON.stringify(val, null, 2));
  ws.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
