# -*- coding: utf-8 -*-
# Church Manager 로컬 서버 (HTTP Range 지원 — 오디오 탐색/시크용)
import http.server, os, re, socketserver, sys
from http.server import SimpleHTTPRequestHandler

class _Limited:
    def __init__(self, f, n): self.f = f; self.n = n
    def read(self, amt=-1):
        if self.n <= 0: return b''
        if amt is None or amt < 0: amt = self.n
        data = self.f.read(min(amt, self.n)); self.n -= len(data); return data
    def close(self):
        try: self.f.close()
        except Exception: pass

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)\s*$', rng)
        if not m:
            return super().send_head()
        size = os.path.getsize(path)
        s, e = m.group(1), m.group(2)
        if s == '':
            n = int(e or 0); start = max(0, size - n); end = size - 1
        else:
            start = int(s); end = int(e) if e else size - 1
        if start >= size or start < 0:
            self.send_error(416, 'Requested Range Not Satisfiable'); return None
        end = min(end, size - 1)
        length = end - start + 1
        f = open(path, 'rb'); f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(length))
        self.end_headers()
        return _Limited(f, length)

class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8002
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print('Church Manager - Local Server (Range 지원)')
    print('URL : http://localhost:%d' % port)
    ThreadingServer(('', port), Handler).serve_forever()
