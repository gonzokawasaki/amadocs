const puppeteer = require("puppeteer");
const OUT = "/mnt/space/k-base/tooling/logs";
(async () => {
  const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const pages = await b.pages();
  const page = pages.find((p) => p.url().includes("ui/index.html")) || pages[0];
  await page.setViewport({ width: 1280, height: 820 });
  const state = await page.evaluate(() => ({
    sendText: (document.querySelector("#send")?.textContent || "").trim(),
    sourcesBlocks: document.querySelectorAll(".sources").length,
    srcChips: document.querySelectorAll(".sources .src").length,
    resolvedChips: document.querySelectorAll(".sources .src[data-cite]").length,
    chipText: [...document.querySelectorAll(".sources .src")].map(e=>e.textContent.trim()),
    answerTail: (document.querySelector("#chat")?.innerText || "").replace(/\n+/g," ").slice(-500),
  }));
  console.log(JSON.stringify(state, null, 2));
  await page.screenshot({ path: `${OUT}/look-live.png` });
  await b.disconnect();
})().catch(e=>{console.error("ERR:",e.message);process.exit(1);});
