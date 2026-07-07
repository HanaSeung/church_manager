import re, io, sys
html = io.open(r'D:\MyApp\church_manager\offering.html', encoding='utf-8').read()
m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
if not m:
    print('NO_MODULE_SCRIPT'); sys.exit(1)
io.open(r'D:\MyApp\church_manager\tools\_chk_offering.mjs', 'w', encoding='utf-8').write(m.group(1))
print('EXTRACTED', len(m.group(1)), 'chars')
