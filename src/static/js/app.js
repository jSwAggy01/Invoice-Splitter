document.addEventListener("DOMContentLoaded", () => {
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
    const passwordCard = document.getElementById("passwordCard");

    function setupDropZone(dropZone, input, fileNameEl, accept) {
        dropZone.addEventListener("click", () => input.click());

        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("drag-over");
        });

        dropZone.addEventListener("dragleave", () => {
            dropZone.classList.remove("drag-over");
        });

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
            if (file) {
                onFileSelected(dropZone, fileNameEl, file);
            }
        });
    }

    function onFileSelected(dropZone, fileNameEl, file) {
        dropZone.classList.add("has-file");
        fileNameEl.textContent = file.name;
        checkReady();
        tryPreview();
    }

    function checkReady() {
        const hasPdf = pdfInput.files.length > 0;
        const hasNames = namesInput.files.length > 0;
        splitBtn.disabled = !(hasPdf && hasNames);
    }

    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = "status-message " + type;
        statusMessage.style.display = "block";
        setTimeout(() => {
            statusMessage.style.display = "none";
        }, 8000);
    }

    function hideStatus() {
        statusMessage.style.display = "none";
    }

    async function tryPreview() {
        if (pdfInput.files.length === 0 || namesInput.files.length === 0) return;

        const formData = new FormData();
        formData.append("pdf", pdfInput.files[0]);
        formData.append("names", namesInput.files[0]);

        try {
            const resp = await fetch("/api/preview", { method: "POST", body: formData });
            const data = await resp.json();

            if (!resp.ok) {
                if (data.error && data.error.includes("encrypted")) {
                    passwordCard.style.display = "flex";
                }
                previewSection.style.display = "none";
                return;
            }

            passwordCard.style.display = "none";
            previewSection.style.display = "block";
            pageCount.textContent = data.pages;
            namesCount.textContent = data.names_count;

            if (data.match) {
                matchStatus.textContent = "Match";
                matchStatus.className = "match-status match";
            } else {
                matchStatus.textContent = "Mismatch";
                matchStatus.className = "match-status mismatch";
            }

            let tableHTML = "<table><thead><tr><th>Page</th><th>Output File Name</th></tr></thead><tbody>";
            const maxShow = Math.max(data.pages, data.names_count);
            for (let i = 0; i < Math.min(maxShow, 50); i++) {
                const name = i < data.names.length ? data.names[i] : `<em>page-${i + 1}</em>`;
                const pageLabel = i < data.pages ? i + 1 : "-";
                tableHTML += `<tr><td class="page-num">${pageLabel}</td><td>${escapeHtml(typeof name === 'string' ? name : '')}</td></tr>`;
            }
            if (maxShow > 50) {
                tableHTML += `<tr><td colspan="2" style="text-align:center;color:#9ca3af;">... and ${maxShow - 50} more</td></tr>`;
            }
            tableHTML += "</tbody></table>";
            namesPreview.innerHTML = tableHTML;

        } catch (err) {
            previewSection.style.display = "none";
        }
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    splitForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideStatus();

        const formData = new FormData();
        formData.append("pdf", pdfInput.files[0]);
        formData.append("names", namesInput.files[0]);

        const outputFolder = document.getElementById("outputFolder");
        if (outputFolder && outputFolder.value.trim()) {
            formData.append("output_folder", outputFolder.value.trim());
        }

        const pw = document.getElementById("passwordInput");
        if (pw && pw.value) {
            formData.append("password", pw.value);
        }

        loadingOverlay.style.display = "flex";

        try {
            const resp = await fetch("/api/split", { method: "POST", body: formData });

            if (!resp.ok) {
                const data = await resp.json();
                showStatus(data.error || "Something went wrong. Please try again.", "error");
                loadingOverlay.style.display = "none";
                return;
            }

            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;

            const disposition = resp.headers.get("content-disposition");
            let filename = "split-invoices.zip";
            if (disposition) {
                const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
                if (match) filename = decodeURIComponent(match[1]);
            }

            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            showStatus("Done! Your split PDFs have been downloaded as a ZIP file.", "success");
        } catch (err) {
            showStatus("A network error occurred. Please check your connection and try again.", "error");
        }

        loadingOverlay.style.display = "none";
    });

    setupDropZone(pdfDropZone, pdfInput, pdfFileName);
    setupDropZone(namesDropZone, namesInput, namesFileName);
});
