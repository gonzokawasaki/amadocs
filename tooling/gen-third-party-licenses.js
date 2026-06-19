#!/usr/bin/env node
// AMAdocs: generate the npm dependency attribution section of THIRD_PARTY_LICENSES.
// Walks the bundled node_modules trees, dedupes by name@version, and emits each
// package's declared license + the text of its bundled LICENSE file when present.
// Self-contained (no network). Run with: node tooling/gen-third-party-licenses.js
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TREES = [
  ["AnythingLLM engine — server", "anythingllm-upstream/server/node_modules"],
  ["AnythingLLM engine — collector", "anythingllm-upstream/collector/node_modules"],
  ["AMAdocs desktop (Electron)", "amadocs-desktop/node_modules"],
];
const LICENSE_FILES = [
  "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT", "LICENSE-MIT.txt",
  "license", "license.md", "license.txt",
  "LICENCE", "LICENCE.md", "LICENCE.txt",
  "COPYING", "COPYING.md", "COPYING.txt", "NOTICE", "NOTICE.txt",
];

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return null; } }
function licenseOf(pkg) {
  if (!pkg) return "UNKNOWN";
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map(l => l.type || l).filter(Boolean).join(" OR ") || "UNKNOWN";
  return "UNKNOWN";
}
function licenseText(dir) {
  for (const f of LICENSE_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      try { return fs.readFileSync(p, "utf8").trim(); } catch (_) {}
    }
  }
  return null;
}
// package roots live at node_modules/<pkg> or node_modules/@scope/<pkg>; recurse into nested node_modules.
function* walk(nmDir) {
  let entries;
  try { entries = fs.readdirSync(nmDir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(nmDir, e.name);
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("@")) {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory()) yield* pkgDir(path.join(full, sub.name));
      }
    } else {
      yield* pkgDir(full);
    }
  }
}
function* pkgDir(dir) {
  const pj = path.join(dir, "package.json");
  if (fs.existsSync(pj)) {
    const pkg = readJSON(pj);
    if (pkg && pkg.name && pkg.version) yield { dir, pkg };
  }
  const nested = path.join(dir, "node_modules");
  if (fs.existsSync(nested)) yield* walk(nested);
}

const seen = new Map(); // name@version -> entry
for (const [, rel] of TREES) {
  for (const { dir, pkg } of walk(path.join(ROOT, rel))) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    let author = "";
    if (typeof pkg.author === "string") author = pkg.author;
    else if (pkg.author && pkg.author.name) author = pkg.author.name + (pkg.author.email ? ` <${pkg.author.email}>` : "");
    const repo = (pkg.repository && (pkg.repository.url || pkg.repository)) || pkg.homepage || "";
    seen.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), author, repo: String(repo), text: licenseText(dir) });
  }
}

const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const byLicense = {};
for (const e of list) byLicense[e.license] = (byLicense[e.license] || 0) + 1;

const out = [];
out.push(`Bundled npm packages: ${list.length} unique (name@version), across the engine`);
out.push(`(server + collector) and the Electron desktop app.`);
out.push("");
out.push("License summary (SPDX as declared in each package.json):");
for (const [lic, n] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) out.push(`  ${String(n).padStart(4)}  ${lic}`);
out.push("");
out.push("=".repeat(78));
out.push("");
for (const e of list) {
  out.push(`### ${e.name}@${e.version}`);
  out.push(`License: ${e.license}`);
  if (e.author) out.push(`Author: ${e.author}`);
  if (e.repo) out.push(`Source: ${e.repo.replace(/^git\+/, "").replace(/\.git$/, "")}`);
  out.push("");
  if (e.text) { out.push(e.text); out.push(""); }
  else { out.push(`(No bundled license file; distributed under ${e.license} per its package metadata.)`); out.push(""); }
  out.push("-".repeat(78));
  out.push("");
}
// Assemble the final THIRD_PARTY_LICENSES: curated header (with embedded license
// texts) + this auto-generated Part C.
const rd = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8").trim(); } catch (_) { return `(license file not found: ${p})`; } };
let header = fs.readFileSync(path.join(__dirname, "_tpl-header.txt"), "utf8");
header = header
  .replace("%%ANYTHINGLLM_LICENSE%%", rd("anythingllm-upstream/LICENSE"))
  .replace("%%PDFJS_LICENSE%%", "PDF.js license:\n" + rd("amadocs-desktop/ui/vendor/pdfjs-LICENSE.txt"))
  .replace("%%MAMMOTH_LICENSE%%", "Mammoth license:\n" + rd("amadocs-desktop/ui/vendor/mammoth-LICENSE.txt"))
  .replace("%%XLSX_LICENSE%%", "SheetJS / xlsx license:\n" + rd("amadocs-desktop/ui/vendor/xlsx-LICENSE.txt"));
fs.writeFileSync(path.join(ROOT, "THIRD_PARTY_LICENSES"), header + "\n" + out.join("\n") + "\n");
console.log(`Wrote THIRD_PARTY_LICENSES — ${list.length} unique npm packages + curated header.`);
console.log("Top licenses:", Object.entries(byLicense).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join("  "));
