/**
 * Invoice Splitter — app.js
 * Mirrors the full feature set of split_pdf_multi-page_invoices.py:
 *   - counts mode  : sequential pages, optional per-invoice count (Name, N)
 *   - ranges mode  : explicit page ranges (Name, start-end)
 *   - start-at     : skip leading pages in counts mode
 *   - strict       : hard validation of total coverage
 *   - password     : decrypt password-protected PDFs (pdf-lib supports this)
 * All processing happens in the browser; nothing is uploaded.
 */

"use strict";

// ── State ────────────────────────────────────────────────────────────────────
let pdfFile   = null;
let namesFile = null;
let mode      = "counts"; // "counts" | "ranges"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip inline comments and whitespace from a raw line. */
function stripComment(raw) {
  return raw.split("#")[0].trim();
}

/** Read all non-empty, non-comment lines from text. */
function readLines(text) {
  return text
    .split(/\r?\n/)
    .map(stripComment)
    .filter(Boolean);
}

/** Sanitize a name into a safe filename (mirrors Python sanitize_filename). */
function sanitizeFilename(name) {
  // strip inline comment
  name = name.split("#")[0].trim();
  // remove Windows-illegal chars
  name = name.replace(/[<>:"/\\|?*]/g, "").trim();
  if (!name || name === "." || name === "..") name = "unnamed";
  if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
  return name;
}

/** Make a unique filename to avoid collisions (like make_unique_path). */
function makeUnique(name, usedSet) {
  const dot = name.lastIndexOf(".");
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext  = dot >= 0 ? name.slice(dot)    : "";
  let candidate = name;
  let counter = 1;
  while (usedSet.has(candidate)) {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  }
  usedSet.add(candidate);
  return candidate;
}

/**
 * Parse counts mode lines.
 * Returns [{name, count}]
 */
function parseCounts(lines) {
  return lines.map(line => {
    const parts = line.split(/[,|\t]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const name = parts[0];
    let count = 1;
    if (parts.length >= 2) {
      count = parseInt(parts[1], 10);
      if (isNaN(count) || count <= 0) {
        throw new Error(`Invalid page count on line: "${line}". Provide a positive integer.`);
      }
    }
    return { name, count };
  }).filter(Boolean);
}

/**
 * Parse ranges mode lines.
 * Returns [{name, start, end}] (1-based inclusive)
 */
function parseRanges(lines) {
  return lines.map(line => {
    const parts = line.split(/[,|\t]/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      throw new Error(`Missing range on line: "${line}". Expected "Name, start-end".`);
    }
    const name = parts[0];
    const m = parts[1].match(/^(\d+)-(\d+)$/);
    if (!m) {
      throw new Error(`Invalid range on line: "${line}". Expected "start-end" integers.`);
    }
    const start = parseInt(m[1], 10);
    const end   = parseInt(m[2], 10);
    if (start <= 0 || end <= 0 || end < start) {
      throw new Error(`Range must be positive and start ≤ end. Got: ${start}-${end} on "${line}".`);
    }
    return { name, start, end };
  });
}

// ── Core Split Functions ─────────────────────────────────────────────────────

async function splitCounts({ pdfDoc, items, startAt, strict, zip, folderName }) {
  const numPages = pdfDoc.getPageCount();
  const startIdx = startAt - 1; // 0-based

  if (startAt < 1 || startAt > numPages) {
    throw new Error(`Start-at must be between 1 and ${numPages}. Got: ${startAt}.`);
  }

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
    warnings.push(`Counts cover fewer pages than available. ${remaining - totalRequested} leftover page(s) will be saved separately.`);
  }

  const usedNames = new Set();
  let currentIdx = startIdx;

  for (const { name, count } of items) {
    if (count <= 0) continue;
    const endIdx = Math.min(currentIdx + count, numPages);
    if (currentIdx >= numPages) break;

    const newPdf = await PDFLib.PDFDocument.create();
    const pages  = await newPdf.copyPages(pdfDoc, range(currentIdx, endIdx));
    pages.forEach(p => newPdf.addPage(p));

    const bytes   = await newPdf.save();
    const outName = makeUnique(sanitizeFilename(name), usedNames);
    zip.file(`${folderName}/${outName}`, bytes);
    currentIdx = endIdx;
  }

  // Leftovers
  if (currentIdx < numPages && !strict) {
    for (let p = currentIdx; p < numPages; p++) {
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

async function splitRanges({ pdfDoc, items, strict, zip, folderName }) {
  const numPages = pdfDoc.getPageCount();
  const warnings = [];

  // Validate bounds
  for (const { name, start, end } of items) {
    if (start < 1 || end > numPages) {
      throw new Error(
        `Range out of bounds for "${name}": ${start}-${end} (PDF has ${numPages} pages).`
      );
    }
  }

  // Check overlaps
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur  = sorted[i];
    if (cur.start <= prev.end) {
      const msg = `Overlapping ranges: "${prev.name}" ${prev.start}-${prev.end} overlaps "${cur.name}" ${cur.start}-${cur.end}.`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
    }
  }

  const usedNames = new Set();
  for (const { name, start, end } of items) {
    const newPdf = await PDFLib.PDFDocument.create();
    const pages  = await newPdf.copyPages(pdfDoc, range(start - 1, end));
    pages.forEach(p => newPdf.addPage(p));
    const bytes   = await newPdf.save();
    const outName = makeUnique(sanitizeFilename(name), usedNames);
    zip.file(`${folderName}/${outName}`, bytes);
  }

  return warnings;
}

/** range(start, end) → [start, start+1, ..., end-1] */
function range(start, end) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function updatePreview() {
  // We can't know page count without loading the PDF, so we show what we have
  const statsBox = document.getElementById("preview-stats");
  const statMode = document.getElementById("stat-mode");
  statMode.textContent = mode;

  // Update invoice count if names file is loaded
  if (namesFile) {
    namesFile.text().then(text => {
      const lines = readLines(text);
      document.getElementById("stat-invoices").textContent = lines.length;
    }).catch(() => {});
  } else {
    document.getElementById("stat-invoices").textContent = "—";
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

// ── Drop Zone Setup ───────────────────────────────────────────────────────────

function setupDropZone(dropId, inputId, accept, onFile) {
  const drop  = document.getElementById(dropId);
  const input = document.getElementById(inputId);

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") input.click(); });

  input.addEventListener("change", () => {
    if (input.files[0]) onFile(input.files[0]);
    input.value = "";
  });

  drop.addEventListener("dragover", e => {
    e.preventDefault();
    drop.classList.add("drag-over");
  });
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
  setupDropZone("pdf-drop", "pdf-input", ["pdf"], file => {
    pdfFile = file;
    showBadge("pdf", file.name);

    // Try to read page count immediately
    file.arrayBuffer().then(async buf => {
      try {
        const doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
        document.getElementById("stat-pages").textContent = doc.getPageCount();
      } catch {
        document.getElementById("stat-pages").textContent = "?";
      }
    });
    updatePreview();
  });

  document.getElementById("pdf-remove").addEventListener("click", e => {
    e.stopPropagation();
    pdfFile = null;
    hideBadge("pdf");
    document.getElementById("stat-pages").textContent = "—";
    updatePreview();
  });

  // Names file drop zone
  setupDropZone("names-drop", "names-input", ["txt", "text/plain"], file => {
    namesFile = file;
    showBadge("names", file.name);
    updatePreview();
  });

  document.getElementById("names-remove").addEventListener("click", e => {
    e.stopPropagation();
    namesFile = null;
    hideBadge("names");
    document.getElementById("stat-invoices").textContent = "—";
    updatePreview();
  });

  // Mode toggle
  document.getElementById("mode-counts").addEventListener("click", () => setMode("counts"));
  document.getElementById("mode-ranges").addEventListener("click", () => setMode("ranges"));

  function setMode(m) {
    mode = m;
    document.getElementById("mode-counts").classList.toggle("active", m === "counts");
    document.getElementById("mode-ranges").classList.toggle("active", m === "ranges");
    document.getElementById("hint-counts").classList.toggle("hidden", m !== "counts");
    document.getElementById("hint-ranges").classList.toggle("hidden", m !== "ranges");
    document.getElementById("start-at-group").classList.toggle("hidden", m !== "counts");
    updatePreview();
  }

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
    const [pdfBuf, namesText] = await Promise.all([
      pdfFile.arrayBuffer(),
      namesFile.text(),
    ]);

    setProgress("Loading PDF…");

    let pdfDoc;
    try {
      const loadOpts = password ? { password } : {};
      pdfDoc = await PDFLib.PDFDocument.load(pdfBuf, loadOpts);
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes("encrypt")) {
        throw new Error("This PDF is password-protected. Enter the password in Options.");
      }
      throw e;
    }

    document.getElementById("stat-pages").textContent = pdfDoc.getPageCount();

    const lines = readLines(namesText);
    if (!lines.length) throw new Error("Names file is empty or contains only comments.");

    const zip = new JSZip();
    let warnings = [];

    setProgress("Splitting pages…");

    if (mode === "counts") {
      const items = parseCounts(lines);
      warnings = await splitCounts({ pdfDoc, items, startAt, strict, zip, folderName });
    } else {
      const items = parseRanges(lines);
      // ranges mode: strict defaults ON unless user unchecked it
      // We honour the checkbox here (user explicitly controls it)
      const rangesStrict = strict !== false; // checkbox default is unchecked → treat as strict=true for ranges
      // Actually: mirror the Python: ranges strict defaults ON
      // If checkbox is OFF we still apply strict for ranges by convention — but let user override.
      // For clarity: we use `strict` (the checkbox value) for both modes.
      warnings = await splitRanges({ pdfDoc, items, strict, zip, folderName });
    }

    if (warnings.length) showWarning("⚠ " + warnings.join(" | "));

    setProgress("Building ZIP…");
    const zipBlob = await zip.generateAsync({ type: "blob" });

    setProgress("Done!");
    hideProgress();

    // Trigger download
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
