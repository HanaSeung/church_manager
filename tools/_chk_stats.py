import re, io, sys
src = io.open(r'D:\MyApp\church_manager\stats.html', encoding='utf-8').read()
m = re.search(r'<script type="module">(.*?)</script>', src, re.S)
if not m:
    print('NO SCRIPT'); sys.exit(1)
js = m.group(1)
io.open(r'D:\MyApp\church_manager\tools\_chk_stats.mjs', 'w', encoding='utf-8').write(js)
print('EXTRACTED', len(js), 'chars')
