// AMAdocs: CDP driver to eyeball the BRIDGED-DOC citation loop in the live Electron app.
// Asks a syllabus question (answer lives in a tinysparql-bridged PDF), waits for the
// resolved citation chip, screenshots the answer, clicks the chip, screenshots the
// PDF viewer (passage-highlight render). No puppeteer — raw DevTools protocol.
const fs = require("fs");
const OUT = "/home/user/claude/amadocs-main/tooling/logs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageWs() {
  const res = await fetch("http://127.0.0.1:9222/json");
  const ts = await res.json();
  const p = ts.find((t) => t.type === "page" && /ui\/index\.html/.test(t.url)) || ts.find((t) => t.type === "page");
  if (!p) throw new Error("no page target");
  return p.webSocketDebuggerUrl;
}

function rpc(ws, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const to = setTimeout(() => { ws.removeEventListener("message", onMsg); reject(new Error("rpc timeout: " + method)); }, timeoutMs);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      clearTimeout(to);
      ws.removeEventListener("message", onMsg);
      if (m.error) return reject(new Error(JSON.stringify(m.error)));
      resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(ws, expression) {
  const r = await rpc(ws, "Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.result && r.result.subtype === "error") throw new Error(r.result.description);
  return r.result ? r.result.value : undefined;
}

async function shot(ws, name) {
  const r = await rpc(ws, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  console.log("  screenshot ->", `${OUT}/${name}.png`);
}

async function waitFor(ws, expr, { timeout = 180000, label = expr } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalJs(ws, expr)) return true;
    await sleep(700);
  }
  throw new Error("timeout waiting for: " + label);
}

(async () => {
  const ws = new WebSocket(await pageWs());
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  await rpc(ws, "Page.enable", {});
  await rpc(ws, "Runtime.enable", {});

  // clean slate: reload so the viewer has no stale doc open
  await rpc(ws, "Page.reload", {});
  await sleep(2500);

  // 1. confirm we're on the teaching workspace and docs loaded
  const wsSlug = await evalJs(ws, "WS_SLUG");
  console.log("WS_SLUG:", wsSlug);
  await waitFor(ws, "document.querySelectorAll('#docs .doc, #docs .docrow, #docs [data-path]').length > 0 || !!document.querySelector('#q')", { label: "ui ready", timeout: 30000 });
  await shot(ws, "cite-1-initial");

  // 2. ask the question
  const Q = "What reading and writing assessment objectives does the IGCSE First Language English syllabus assess?";
  await evalJs(ws, `(()=>{const q=document.querySelector('#q');q.value=${JSON.stringify(Q)};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(150);
  await evalJs(ws, "document.querySelector('#send').click()");

  // 3. wait for streaming to finish AND a resolved citation chip to appear
  await waitFor(ws, `(()=>{const s=(document.querySelector('#send')?.textContent||'').trim();const chip=document.querySelector('.sources .src[data-cite]');return chip && !s.includes('⏹');})()`, { label: "answer + resolved chip" });
  await sleep(800);
  await shot(ws, "cite-2-answer");

  // report chips + answer tail
  const info = await evalJs(ws, `(()=>{
    const chips=[...document.querySelectorAll('.sources .src[data-cite]')].map(c=>({txt:c.textContent.trim(),name:c.getAttribute('data-name')}));
    const ans=(document.querySelector('#chat')?.innerText||'').slice(-500);
    return JSON.stringify({chips,ans});
  })()`);
  const { chips, ans } = JSON.parse(info);
  console.log("CHIPS:", JSON.stringify(chips, null, 2));
  console.log("ANSWER TAIL:", ans.replace(/\n+/g, " ").slice(-380));

  // 4. click the syllabus chip (the bridged PDF)
  const clicked = await evalJs(ws, `(()=>{
    const chips=[...document.querySelectorAll('.sources .src[data-cite]')];
    const c=chips.find(x=>/syllabus/i.test(x.getAttribute('data-name')||x.textContent))||chips[0];
    if(!c) return null; c.click(); return c.textContent.trim();
  })()`);
  console.log("clicked chip:", clicked);

  // 5. poll until the PDF rendered AND the passage highlight painted, then capture
  //    AT THAT MOMENT (a later re-render can swap the viewer, per the first run).
  let captured = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const st = JSON.parse(await evalJs(ws, `(()=>{
      const canvases=document.querySelectorAll('#viewer canvas').length;
      const hl=[...document.querySelectorAll('#viewer .textLayer span.hl')];
      const spans=document.querySelectorAll('#viewer .textLayer span').length;
      const vtitle=(document.querySelector('#vtitle')?.textContent)||(document.querySelector('#viewer .vtitle')?.textContent)||'';
      const mode=document.querySelector('#viewer')?.getAttribute('data-mode')||'';
      return JSON.stringify({canvases, highlights:hl.length, textspans:spans, hlText:hl.map(s=>s.textContent).join(' ').slice(0,240), vtitle});
    })()`));
    if (st.highlights > 0 && st.canvases > 0) {
      console.log("VIEWER STATE (highlight painted):", JSON.stringify(st));
      // scroll the first highlight into center, then shoot immediately
      await evalJs(ws, `(()=>{const h=document.querySelector('#viewer .textLayer span.hl'); if(h) h.scrollIntoView({block:'center'});})()`);
      await sleep(400);
      await shot(ws, "cite-3-viewer");
      captured = true;
      break;
    }
    await sleep(300);
  }
  if (!captured) { console.log("highlight never painted within 30s — capturing whatever is there"); await shot(ws, "cite-3-viewer"); }

  console.log("DONE");
  ws.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
