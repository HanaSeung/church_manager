# -*- coding: utf-8 -*-
# 원전분해(.sdb) → JSON 변환 (개인 임포트용, 공개 저장소 제외)
# 토큰 키 축약: w=원어 c=스트롱 l=기본형 p=발음 g=문법 m=뜻
# 사용: python tools/convert_wonjeon.py
import sqlite3, json, io, os, re

base = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'bible'))
SRC = os.path.join(base, '원전분해.sdb')
OUT = os.path.join(base, '원전분해.wonjeon.json')

TOK = re.compile(r"\[([^\]]+)\]\s*\(기본\s*<([^>]+)>\s*\[([^\]]+)\]\s*([^)]*)\)@([^#]*)#\s*([^*]*)\*")

con = sqlite3.connect(SRC); cur = con.cursor()
rows = cur.execute("SELECT book,chapter,verse,btext FROM Bible ORDER BY book,chapter,verse").fetchall()
books = {}
ntok = 0
for book, chap, vs, bt in rows:
    try:
        book = int(book); chap = int(chap); vs = int(vs)
    except (TypeError, ValueError):
        continue
    if not (1 <= book <= 66): continue
    toks = []
    for m in TOK.finditer(bt or ''):
        w, c, l, p, g, mean = [x.strip() for x in m.groups()]
        toks.append({'w': w, 'c': c.lstrip('W'), 'l': l, 'p': p, 'g': g, 'm': mean})
        ntok += 1
    if toks:
        books.setdefault(str(book), {}).setdefault(str(chap), {})[str(vs)] = toks

obj = {'type': 'wonjeon', 'name': '원전분해', 'books': books}
with io.open(OUT, 'w', encoding='utf-8') as f:
    json.dump(obj, f, ensure_ascii=False)
print('books=%d tokens=%d size=%.1fMB' % (len(books), ntok, os.path.getsize(OUT)/1048576.0))
