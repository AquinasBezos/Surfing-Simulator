"""Serves roblox/src on http://127.0.0.1:8765 for roblox/sync.luau.

The index (index.txt, every .luau file under src) is rebuilt on each request for it, so
new files are picked up without restarting.
"""
import http.server
import os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SRC, **kwargs)

    def translate_path(self, path):
        # /assets/... comes from the web game's own assets (menu art for upload_image)
        if path.startswith("/assets/"):
            return os.path.join(ASSETS, *path[len("/assets/"):].split("?")[0].split("/"))
        return super().translate_path(path)

    def do_GET(self):
        if self.path.split("?")[0] == "/index.txt":
            files = []
            for root, _, names in os.walk(SRC):
                for n in names:
                    if n.endswith(".luau"):
                        files.append(os.path.relpath(os.path.join(root, n), SRC).replace(os.sep, "/"))
            body = "\n".join(sorted(files)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
