// Drive the running Electron AMAdocs app (vision-test workspace) and screenshot the
// live ask -> answer -> citation-chip -> open-in-viewer flow on a REAL photo (IMG_5127.jpg),
// whose only indexed text is moondream's vision caption (OCR was garbage).
const puppeteer = require("puppeteer");
const OUT = "/mnt/space/k-base/tooling/logs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes("ui/index.html")) || pages[0];
  await page.bringToFront();
  await page.setViewport({ width: 1280, height: 820 });

  // clean chat
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/look-1-initial.png` });

  // ask something answerable ONLY from the photo's vision caption
  const Q = "In the photo of people, what are they doing and what colour tools are they using?";
  await page.click("#q");
  await page.type("#q", Q);
  await sleep(150);
  await page.click("#send");

  // wait until streaming finished AND citations resolved into clickable chips
  await page.waitForFunction(() => {
    const sendTxt = (document.querySelector("#send")?.textContent || "").trim();
    const resolved = document.querySelector(".sources .src[data-cite]");
    return resolved && !sendTxt.includes("⏹"); // ⏹ gone => not streaming
  }, { timeout: 180000 });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/look-2-answer.png` });

  // report chips + answer tail
  const chips = await page.$$eval(".sources .src[data-cite]", (els) => els.map((e) => e.textContent.trim()));
  const answer = await page.$eval("#chat", (e) => e.innerText.slice(-700)).catch(() => "");
  console.log("RESOLVED CHIPS:", JSON.stringify(chips));
  console.log("ANSWER TAIL:", answer.replace(/\n+/g, " ").slice(-450));

  // click the chip for the photo (IMG_5127) -> opens it in the viewer
  const clicked = await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".sources .src[data-cite]")]
      .find((c) => /IMG_5127/i.test(c.getAttribute("data-name") || c.textContent)) ||
      document.querySelector(".sources .src[data-cite]");
    if (chip) { chip.click(); return chip.textContent.trim(); }
    return null;
  });
  console.log("clicked chip:", clicked);
  await sleep(3000); // viewer render
  const viewerVisible = await page.$eval("#viewer", (e) => !e.classList.contains("hidden")).catch(() => false);
  console.log("viewer visible:", viewerVisible);
  await page.screenshot({ path: `${OUT}/look-3-viewer.png` });

  console.log("DONE");
  await browser.disconnect();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
