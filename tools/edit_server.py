# serve the project; every change made with the page's panel is written into cat-stretch.html (and index.html via build.sh)
# usage: python3 tools/edit_server.py [port]   then open http://127.0.0.1:8766/
# (port 8765 stays for the test scripts, so their settings never land in the source)
import json, os, shutil, subprocess, sys, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from bake_in import bake, SRC
ROOT = os.path.dirname(SRC); LOCK = threading.Lock(); FUR = os.path.join(ROOT, 'fur', 'settings.json')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766

# fur.js furs Gav's body, legs, neck, tail and ears from a snapshot of his drawing (fur/gav-parts.js, by fur/make-parts.js): made
# again in the background once the saves have stopped for a moment, one run at a time (an open Gav page picks it up by itself)
NODE = shutil.which('node') or '/opt/homebrew/bin/node'; PARTS = {'timer': None, 'running': False, 'again': False}; PLOCK = threading.Lock()
def parts_soon(wait=2.0):
    with PLOCK:
        if PARTS['timer']: PARTS['timer'].cancel()
        PARTS['timer'] = threading.Timer(wait, parts_run); PARTS['timer'].daemon = True; PARTS['timer'].start()
def parts_run():
    with PLOCK:
        if PARTS['running']: PARTS['again'] = True; return
        PARTS['running'] = True
    try:
        r = subprocess.run([NODE, os.path.join(ROOT, 'fur', 'make-parts.js')], cwd=ROOT, capture_output=True, text=True, timeout=180)
        print('fur parts:', 'no change' if 'no change' in r.stdout else 'made again' if r.returncode == 0 else 'failed\n' + r.stderr[-600:])
    except Exception as e: print('fur parts failed:', e)
    with PLOCK:
        PARTS['running'] = False; again = PARTS['again']; PARTS['again'] = False
    if again: parts_soon(0.5)

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
        path = urlparse(self.path).path
        if not path.endswith('/__save'): return self.reply(404, {'error': 'not found'})
        origin = self.headers.get('Origin')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json' or (origin and urlparse(origin).hostname not in ('127.0.0.1', 'localhost')):
            return self.reply(403, {'error': 'only the page served here can save'})
        if path == '/fur/__save': return self.save_fur()
        try:
            J = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            assert isinstance(J, dict), 'settings must be an object'
            with LOCK:
                changed = bake(J)
                if changed: subprocess.run(['sh', os.path.join(ROOT, 'build.sh')], check=True)
        except Exception as e:
            print('save failed:', e); return self.reply(400, {'error': str(e)})
        if changed: print('saved → cat-stretch.html, index.html'); parts_soon()
        self.reply(200, {'ok': True, 'changed': changed})
    # the fur page (fur/index.html): one part's fur.js settings into fur/settings.json, which the cat reads
    def save_fur(self):
        try:
            J = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            part, settings = J.get('part'), J.get('settings')
            assert isinstance(part, str) and part.isalpha() and isinstance(settings, dict), 'needs a part name and its settings'
            with LOCK:
                try:
                    with open(FUR) as f: allp = json.load(f)
                except FileNotFoundError: allp = {}
                allp[part] = settings
                with open(FUR + '.tmp', 'w') as f: json.dump(allp, f, indent=1)
                os.replace(FUR + '.tmp', FUR)
        except Exception as e:
            print('fur save failed:', e); return self.reply(400, {'error': str(e)})
        self.reply(200, {'ok': True})

print(f'Edit mode: open http://127.0.0.1:{PORT}/  (changes are written into cat-stretch.html; Ctrl+C to stop)')
ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=ROOT)).serve_forever()
