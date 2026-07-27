#!/usr/bin/env python3
"""Serve the Expo web export locally, with SPA route fallback for refreshes."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


class ExpoPreviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        requested_path = urlparse(self.path).path
        if Path(requested_path).suffix:
            return super().send_head()

        resolved = Path(self.translate_path(requested_path))
        if resolved.exists():
            return super().send_head()

        self.path = "/index.html"
        return super().send_head()


def main():
    dist = Path(__file__).resolve().parents[1] / "dist"
    handler = partial(ExpoPreviewHandler, directory=str(dist))
    server = ThreadingHTTPServer(("", 8081), handler)
    print("Serving Expo web preview on http://localhost:8081")
    server.serve_forever()


if __name__ == "__main__":
    main()
