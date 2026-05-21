# Invoice Splitter — Static (GitHub Pages) Build

A fully client-side Invoice Splitter. Everything runs in the browser — no server, no uploads, nothing leaves your machine. Perfect for hosting on GitHub Pages.

🔗 **Live site:** [jswaggy01.github.io/Invoice-Splitter](https://jswaggy01.github.io/Invoice-Splitter/)

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The page |
| `style.css` | Styling |
| `app.js` | Splitting logic (pdf-lib + JSZip from CDN) |
| `serve.py` | Optional tiny Python server for local preview |

---

## User Flow

### Step 1 — Select your PDF

Drop or browse for the multi-page PDF you want to split.

### Step 2 — Select your names file

A plain `.txt` file that tells the splitter what to name each output PDF and how many pages it spans. Choose a **splitting mode** first:

**Sequential counts** — pages are consumed in order from the top of the PDF. Each line is one invoice; optionally append a page count.

```
# One page each (default)
Acme-Invoice-001
BigCo-Invoice-002

# Multi-page — comma, pipe, or tab separator
Vendor-Invoice-003, 3
Another-Invoice-004 | 2
```

**Explicit ranges** — each line specifies exact start and end page numbers (1-based, inclusive).

```
Acme-Invoice-001, 1-1
BigCo-Invoice-002, 2-4
Vendor-Invoice-003 | 5-6
```

Lines beginning with `#` are treated as comments and ignored. Inline `# notes` after a name are also stripped.

### Step 3 — Configure options

| Option | Default | Notes |
|---|---|---|
| Output folder name | `invoices` | All split PDFs will sit inside this folder in the ZIP |
| Start at page | `1` | Counts mode only — skip leading pages (e.g. a cover sheet) |
| PDF password | *(blank)* | Required for password-protected PDFs |
| Strict validation | off | Errors on page count mismatches or overlapping ranges instead of warning |

### Step 4 — Split & Download

Click **Split & Download ZIP**. The browser packages all split PDFs and downloads the ZIP automatically.

---

## Names File Examples

### Counts mode — all single-page invoices
```
Invoice-Acme-2024-001
Invoice-BigCo-2024-002
Invoice-Vendor-2024-003
```

### Counts mode — mixed page counts
```
# 6-page PDF: first invoice is 1 page, second is 3, third is 2
Invoice-Acme-2024-001
Invoice-BigCo-2024-002, 3
Invoice-Vendor-2024-003, 2
```

### Ranges mode
```
Invoice-Acme-2024-001, 1-1
Invoice-BigCo-2024-002, 2-4
Invoice-Vendor-2024-003, 5-6
```

---

## Run Locally

From inside this `docs/` folder:

```bash
python serve.py
```

Then open [http://localhost:8000](http://localhost:8000).

You can also open `index.html` directly, but some browsers restrict `file://` access so a local server is safer.

---

## Deploy to GitHub Pages

1. Commit this `docs/` folder to your repository.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Pick your branch and set the folder to **`/docs`**.
5. Save. Your site will be live at `https://<username>.github.io/<repo>/` within a minute or two.

---

## CLI Script

For automation or power users, the Python CLI script (`split_pdf_multi-page_invoices.py` in the repo root) offers the same feature set:

```bash
python split_pdf_multi-page_invoices.py \
  --input combined_invoices.pdf \
  --names-file names.txt \
  --output ./split/ \
  --mode counts \
  --start-at 1 \
  --strict
```

See `replit.md` in the repo root for the full CLI reference.

---

## Notes

- **No backend.** All PDF processing happens in your browser via [pdf-lib](https://pdf-lib.js.org/) and [JSZip](https://stuk.github.io/jszip/).
- **Encrypted PDFs** are supported — enter the password in Step 3 before splitting.
- Works offline once loaded if you swap the CDN `<script>` tags in `index.html` for local copies of `pdf-lib.min.js` and `jszip.min.js`.
- Duplicate output names are automatically disambiguated (`name.pdf`, `name-1.pdf`, `name-2.pdf`, …).
