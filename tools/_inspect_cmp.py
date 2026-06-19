# -*- coding: utf-8 -*-
import zipfile, re, collections, os

src = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "bible_data", "새찬송가.cmp")
z = zipfile.ZipFile(src)
names = z.namelist()
print("총 항목 수:", len(names))

ext = collections.Counter(
    (n.rsplit('.', 1)[-1].lower() if '.' in n else '(none)') for n in names)
print("확장자별 개수:", dict(ext))

pat = re.compile(r"^p(\d+)\.png$", re.IGNORECASE)
png_nums = sorted(int(pat.match(n).group(1)) for n in names if pat.match(n))
print("p#.png 개수:", len(png_nums),
      "범위:", (png_nums[0], png_nums[-1]) if png_nums else None)

# p#.png 패턴에 안 맞는 나머지 항목 = 교독문/색인 등 후보
others = [n for n in names if not pat.match(n)]
print("기타(p#.png 아닌) 항목 수:", len(others))
for n in others[:60]:
    print("   ", n)
