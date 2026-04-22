# Invoice Splitter — Static (GitHub Pages) Build

A fully client-side version of the Invoice Splitter. Everything runs in the browser, so no server, no uploads, and nothing leaves your machine. This makes it perfect for hosting on GitHub Pages.

## Files

- `index.html` — the page
- `style.css` — styling (identical look to the Flask app)
- `app.js` — splitting logic (uses **pdf-lib** + **JSZip** loaded from CDN)
- `serve.py` — optional tiny Python server for local preview

## Run locally

From inside this folder:

```bash
python serve.py
```

Then open <http://localhost:8000>.

You can also just double-click `index.html` — but some browsers restrict file:// access, so a local server is safer.

## Deploy to GitHub Pages

1. Commit this `docs/` folder to your repository.
2. In your repo: **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Pick your branch and set the folder to **`/docs`**.
5. Save. Your site will be live at `https://<username>.github.io/<repo>/` within a minute or two.

## Notes

- **No backend.** All PDF processing happens in your browser via [pdf-lib](https://pdf-lib.js.org/) and [JSZip](https://stuk.github.io/jszip/).
- **Encrypted PDFs are not supported** in this static build (pdf-lib does not decrypt password-protected PDFs). Use the Flask version for those.
- Works offline once loaded if you swap the two CDN `<script>` tags in `index.html` for local copies of `pdf-lib.min.js` and `jszip.min.js`.
