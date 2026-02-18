import os
import sys
import io
import zipfile
import tempfile
import shutil
from flask import Flask, render_template, request, jsonify, send_file
from PyPDF2 import PdfReader, PdfWriter

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

ILLEGAL_CHARS = r'<>:"/\\|?*'


def sanitize_filename(name: str) -> str:
    sanitized = "".join(c for c in name if c not in ILLEGAL_CHARS).strip()
    if not sanitized or sanitized in {".", ".."}:
        sanitized = "unnamed"
    if not sanitized.lower().endswith(".pdf"):
        sanitized += ".pdf"
    return sanitized


def read_names_from_text(text: str, skip_blank_lines: bool = True):
    names = []
    for line in text.splitlines():
        raw = line.strip()
        if not raw and skip_blank_lines:
            continue
        names.append(raw)
    return names


def make_unique_name(filename: str, used: set):
    base_name, ext = os.path.splitext(filename)
    candidate = filename
    counter = 1
    while candidate in used:
        candidate = f"{base_name}-{counter}{ext}"
        counter += 1
    used.add(candidate)
    return candidate


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/preview", methods=["POST"])
def preview():
    pdf_file = request.files.get("pdf")
    names_file = request.files.get("names")

    if not pdf_file:
        return jsonify({"error": "Please select a PDF file."}), 400
    if not names_file:
        return jsonify({"error": "Please select a names file."}), 400

    try:
        pdf_data = pdf_file.read()
        reader = PdfReader(io.BytesIO(pdf_data))

        if reader.is_encrypted:
            password = request.form.get("password", "")
            if password:
                try:
                    reader.decrypt(password)
                    _ = len(reader.pages)
                except Exception:
                    return jsonify({"error": "Could not decrypt the PDF. Check the password."}), 400
            else:
                return jsonify({"error": "This PDF is encrypted. Please provide a password."}), 400

        num_pages = len(reader.pages)
        names_text = names_file.read().decode("utf-8", errors="replace")
        names = read_names_from_text(names_text)

        return jsonify({
            "pages": num_pages,
            "names_count": len(names),
            "names": names,
            "match": num_pages == len(names),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/split", methods=["POST"])
def split():
    pdf_file = request.files.get("pdf")
    names_file = request.files.get("names")

    if not pdf_file:
        return jsonify({"error": "Please select a PDF file."}), 400
    if not names_file:
        return jsonify({"error": "Please select a names file."}), 400

    try:
        pdf_data = pdf_file.read()
        reader = PdfReader(io.BytesIO(pdf_data))

        if reader.is_encrypted:
            password = request.form.get("password", "")
            if password:
                try:
                    reader.decrypt(password)
                    _ = len(reader.pages)
                except Exception:
                    return jsonify({"error": "Could not decrypt the PDF. Check the password."}), 400
            else:
                return jsonify({"error": "This PDF is encrypted. Please provide a password."}), 400

        num_pages = len(reader.pages)
        names_text = names_file.read().decode("utf-8", errors="replace")
        names = read_names_from_text(names_text)

        if not names:
            return jsonify({"error": "The names file is empty or has no valid entries."}), 400

        if len(names) > num_pages:
            names = names[:num_pages]
        elif len(names) < num_pages:
            names = names + [f"page-{i+1}" for i in range(len(names), num_pages)]

        zip_buffer = io.BytesIO()
        used_names = set()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx in range(num_pages):
                clean_filename = sanitize_filename(names[idx])
                unique_name = make_unique_name(clean_filename, used_names)

                writer = PdfWriter()
                writer.add_page(reader.pages[idx])

                pdf_buffer = io.BytesIO()
                writer.write(pdf_buffer)
                pdf_buffer.seek(0)

                zf.writestr(unique_name, pdf_buffer.read())

        zip_buffer.seek(0)

        original_name = os.path.splitext(pdf_file.filename or "output")[0]
        zip_filename = f"{original_name} - Split.zip"

        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=zip_filename,
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    is_dev = os.environ.get("REPL_SLUG") is not None
    app.run(host="0.0.0.0", port=5000, debug=is_dev)
