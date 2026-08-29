# -*- coding: utf-8 -*-
# 주석(.cdb) → JSON 변환 (개인 임포트용, 공개 저장소 제외)
# 사용: python tools/convert_comm.py
import sqlite3, json, io, os, re

base = os.path.join(os.path.dirname(__file__), '..', 'data', 'bible')
base = os.path.abspath(base)
FILES = ['매튜헨리.cdb', '만나주석.cdb']

def sanitize(html):
    if not html: return ''
    t = html
    def frepl(m):
        c = m.group(1)
        if c.lower() == 'black': return '<span>'
        return '<span style="color:%s">' % c
    t = re.sub(r"<font\s+color=['\"]?([#\w]+)['\"]?\s*>", frepl, t, flags=re.I)
    t = re.sub(r"</font>", "</span>", t, flags=re.I)
    t = re.sub(r"</?a\b[^>]*>", "", t, flags=re.I)
    allowed = re.compile(r"^</?(p|br|strong|b|i|em|span)\b", re.I)
    t = re.sub(r"<[^>]+>", lambda m: m.group(0) if allowed.match(m.group(0)) else '', t)
    return t.strip()

log = []
for fn in FILES:
    path = os.path.join(base, fn)
    if not os.path.exists(path):
        log.append('SKIP %s (없음)' % fn); continue
    name = os.path.splitext(fn)[0]
    con = sqlite3.connect(path); cur = con.cursor()
    rows = cur.execute("SELECT book,chapter,verse,btext FROM Bible ORDER BY book,chapter,verse").fetchall()
    books = {}
    n = 0
    for book, chap, vs, txt in rows:
        try:
            book = int(book); chap = int(chap); vs = int(vs)
        except (TypeError, ValueError):
            continue
        if not (1 <= book <= 66): continue
        books.setdefault(str(book), {}).setdefault(str(chap), []).append({'v': vs, 'html': sanitize(txt)})
        n += 1
    obj = {'type': 'commentary', 'name': name, 'books': books}
    out = os.path.join(base, name + '.comm.json')
    with io.open(out, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    sz = os.path.getsize(out)
    log.append('OK %s -> %s.comm.json  blocks=%d  size=%.1fMB' % (fn, name, n, sz/1048576.0))

io.open(os.path.join(os.path.dirname(__file__), 'convert_comm_out.txt'), 'w', encoding='utf-8').write('\n'.join(log))
print('\n'.join(log))
