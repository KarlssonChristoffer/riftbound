# Local dev server for the game: like `python -m http.server`, but tells the browser never to cache,
# so a refresh always loads the latest code.
import http.server, functools, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
    def log_message(self, *a):
        pass
    def translate_path(self, path):
        # the art a clone doesn't have (concepts/sprites/out) falls back to the stand-ins in assets/standin/ (server/server.mjs does the same)
        p = super().translate_path(path)
        u = path.split('?')[0]
        if not os.path.exists(p) and u.startswith('/concepts/sprites/out/'):
            q = os.path.join(root, 'assets', 'standin', *u.lstrip('/').split('/'))
            if os.path.exists(q): return q
        return p

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
root = os.path.dirname(os.path.abspath(__file__))
class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256   # the default (5) refuses connections when a page loads ~1000 sprite files at once
    daemon_threads = True

Server(('', port), functools.partial(NoCache, directory=root)).serve_forever()
