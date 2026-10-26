# serve the project; every change made with the page's panel is written into cat-stretch.html (and index.html via build.sh)
# usage: python3 tools/edit_server.py [port]   then open http://127.0.0.1:8766/
# (port 8765 stays for the test scripts, so their settings never land in the source)
import json, os, subprocess, sys, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from bake_in import bake, SRC
ROOT = os.path.dirname(SRC); LOCK = threading.Lock()
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', len(body))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if urlparse(self.path).path.endswith('/__edit'): return self.reply(200, {'ok': True})
        super().do_GET()
    def do_POST(self):
        if not urlparse(self.path).path.endswith('/__save'): return self.reply(404, {'error': 'not found'})
        origin = self.headers.get('Origin')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json' or (origin and urlparse(origin).hostname not in ('127.0.0.1', 'localhost')):
            return self.reply(403, {'error': 'only the page served here can save'})
        try:
            J = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            assert isinstance(J, dict), 'settings must be an object'
            with LOCK:
                changed = bake(J)
                if changed: subprocess.run(['sh', os.path.join(ROOT, 'build.sh')], check=True)
        except Exception as e:
            print('save failed:', e); return self.reply(400, {'error': str(e)})
        if changed: print('saved → cat-stretch.html, index.html')
        self.reply(200, {'ok': True, 'changed': changed})

print(f'Edit mode: open http://127.0.0.1:{PORT}/  (changes are written into cat-stretch.html; Ctrl+C to stop)')
ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=ROOT)).serve_forever()
