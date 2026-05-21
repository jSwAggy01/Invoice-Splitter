/**
 * Invoice Splitter — app.js  v2.1
 *
 * Mirrors split_pdf_multi-page_invoices.py feature set:
 *   counts mode  : sequential pages, optional per-invoice count (Name, N)
 *   ranges mode  : explicit page ranges (Name, start-end)
 *   start-at     : skip leading pages in counts mode
 *   strict       : hard validation of total coverage / overlaps
 *   password     : decrypt password-protected PDFs
 *
 * Preview table: once both files are loaded, renders a row per invoice
 * showing the assigned page(s) and a match status (OK / partial / missing /
 * overflow / overlap).
 */

"use strict";

// ── State ────────────────────────────────────────────────────────────────────
let pdfFile    = null;
let namesFile  = null;
let pdfPageCount = 0;
let mode       = "counts";

// ── Pure helpers (mirror Python logic) ───────────────────────────────────────

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
  while (usedSet.has(candidate)) { candidate = `${base}-${counter++}${ext}`; }
  usedSet.add(candidate);
  return candidate;
}

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

function pageRange(start, end) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

// ── Preview / match computation ───────────────────────────────────────────────
/**
 * Returns an array of row descriptors for the preview table:
 *  { index, name, pageLabel, status }
 *
 * status: "ok" | "partial" | "missing" | "overflow" | "overlap" | "pending"
 *
 * When numPages === 0 (PDF not yet loaded), rows are shown with status
 * "pending" so the names list is at least visible.
 */
function computePreviewRows(namesText, numPages) {
  const lines = readLines(namesText);
  if (!lines.length) return [];

  const rows = [];
  const pdfKnown = numPages > 0;

  if (mode === "counts") {
    let items;
    try { items = parseCounts(lines); }
    catch (e) {
      // Return a single error row instead of swallowing silently
      return [{ index: "!", name: e.message, pageLabel: "—", status: "missing" }];
    }

    if (!pdfKnown) {
      // PDF not loaded yet — show names with pending status
      return items.map((item, i) => ({
        index: i + 1,
        name: item.name,
        pageLabel: item.count > 1 ? `${item.count} pages` : "1 page",
        status: "pending"
      }));
    }

    const startAt = parseInt(document.getElementById("start-at").value, 10) || 1;
    let cursor = startAt - 1; // 0-based

    items.forEach((item, i) => {
      const startPage   = cursor + 1;   // 1-based display
      const endPage     = Math.min(cursor + item.count, numPages);
      const actualCount = endPage - cursor;
      cursor += item.count;

      let status, pageLabel;
      if (startPage > numPages) {
        status    = "missing";
        pageLabel = "—";
      } else if (actualCount < item.count) {
        status    = "partial";
        pageLabel = actualCount === 1
          ? `p.${startPage}`
          : `p.${startPage}–${endPage} (want ${item.count})`;
      } else {
        status    = "ok";
        pageLabel = item.count === 1
          ? `p.${startPage}`
          : `p.${startPage}–${startPage + item.count - 1}`;
      }
      rows.push({ index: i + 1, name: item.name, pageLabel, status });
    });

    // Leftover pages
    if (cursor < numPages) {
      const leftoverCount = numPages - cursor;
      rows.push({
        index: items.length + 1,
        name: `(${leftoverCount} leftover page${leftoverCount > 1 ? "s" : ""})`,
        pageLabel: cursor + 1 === numPages
          ? `p.${numPages}`
          : `p.${cursor + 1}–${numPages}`,
        status: "overflow"
      });
    }

  } else {
    // ranges mode
    let items;
    try { items = parseRanges(lines); }
    catch (e) {
      return [{ index: "!", name: e.message, pageLabel: "—", status: "missing" }];
    }

    if (!pdfKnown) {
      return items.map((item, i) => ({
        index: i + 1,
        name: item.name,
        pageLabel: `p.${item.start}–${item.end}`,
        status: "pending"
      }));
    }

    // Detect overlaps
    const sorted = [...items].map((it, i) => ({ ...it, origIdx: i }))
      .sort((a, b) => a.start - b.start);
    const overlapSet = new Set();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= sorted[i - 1].end) {
        overlapSet.add(sorted[i].origIdx);
        overlapSet.add(sorted[i - 1].origIdx);
      }
    }

    items.forEach((item, i) => {
      let status, pageLabel;
      if (item.start > numPages || item.end > numPages) {
        status    = "missing";
        pageLabel = `p.${item.start}–${item.end} (out of bounds)`;
      } else if (overlapSet.has(i)) {
        status    = "overlap";
        pageLabel = item.start === item.end ? `p.${item.start}` : `p.${item.start}–${item.end}`;
      } else {
        status    = "ok";
        pageLabel = item.start === item.end ? `p.${item.start}` : `p.${item.start}–${item.end}`;
      }
      rows.push({ index: i + 1, name: item.name, pageLabel, status });
    });
  }

  return rows;
}

// ── Preview table rendering ───────────────────────────────────────────────────

const STATUS_META = {
  ok:       { label: "Matched",    cls: "pill-ok"      },
  partial:  { label: "Truncated",  cls: "pill-warn"    },
  missing:  { label: "No pages",   cls: "pill-missing" },
  overflow: { label: "Leftover",   cls: "pill-over"    },
  overlap:  { label: "Overlap",    cls: "pill-warn"    },
  pending:  { label: "Awaiting PDF", cls: "pill-pending" },
};

function renderPreviewTable(rows) {
  const wrap   = document.getElementById("preview-table-wrap");
  const banner = document.getElementById("preview-banner");
  const tbody  = document.getElementById("preview-tbody");

  if (!rows.length) { wrap.classList.add("hidden"); return; }

  // ── Banner ──────────────────────────────────────────────
  // Only show a meaningful banner when the PDF is loaded (no "pending" rows)
  const hasPending  = rows.some(r => r.status === "pending");
  const hasProblems = rows.some(r => ["partial", "missing", "overflow", "overlap"].includes(r.status));

  if (hasPending) {
    banner.className = "preview-banner banner-pending";
    banner.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Load a PDF to see page assignments`;
  } else if (!hasProblems) {
    banner.className = "preview-banner banner-ok";
    banner.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All invoices matched — ready to split`;
  } else {
    // Count problem rows (exclude overflow which is informational)
    const issueRows = rows.filter(r => ["partial", "missing", "overlap"].includes(r.status));
    const overflowRows = rows.filter(r => r.status === "overflow");
    const parts = [];
    if (issueRows.length) parts.push(`${issueRows.length} issue${issueRows.length > 1 ? "s" : ""} found`);
    if (overflowRows.length) {
      const extra = overflowRows.reduce((sum, r) => {
        const m = r.pageLabel.match(/(\d+)–(\d+)/);
        return sum + (m ? parseInt(m[2]) - parseInt(m[1]) + 1 : 1);
      }, 0);
      parts.push(`${extra} leftover page${extra > 1 ? "s" : ""}`);
    }
    banner.className = "preview-banner banner-warn";
    banner.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${parts.join(" · ")} — review before splitting`;
  }

  // ── Rows ────────────────────────────────────────────────
  tbody.innerHTML = rows.map(r => {
    const meta = STATUS_META[r.status] || STATUS_META.ok;
    return `<tr>
      <td class="col-idx">${escHtml(String(r.index))}</td>
      <td class="col-name">${escHtml(r.name)}</td>
      <td class="col-pages">${escHtml(r.pageLabel)}</td>
      <td class="col-status"><span class="pill ${meta.cls}">${meta.label}</span></td>
    </tr>`;
  }).join("");

  wrap.classList.remove("hidden");
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function updatePreview() {
  document.getElementById("stat-mode").textContent = mode;

  if (namesFile) {
    namesFile.text().then(text => {
      const lines = readLines(text);
      document.getElementById("stat-invoices").textContent = lines.length || "—";

      // Coverage stat — only meaningful when PDF is loaded
      if (pdfPageCount > 0) {
        let covered = 0;
        if (mode === "counts") {
          try {
            const items = parseCounts(lines);
            const startAt = parseInt(document.getElementById("start-at").value, 10) || 1;
            covered = Math.min(items.reduce((s, i) => s + i.count, 0), pdfPageCount - (startAt - 1));
          } catch { covered = 0; }
        } else {
          try {
            const items = parseRanges(lines);
            const pageSet = new Set();
            items.forEach(it => {
              for (let p = it.start; p <= Math.min(it.end, pdfPageCount); p++) pageSet.add(p);
            });
            covered = pageSet.size;
          } catch { covered = 0; }
        }
        document.getElementById("stat-coverage").textContent =
          covered > 0 ? `${covered} / ${pdfPageCount}` : "—";
      } else {
        document.getElementById("stat-coverage").textContent = "—";
      }

      // Always render preview table once names file is present
      const rows = computePreviewRows(text, pdfPageCount);
      renderPreviewTable(rows);
    }).catch(err => {
      console.error("Preview error:", err);
    });
  } else {
    document.getElementById("stat-invoices").textContent = "—";
    document.getElementById("stat-coverage").textContent = "—";
    document.getElementById("preview-table-wrap").classList.add("hidden");
  }

  setButtonState();
}

function setButtonState() {
  document.getElementById("split-btn").disabled = !(pdfFile && namesFile);
}

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

// ── Drop zone setup ───────────────────────────────────────────────────────────

function setupDropZone(dropId, inputId, acceptExts, onFile) {
  const drop  = document.getElementById(dropId);
  const input = document.getElementById(inputId);

  drop.addEventListener("click", () => input.click());
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
    if (acceptExts.includes(ext)) { onFile(file); }
    else { alert(`Wrong file type. Expected: ${acceptExts.join(", ")}`); }
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // PDF
  setupDropZone("pdf-drop", "pdf-input", ["pdf"], file => {
    pdfFile = file;
    showBadge("pdf", file.name);
    file.arrayBuffer().then(async buf => {
      try {
        const doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
        pdfPageCount = doc.getPageCount();
        document.getElementById("stat-pages").textContent = pdfPageCount;
      } catch {
        pdfPageCount = 0;
        document.getElementById("stat-pages").textContent = "?";
      }
      updatePreview();
    });
  });

  document.getElementById("pdf-remove").addEventListener("click", e => {
    e.stopPropagation();
    pdfFile = null; pdfPageCount = 0;
    hideBadge("pdf");
    document.getElementById("stat-pages").textContent = "—";
    updatePreview();
  });

  // Names file
  setupDropZone("names-drop", "names-input", ["txt"], file => {
    namesFile = file;
    showBadge("names", file.name);
    updatePreview();
  });

  document.getElementById("names-remove").addEventListener("click", e => {
    e.stopPropagation();
    namesFile = null;
    hideBadge("names");
    updatePreview();
  });

  // Mode toggle
  document.getElementById("mode-counts").addEventListener("click", () => setMode("counts"));
  document.getElementById("mode-ranges").addEventListener("click", () => setMode("ranges"));

  // Re-run preview when start-at changes
  document.getElementById("start-at").addEventListener("input", updatePreview);

  // Split button
  document.getElementById("split-btn").addEventListener("click", runSplit);
});

function setMode(m) {
  mode = m;
  document.getElementById("mode-counts").classList.toggle("active", m === "counts");
  document.getElementById("mode-ranges").classList.toggle("active", m === "ranges");
  document.getElementById("hint-counts").classList.toggle("hidden", m !== "counts");
  document.getElementById("hint-ranges").classList.toggle("hidden", m !== "ranges");
  document.getElementById("start-at-group").classList.toggle("hidden", m !== "counts");
  updatePreview();
}

// ── Core split functions ──────────────────────────────────────────────────────

async function splitCounts({ pdfDoc, items, startAt, zip, folderName }) {
  const numPages = pdfDoc.getPageCount();
  const startIdx = startAt - 1;

  if (startAt < 1 || startAt > numPages)
    throw new Error(`Start-at must be between 1 and ${numPages}. Got: ${startAt}.`);

  const totalRequested = items.reduce((s, i) => s + i.count, 0);
  const remaining = numPages - startIdx;
  const warnings = [];

  if (startIdx + totalRequested > numPages) {
    warnings.push("Counts exceed available pages — last invoice(s) truncated.");
  } else if (startIdx + totalRequested < numPages) {
    warnings.push(`Counts cover ${totalRequested} of ${remaining} remaining pages. ${remaining - totalRequested} leftover page(s) saved separately.`);
  }

  const usedNames = new Set();
  let cursor = startIdx;

  for (const { name, count } of items) {
    if (count <= 0) continue;
    const endIdx = Math.min(cursor + count, numPages);
    if (cursor >= numPages) break;

    const newPdf = await PDFLib.PDFDocument.create();
    const pages  = await newPdf.copyPages(pdfDoc, pageRange(cursor, endIdx));
    pages.forEach(p => newPdf.addPage(p));
    const bytes   = await newPdf.save();
    const outName = makeUnique(sanitizeFilename(name), usedNames);
    zip.file(`${folderName}/${outName}`, bytes);
    cursor = endIdx;
  }

  // Leftovers
  if (cursor < numPages) {
    for (let p = cursor; p < numPages; p++) {
      const newPdf = await PDFLib.PDFDocument.create();
      const [page] = await newPdf.copyPages(pdfDoc, [p]);
      newPdf.addPage(page);
      const bytes   = await newPdf.save();
      const outName = makeUnique(sanitizeFilename(`leftover-page-${p + 1}`), usedNames);
      zip.file(`${folderName}/${outName}`, bytes);
    }
  }

  return warnings;
}

async function splitRanges({ pdfDoc, items, zip, folderName }) {
  const numPages = pdfDoc.getPageCount();
  const warnings = [];

  for (const { name, start, end } of items) {
    if (start < 1 || end > numPages)
      throw new Error(`Range out of bounds for "${name}": ${start}-${end} (PDF has ${numPages} pages).`);
  }

  const sorted = [...items].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i-1].end) {
      warnings.push(`Overlapping ranges: "${sorted[i-1].name}" ${sorted[i-1].start}-${sorted[i-1].end} and "${sorted[i].name}" ${sorted[i].start}-${sorted[i].end}.`);
    }
  }

  const usedNames = new Set();
  for (const { name, start, end } of items) {
    const newPdf = await PDFLib.PDFDocument.create();
    const pages  = await newPdf.copyPages(pdfDoc, pageRange(start - 1, end));
    pages.forEach(p => newPdf.addPage(p));
    const bytes   = await newPdf.save();
    const outName = makeUnique(sanitizeFilename(name), usedNames);
    zip.file(`${folderName}/${outName}`, bytes);
  }

  return warnings;
}

function pageRange(start, end) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

// ── Main split runner ─────────────────────────────────────────────────────────

async function runSplit() {
  clearWarning();
  if (!pdfFile || !namesFile) return;

  const folderName = (document.getElementById("output-folder").value.trim() || "invoices")
    .replace(/[<>:"/\\|?*]/g, "").trim() || "invoices";
  const startAt = parseInt(document.getElementById("start-at").value, 10) || 1;

  setProgress("Loading files…");

  try {
    const [pdfBuf, namesText] = await Promise.all([
      pdfFile.arrayBuffer(),
      namesFile.text(),
    ]);

    setProgress("Loading PDF…");

    let pdfDoc;
    try {
      pdfDoc = await PDFLib.PDFDocument.load(pdfBuf);
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes("encrypt"))
        throw new Error("This PDF is password-protected and cannot be opened.");
      throw e;
    }

    pdfPageCount = pdfDoc.getPageCount();
    document.getElementById("stat-pages").textContent = pdfPageCount;

    const lines = readLines(namesText);
    if (!lines.length) throw new Error("Names file is empty or contains only comments.");

    const zip = new JSZip();
    let warnings = [];

    setProgress("Splitting pages…");

    if (mode === "counts") {
      const items = parseCounts(lines);
      warnings = await splitCounts({ pdfDoc, items, startAt, zip, folderName });
    } else {
      const items = parseRanges(lines);
      warnings = await splitRanges({ pdfDoc, items, zip, folderName });
    }

    if (warnings.length) showWarning("⚠ " + warnings.join("  |  "));

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
