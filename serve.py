"""Serve the play viewer at http://localhost:8000 (run build_web_data.py first).

    python serve.py            # port 8000, opens your browser
    python serve.py --port 8080 --no-browser
"""

import argparse
import functools
import http.server
import webbrowser
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "web"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    if not (WEB_DIR / "data" / "index.json.gz").exists():
        print("Warning: web/data/index.json.gz not found. Run `python build_web_data.py` first.")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB_DIR))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    url = f"http://localhost:{args.port}/"
    print(f"Serving {WEB_DIR} at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
