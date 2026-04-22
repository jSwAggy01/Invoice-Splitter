"""
Tiny local server for previewing the static GitHub Pages build.

Run from inside the `docs/` folder:
    python serve.py

Then open http://localhost:8000 in your browser.
"""
import http.server
import os
import socketserver

PORT = 8000

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"Serving docs/ at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
