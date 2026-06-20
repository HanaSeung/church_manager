import re, io
for name in ['chat.html', 'index.html']:
    s = io.open(r'D:\MyApp\church_manager\\' + name, encoding='utf-8').read()
    blocks = re.findall(r'<script type="module">(.*?)</script>', s, re.S)
    out = r'D:\MyApp\church_manager\tools\_chk_' + name.replace('.html', '') + '.mjs'
    io.open(out, 'w', encoding='utf-8').write('\n'.join(blocks))
    print(name, '->', len(blocks), 'module block(s),', sum(len(b) for b in blocks), 'chars')
