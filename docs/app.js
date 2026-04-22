document.addEventListener("DOMContentLoaded", () => {
    const { PDFDocument } = PDFLib;

    const pdfInput = document.getElementById("pdfInput");
    const namesInput = document.getElementById("namesInput");
    const pdfDropZone = document.getElementById("pdfDropZone");
    const namesDropZone = document.getElementById("namesDropZone");
    const pdfFileName = document.getElementById("pdfFileName");
    const namesFileName = document.getElementById("namesFileName");
    const splitBtn = document.getElementById("splitBtn");
    const splitForm = document.getElementById("splitForm");
    const previewSection = document.getElementById("previewSection");
    const pageCount = document.getElementById("pageCount");
    const namesCount = document.getElementById("namesCount");
    const matchStatus = document.getElementById("matchStatus");
    const namesPreview = document.getElementById("namesPreview");
    const statusMessage = document.getElementById("statusMessage");
    const loadingOverlay = document.getElementById("loadingOverlay");

    const ILLEGAL_CHARS = /[<>:"/\\|?*]/g;

    function sanitizeFilename(name) {
        let s = (name || "").replace(ILLEGAL_CHARS, "").trim();
        if (!s || s === "." || s === "..") s = "unnamed";
        if (!s.toLowerCase().endsWith(".pdf")) s += ".pdf";
        return s;
    }

    function sanitizeFolder(name) {
        let s = (name || "").replace(ILLEGAL_CHARS, "").trim();
        if (!s || s === "." || s === "..") s = "Split Invoices";
        return s;
    }

    function makeUniqueName(filename, used) {
        const dot = filename.lastIndexOf(".");
        const base = dot >= 0 ? filename.slice(0, dot) : filename;
        const ext = dot >= 0 ? filename.slice(dot) : "";
        let candidate = filename;
        let counter = 1;
        while (used.has(candidate)) {
            candidate = `${base}-${counter}${ext}`;
            counter++;
        }
        used.add(candidate);
        return candidate;
    }

    function readNamesFromText(text) {
        const out = [];
        for (const line of text.split(/\r?\n/)) {
            const raw = line.trim();
            if (!raw) continue;
            out.push(raw);
        }
        return out;
    }

    function setupDropZone(dropZone, input, fileNameEl) {
        dropZone.addEventListener("click", () => input.click());
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("drag-over");
        });
        dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("drag-over");
            const file = e.dataTransfer.files[0];
            if (file) {
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                onFileSelected(dropZone, fileNameEl, file);
            }
        });
        input.addEventListener("change", () => {
            const file = input.files[0];
            if (file) onFileSelected(dropZone, fileNameEl, file);
        });
    }

    function onFileSelected(dropZone, fileNameEl, file) {
        dropZone.classList.add("has-file");
        fileNameEl.textContent = file.name;
        checkReady();
        tryPreview();
    }

    function checkReady() {
        splitBtn.disabled = !(pdfInput.files.length && namesInput.files.length);
    }

    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = "status-message " + type;
        statusMessage.style.display = "block";
        setTimeout(() => { statusMessage.style.display = "none"; }, 8000);
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    async function loadPdf(file) {
        const buf = await file.arrayBuffer();
        try {
            return await PDFDocument.load(buf, { ignoreEncryption: false });
        } catch (err) {
            if (String(err).toLowerCase().includes("encrypt")) {
                throw new Error("This PDF is encrypted. Encrypted PDFs are not supported in the static browser version.");
            }
            throw err;
        }
    }

    async function tryPreview() {
        if (!pdfInput.files.length || !namesInput.files.length) return;
        try {
            const pdf = await loadPdf(pdfInput.files[0]);
            const numPages = pdf.getPageCount();
            const text = await namesInput.files[0].text();
            const names = readNamesFromText(text);

            previewSection.style.display = "block";
            pageCount.textContent = numPages;
            namesCount.textContent = names.length;

            const isMatch = numPages === names.length;
            matchStatus.textContent = isMatch ? "Match" : "Mismatch";
            matchStatus.className = "match-status " + (isMatch ? "match" : "mismatch");

            const maxShow = Math.max(numPages, names.length);
            let html = "<table><thead><tr><th>Page</th><th>Output File Name</th></tr></thead><tbody>";
            for (let i = 0; i < Math.min(maxShow, 50); i++) {
                const name = i < names.length ? names[i] : `<em>page-${i + 1}</em>`;
                const pageLabel = i < numPages ? i + 1 : "-";
                html += `<tr><td class="page-num">${pageLabel}</td><td>${escapeHtml(typeof name === "string" ? name : "")}</td></tr>`;
            }
            if (maxShow > 50) {
                html += `<tr><td colspan="2" style="text-align:center;color:#9ca3af;">... and ${maxShow - 50} more</td></tr>`;
            }
            html += "</tbody></table>";
            namesPreview.innerHTML = html;
        } catch (err) {
            previewSection.style.display = "none";
            showStatus(err.message || "Could not read the PDF.", "error");
        }
    }

    splitForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        loadingOverlay.style.display = "flex";

        try {
            const sourcePdf = await loadPdf(pdfInput.files[0]);
            const numPages = sourcePdf.getPageCount();
            const text = await namesInput.files[0].text();
            let names = readNamesFromText(text);

            if (!names.length) {
                showStatus("The names file is empty or has no valid entries.", "error");
                loadingOverlay.style.display = "none";
                return;
            }

            if (names.length > numPages) names = names.slice(0, numPages);
            else if (names.length < numPages) {
                for (let i = names.length; i < numPages; i++) names.push(`page-${i + 1}`);
            }

            const folder = sanitizeFolder(document.getElementById("outputFolder").value);
            const zip = new JSZip();
            const used = new Set();

            for (let i = 0; i < numPages; i++) {
                const newPdf = await PDFDocument.create();
                const [copied] = await newPdf.copyPages(sourcePdf, [i]);
                newPdf.addPage(copied);
                const bytes = await newPdf.save();
                const filename = makeUniqueName(sanitizeFilename(names[i]), used);
                zip.file(`${folder}/${filename}`, bytes);
            }

            const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${folder}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showStatus("Done! Your split PDFs have been downloaded as a ZIP file.", "success");
        } catch (err) {
            showStatus(err.message || "Something went wrong while splitting the PDF.", "error");
        }

        loadingOverlay.style.display = "none";
    });

    setupDropZone(pdfDropZone, pdfInput, pdfFileName);
    setupDropZone(namesDropZone, namesInput, namesFileName);
});
