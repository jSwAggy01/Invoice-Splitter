/**
 * Invoice Splitter — app.js  v2.0
 * Features:
 *   - counts mode  : sequential pages, optional per-invoice count (Name, N)
 *   - ranges mode  : explicit page ranges (Name, start-end)
 *   - start-at     : skip leading pages in counts mode
 *   - strict       : hard validation of total coverage
 *   - password     : decrypt password-protected PDFs
 *   - match preview: live table showing each invoice → pages assignment + status
 * All processing happens in the browser; nothing is uploaded.
 */

"use strict";

// ── State ────────────────────────────────────────────────────────────────────
let pdfFile      = null;
let namesFile    = null;
let pdfPageCount = 0;
let mode         = "counts"; // "counts" | "ranges"

// ── Parsing Helpers ───────────────────────────────────────────────────────────

function stripComment(raw) { return raw.split("#")[0].trim(); }

function readLines(text) {
  return text.split(/\r?\n/).map(stripComment).filter(Boolean);
}

function sanitizeFilename(name) {
  name = name.split("#")[0].trim();
  name = name.replace(/[<>:"/\\|?*]/g, "").trim();
  if (!name || name === "." || name === "..") name = "unnamed";
  if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
  return name;
}

function makeUnique(name, usedSet) {
  const dot  = name.lastIndexOf(".");
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext  = dot >= 0 ? name.slice(dot)    : "";
  let candidate = name, counter = 1;
  while (usedSet.has(candidate)) candidate = `${base}-${counter++}${ext}`;
  usedSet.add(candidate);
  return candidate;
}

/** Parse counts mode → [{name, count}] */
function parseCounts(lines) {
  return lines.map(line => {
    const parts = line.split(/[,|\t]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const name = parts[0];
    let count = 1;
    if (parts.length >= 2) {
      count = parseInt(parts[1], 10);
      if (isNaN(count) || count <= 0)
        throw new Error(`Invalid page count on line: "${line}". Provide a positive integer.`);
    }
    return { name, count };
  }).filter(Boolean);
}

/** Parse ranges mode → [{name, start, end}] (1-based inclusive) */
function parseRanges(lines) {
  return lines.map(line => {
    const parts = line.split(/[,|\t]/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2)
      throw new Error(`Missing range on line: "${line}". Expected "Name, start-end".`);
    const name = parts[0];
    const m = parts[1].match(/^(\d+)-(\d+)$/);
    if (!m)
      throw new Error(`Invalid range on line: "${line}". Expected "start-end" integers.`);
    const start = parseInt(m[1], 10), end = parseInt(m[2], 10);
    if (start <= 0 || end <= 0 || end < start)
      throw new Error(`Range must be positive and start ≤ end. Got: ${start}-${end} on "${line}".`);
    return { name, start, end };
  });
}

function rangeArr(start, end) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

// ── Preview Builder ───────────────────────────────────────────────────────────

/**
 * Build a preview row list from parsed items + current settings.
 * Returns an array of:
 *   { name, pagesLabel, status, note }
 * status: "ok" | "warn" | "leftover"
 */
function buildPreviewRows(lines, numPages, startAt, strict) {
  const rows = [];

  if (mode === "counts") {
    let items;
    try { items = parseCounts(lines); }
    catch (e) { return [{ name: e.message, pagesLabel: "—", status: "warn", note: "parse error" }]; }

    const startIdx = startAt - 1;
    let cur = startIdx;

    for (const { name, count } of items) {
      const from = cur + 1;
      const to   = Math.min(cur + count, numPages);
      const actualCount = Math.max(0, to - cur);
      let status = "ok", note = "";

      if (cur >= numPages) {
        status = "warn";
        note = "beyond PDF end";
        rows.push({ name, pagesLabel: "—", status, note });
        continue;
      }
      if (actualCount < count) {
        status = "warn";
        note = `truncated (only ${actualCount} of ${count} pages available)`;
      }

      const label = actualCount === 1 ? `p.${from}` : `p.${from}–${to}`;
      rows.push({ name, pagesLabel: label, status, note });
      cur = to;
    }

    // Leftover pages
    if (cur < numPages) {
      for (let p = cur; p < numPages; p++) {
        rows.push({
          name: `leftover-page-${p + 1}`,
          pagesLabel: `p.${p + 1}`,
          status: "leftover",
          note: "not in names file"
        });
      }
    }

    // Pages skipped by start-at
    if (startIdx > 0) {
      for (let p = 0; p < startIdx; p++) {
        rows.unshift({
          name: `(skipped — page ${p + 1})`,
          pagesLabel: `p.${p + 1}`,
          status: "leftover",
          note: "before start-at"
        });
      }
    }

  } else {
    // ranges mode
    let items;
    try { items = parseRanges(lines); }
    catch (e) { return [{ name: e.message, pagesLabel: "—", status: "warn", note: "parse error" }]; }

    // Check overlaps
    const sorted = [...items].sort((a, b) => a.start - b.start);
    const overlapSet = new Set();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= sorted[i-1].end) {
        overlapSet.add(sorted[i-1].name);
        overlapSet.add(sorted[i].name);
      }
    }

    for (const { name, start, end } of items) {
      let status = "ok", note = "";
      if (start < 1 || end > numPages) {
        status = "warn";
        note = `out of bounds (PDF has ${numPages} pages)`;
      } else if (overlapSet.has(name)) {
        status = "warn";
        note = "overlaps with another range";
      }
      const label = start === end ? `p.${start}` : `p.${start}–${end}`;
      rows.push({ name, pagesLabel: label, status, note });
    }

    // Uncovered pages
    const covered = new Set();
    for (const { start, end } of items)
      for (let p = start; p <= end; p++) covered.add(p);
    for (let p = 1; p <= numPages; p++) {
      if (!covered.has(p)) {
        rows.push({
          name: `(uncovered — page ${p})`,
          pagesLabel: `p.${p}`,
          status: "leftover",
          note: "not assigned to any invoice"
        });
      }
    }
  }

  return rows;
}

function renderPreviewTable(rows) {
  const tbody = document.getElementById("match-tbody");
  tbody.innerHTML = "";

  rows.forEach((row, i) => {
    const tr = document.createElement("tr");

    const noteHtml = row.note
      ? ` <span style="color:var(--text-dim);font-size:0.71rem;margin-left:6px">${escHtml(row.note)}</span>`
      : "";

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="name-cell" title="${escHtml(row.name)}">${escHtml(sanitizeFilename(row.name))}</td>
      <td class="pages-cell">${escHtml(row.pagesLabel)}</td>
      <td><span class="status-pill ${row.status}">${statusLabel(row.status)}</span>${noteHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("match-preview").classList.remove("hidden");
}

function statusLabel(s) {
  if (s === "ok")       return "✓ matched";
  if (s === "warn")     return "⚠ issue";
  if (s === "leftover") return "◦ leftover";
  return s;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Core Split Functions ──────────────────────────────────────────────────────

async function splitCounts({ pdfDoc, items, startAt, strict, zip, folderName }) {
  const numPages = pdfDoc.getPageCount();
  const startIdx = startAt - 1;

  if (startAt < 1 || startAt > numPages)
    throw new Error(`Start-at must be between 1 and ${numPages}. Got: ${startAt}.`);

  const totalRequested = items.reduce((s, i) => s + i.count, 0);
  const remaining = numPages - startIdx;
  const warnings = [];

  if (strict && startIdx + totalRequested !== numPages) {
    throw new Error(
      `Strict mode: total counts (${totalRequested}) from start-at=${startAt} ` +
      `must exactly cover remaining pages (${remaining}).`
    );
  } else if (startIdx + totalRequested > numPages) {
    warnings.push(`Counts exceed available pages. Last invoice(s) will be truncated.`);
  } else if (startIdx + totalRequested < numPages) {
    warnings.push(`Counts cover fewer pages than available. ${remaining - totalRequested} leftover page(s) saved separately.`);
  }

  const usedNames = new Set();
  let cur = startIdx;

  for (const { name, count } of items) {
    if (count <= 0) continue;
    if (cur >= numPages) break;
    const endIdx = Math.min(cur + count, numPages);
    const newPdf = await PDFLib.PDFDocument.create();
    const pages  = await newPdf.copyPages(pdfDoc, rangeArr(cur, endIdx));
    pages.forEach(p => newPdf.addPage(p));
    zip.file(`${folderName}/${makeUnique(sanitizeFilename(name), usedNames)}`, await newPdf.save());
    cur = endIdx;
  }

  if (cur < numPages && !strict) {
    for (let p = cur; p < numPages; p++) {
      const newPdf = await PDFLib.PDFDocument.create();
      const [page] = await newPdf.copyPages(pdfDoc, [p]);
      newPdf.addPage(page);
      zip.file(`${folderName}/${makeUnique(sanitizeFilename(`leftover-page-${p+1}`), usedNames)}`, await newPdf.save());
    }
  }
  return warnings;
}

async function splitRanges({ pdfDoc, items, strict, zip, folderName }) {
  const numPages = pdfDoc.getPageCount();
  const warnings = [];

  for (const { name, start, end } of items) {
    if (start < 1 || end > numPages)
      throw new Error(`Range out of bounds for "${name}": ${start}-${end} (PDF has ${numPages} pages).`);
  }

  const sorted = [...items].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i-1].end) {
      const msg = `Overlapping ranges: "${sorted[i-1].name}" ${sorted[i-1].start}-${sorted[i-1].end} overlaps "${sorted[i].name}" ${sorted[i].start}-${sorted[i].end}.`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
    }
  }

  const usedNames = new Set();
  for (const { name, start, end } of items) {
    const newPdf = await PDFLib.PDFDocument.create();
    const pages  = await newPdf.copyPages(pdfDoc, rangeArr(start - 1, end));
    pages.forEach(p => newPdf.addPage(p));
    zip.file(`${folderName}/${makeUnique(sanitizeFilename(name), usedNames)}`, await newPdf.save());
  }
  return warnings;
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function showBadge(which, name) {
  const badge = document.getElementById(`${which}-badge`);
  badge.querySelector("span").textContent = name;
  badge.classList.remove("hidden");
}
function hideBadge(which) {
  document.getElementById(`${which}-badge`).classList.add("hidden");
}
function setProgress(msg) {
  document.getElementById("progress-msg").textContent = msg;
  document.getElementById("progress-overlay").classList.remove("hidden");
}
function hideProgress() {
  document.getElementById("progress-overlay").classList.add("hidden");
}
function showWarning(msg) {
  const box = document.getElementById("warn-box");
  box.textContent = msg;
  box.classList.remove("hidden");
}
function clearWarning() {
  document.getElementById("warn-box").classList.add("hidden");
}
function setButtonState() {
  document.getElementById("split-btn").disabled = !(pdfFile && namesFile);
}

/** Called whenever either file changes, mode changes, or start-at changes. */
async function refreshPreview() {
  document.getElementById("stat-mode").textContent = mode;

  if (!namesFile) {
    document.getElementById("stat-invoices").textContent = "—";
    document.getElementById("stat-covered").textContent  = "—";
    document.getElementById("match-preview").classList.add("hidden");
    setButtonState();
    return;
  }

  let text;
  try { text = await namesFile.text(); } catch { return; }

  const lines = readLines(text);
  document.getElementById("stat-invoices").textContent = lines.length;

  if (pdfPageCount > 0 && lines.length > 0) {
    const startAt = parseInt(document.getElementById("start-at").value, 10) || 1;
    const strict  = document.getElementById("strict-mode").checked;

    // Calculate covered page count for the stat bar
    let covered = 0;
    try {
      if (mode === "counts") {
        const items = parseCounts(lines);
        const total = items.reduce((s, i) => s + i.count, 0);
        covered = Math.min(total, pdfPageCount - (startAt - 1));
      } else {
        const items = parseRanges(lines);
        const pages = new Set();
        items.forEach(({ start, end }) => {
          for (let p = start; p <= Math.min(end, pdfPageCount); p++) pages.add(p);
        });
        covered = pages.size;
      }
    } catch { covered = "?"; }

    document.getElementById("stat-covered").textContent = covered;

    // Build and render preview table
    const rows = buildPreviewRows(lines, pdfPageCount, startAt, strict);
    renderPreviewTable(rows);
  } else {
    document.getElementById("stat-covered").textContent = "—";
    document.getElementById("match-preview").classList.add("hidden");
  }

  setButtonState();
}

// ── Drop Zone Setup ───────────────────────────────────────────────────────────

function setupDropZone(dropId, inputId, accept, onFile) {
  const drop  = document.getElementById(dropId);
  const input = document.getElementById(inputId);

  drop.addEventListener("click",  () => input.click());
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") input.click(); });
  input.addEventListener("change", () => { if (input.files[0]) onFile(input.files[0]); input.value = ""; });

  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (accept.includes(ext) || accept.includes(file.type)) {
      onFile(file);
    } else {
      alert(`Wrong file type. Expected: ${accept.join(", ")}`);
    }
  });
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // PDF drop zone
  setupDropZone("pdf-drop", "pdf-input", ["pdf"], async file => {
    pdfFile = file;
    showBadge("pdf", file.name);
    pdfPageCount = 0;
    document.getElementById("stat-pages").textContent = "…";

    try {
      const buf = await file.arrayBuffer();
      const doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
      pdfPageCount = doc.getPageCount();
      document.getElementById("stat-pages").textContent = pdfPageCount;
    } catch {
      document.getElementById("stat-pages").textContent = "?";
    }
    refreshPreview();
  });

  document.getElementById("pdf-remove").addEventListener("click", e => {
    e.stopPropagation();
    pdfFile = null; pdfPageCount = 0;
    hideBadge("pdf");
    document.getElementById("stat-pages").textContent = "—";
    document.getElementById("stat-covered").textContent = "—";
    document.getElementById("match-preview").classList.add("hidden");
    setButtonState();
  });

  // Names file drop zone
  setupDropZone("names-drop", "names-input", ["txt", "text/plain"], file => {
    namesFile = file;
    showBadge("names", file.name);
    refreshPreview();
  });

  document.getElementById("names-remove").addEventListener("click", e => {
    e.stopPropagation();
    namesFile = null;
    hideBadge("names");
    document.getElementById("stat-invoices").textContent = "—";
    document.getElementById("stat-covered").textContent  = "—";
    document.getElementById("match-preview").classList.add("hidden");
    setButtonState();
  });

  // Mode toggle
  function setMode(m) {
    mode = m;
    document.getElementById("mode-counts").classList.toggle("active", m === "counts");
    document.getElementById("mode-ranges").classList.toggle("active", m === "ranges");
    document.getElementById("hint-counts").classList.toggle("hidden", m !== "counts");
    document.getElementById("hint-ranges").classList.toggle("hidden", m !== "ranges");
    document.getElementById("start-at-group").classList.toggle("hidden", m !== "counts");
    refreshPreview();
  }
  document.getElementById("mode-counts").addEventListener("click", () => setMode("counts"));
  document.getElementById("mode-ranges").addEventListener("click", () => setMode("ranges"));

  // Re-run preview when start-at or strict changes
  document.getElementById("start-at").addEventListener("input", refreshPreview);
  document.getElementById("strict-mode").addEventListener("change", refreshPreview);

  // Split button
  document.getElementById("split-btn").addEventListener("click", runSplit);
});

// ── Main Split Runner ─────────────────────────────────────────────────────────

async function runSplit() {
  clearWarning();
  if (!pdfFile || !namesFile) return;

  const folderName = (document.getElementById("output-folder").value.trim() || "invoices")
    .replace(/[<>:"/\\|?*]/g, "").trim() || "invoices";
  const startAt  = parseInt(document.getElementById("start-at").value, 10) || 1;
  const strict   = document.getElementById("strict-mode").checked;
  const password = document.getElementById("password").value;

  setProgress("Loading files…");

  try {
    const [pdfBuf, namesText] = await Promise.all([pdfFile.arrayBuffer(), namesFile.text()]);

    setProgress("Loading PDF…");
    let pdfDoc;
    try {
      pdfDoc = await PDFLib.PDFDocument.load(pdfBuf, password ? { password } : {});
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes("encrypt"))
        throw new Error("This PDF is password-protected. Enter the password in Options.");
      throw e;
    }

    document.getElementById("stat-pages").textContent = pdfDoc.getPageCount();

    const lines = readLines(namesText);
    if (!lines.length) throw new Error("Names file is empty or contains only comments.");

    const zip = new JSZip();
    let warnings = [];

    setProgress("Splitting pages…");
    if (mode === "counts") {
      warnings = await splitCounts({ pdfDoc, items: parseCounts(lines), startAt, strict, zip, folderName });
    } else {
      warnings = await splitRanges({ pdfDoc, items: parseRanges(lines), strict, zip, folderName });
    }

    if (warnings.length) showWarning("⚠ " + warnings.join(" · "));

    setProgress("Building ZIP…");
    const zipBlob = await zip.generateAsync({ type: "blob" });
    hideProgress();

    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${folderName}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);

  } catch (err) {
    hideProgress();
    showWarning("Error: " + err.message);
    console.error(err);
  }
}
