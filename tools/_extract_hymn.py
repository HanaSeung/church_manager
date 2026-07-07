import re, io
p = r'D:\MyApp\church_manager\hymn.html'
s = io.open(p, encoding='utf-8').read()
blocks = re.findall(r'<script type="module">(.*?)</script>', s, re.S)
if not blocks:
    blocks = re.findall(r'<script>(.*?)</script>', s, re.S)
io.open(r'D:\MyApp\church_manager\tools\_chk_hymn.mjs', 'w', encoding='utf-8').write('\n'.join(blocks))
print('hymn.html ->', len(blocks), 'block(s),', sum(len(b) for b in blocks), 'chars')
print('div_open', s.count('<div'), 'div_close', s.count('</div>'))
print('style_open', s.count('<style'), 'style_close', s.count('</style>'))
print('script_open', s.count('<script'), 'script_close', s.count('</script>'))
for k in ['rspacer','navgroup','justify-self:end','grid-template-columns:1fr auto 1fr']:
    print(k, '=>', s.count(k))
