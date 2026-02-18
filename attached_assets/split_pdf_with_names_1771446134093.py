import os
import sys
import argparse
from PyPDF2 import PdfReader, PdfWriter

ILLEGAL_CHARS = r'<>:"/\\|?*'  # Windows-illegal characters

def sanitize_filename(name: str) -> str:
    sanitized = "".join(c for c in name if c not in ILLEGAL_CHARS).strip()
    # Prevent empty or dot-only names after sanitization
    if not sanitized or sanitized in {".", ".."}:
        sanitized = "unnamed"
    # Always end with .pdf
    if not sanitized.lower().endswith(".pdf"):
        sanitized += ".pdf"
    return sanitized

def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

def read_names_file(path: str, skip_blank_lines: bool = True):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Names file not found: {path}")
    names = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            raw = line.rstrip("\n").strip()
            if not raw and skip_blank_lines:
                continue
            names.append(raw)
    return names

def make_unique_path(out_dir: str, filename: str, used: set):
    """Avoid overwriting by adding -1, -2, ... if needed."""
    base_name, ext = os.path.splitext(filename)
    candidate = filename
    counter = 1
    # Check collision both in filesystem and within our current run
    while candidate in used or os.path.exists(os.path.join(out_dir, candidate)):
        candidate = f"{base_name}-{counter}{ext}"
        counter += 1
    used.add(candidate)
    return os.path.join(out_dir, candidate)

def split_pdf_with_names(input_pdf: str, names_file: str, output_dir: str,
                         strict_count: bool = True, skip_blank_lines: bool = True,
                         password: str = None):
    ensure_dir(output_dir)

    # Load names
    names = read_names_file(names_file, skip_blank_lines=skip_blank_lines)
    if not names:
        raise ValueError("Names file produced no entries. Check for blank lines or encoding.")

    # Read PDF
    reader = PdfReader(input_pdf)
    if reader.is_encrypted:
        if password:
            try:
                reader.decrypt(password)
            except Exception as e:
                raise RuntimeError(f"Could not decrypt '{input_pdf}': {e}")
        else:
            raise RuntimeError(f"'{input_pdf}' is encrypted. Provide --password.")

    num_pages = len(reader.pages)
    if strict_count and len(names) != num_pages:
        raise ValueError(
            f"Names count ({len(names)}) does not match page count ({num_pages}). "
            f"Either fix the names file or run with --allow-short/--trim-extra."
        )

    # Adjust names length if not strict
    if len(names) > num_pages:
        print(f"[WARN] Names file has more entries than pages. Using first {num_pages}.")
        names = names[:num_pages]
    elif len(names) < num_pages:
        print(f"[WARN] Names file has fewer entries ({len(names)}) than pages ({num_pages}). "
              f"Remaining pages will use default 'page-N' names.")
        # Pad with defaults
        names = names + [f"page-{i+1}" for i in range(num_pages - len(names))]

    # Split and write
    used_names = set()
    for idx in range(num_pages):
        # Sanitize and ensure .pdf
        clean_filename = sanitize_filename(names[idx])
        out_path = make_unique_path(output_dir, clean_filename, used_names)

        writer = PdfWriter()
        writer.add_page(reader.pages[idx])
        with open(out_path, "wb") as f:
            writer.write(f)

    print(f"[OK] Wrote {num_pages} files to: {output_dir}")

def parse_args():
    parser = argparse.ArgumentParser(
        description="Split a PDF into single-page PDFs named from a text file (one name per line)."
    )
    parser.add_argument("--input", required=True, help="Path to the input PDF.")
    parser.add_argument("--names-file", required=True, help="Path to the text file with names.")
    parser.add_argument("--output", required=True, help="Destination folder for output PDFs.")
    parser.add_argument("--password", help="Password for encrypted PDFs (optional).")

    # Behavior toggles
    parser.add_argument("--allow-short", action="store_true",
                        help="Allow fewer names than pages; remaining pages will be named 'page-N'.")
    parser.add_argument("--trim-extra", action="store_true",
                        help="If more names than pages, ignore the extras.")
    parser.add_argument("--no-skip-blanks", action="store_true",
                        help="Do not skip blank lines in the names file.")
    return parser.parse_args()

def main():
    args = parse_args()
    strict = not (args.allow_short or args.trim_extra)
    skip_blank_lines = not args.no_skip_blanks

    try:
        split_pdf_with_names(
            input_pdf=args.input,
            names_file=args.names_file,
            output_dir=args.output,
            strict_count=strict,
            skip_blank_lines=skip_blank_lines,
            password=args.password,
        )
    except Exception as e:
        print(f"[ERROR] {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
