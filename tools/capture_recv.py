# Tiny capture receiver for scripted visual tests: a page POSTs JSON {name, url: <canvas dataURL>} and this writes
# <out>/<name>.png. Lets a test read the game canvas at full resolution (the browser pane's screenshots are scaled).
#
#   python tools/capture_recv.py [port=8199] [out=./caps]
#   in the page: fetch('http://127.0.0.1:8199', {method: 'POST', body: JSON.stringify({name, url: canvas.toDataURL()})})
import http.server, json, base64, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8199
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else 'caps')
os.makedirs(OUT, exist_ok=True)


class H(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*'); self.end_headers()

    def do_POST(self):
        d = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        p = os.path.join(OUT, os.path.basename(d['name']) + '.png')
        open(p, 'wb').write(base64.b64decode(d['url'].split(',', 1)[1]))
        self.send_response(200); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(p.encode())

    def log_message(self, *a):
        pass


print(f'capture receiver on 127.0.0.1:{PORT} -> {OUT}', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
