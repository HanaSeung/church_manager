"""
convert_hymn.py — 찬송가 .cmp(zip) → 이미지 추출 도구

[설명]
.cmp 파일은 내부적으로 ZIP 압축이며, 각 장의 악보가
p1.png, p2.png, ... 형태의 PNG 이미지로 들어 있습니다.
이 스크립트는 그 이미지들을 ../data/hymn/<악보집이름>/ 폴더로 풀어냅니다.

[사용법]
1) .cmp 파일이 ../bible_data/ 안에 있어야 합니다.
2) 실행:
       python convert_hymn.py 새찬송가
   (확장자 .cmp 는 빼고 이름만 적습니다)

3) 결과:
   ../data/hymn/새찬송가/p1.png ... p645.png 로 추출
   ../data/hymn/새찬송가.json  (장 번호 → 파일 매핑 목록)
"""
import os
import sys
import zipfile
import json
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "..", "bible_data")
OUT_DIR = os.path.join(HERE, "..", "data", "hymn")


def convert_one(name):
    src = os.path.join(SRC_DIR, name + ".cmp")
    if not os.path.exists(src):
        print("  [건너뜀] 파일 없음:", src)
        return False

    out_sub = os.path.join(OUT_DIR, name)
    os.makedirs(out_sub, exist_ok=True)

    z = zipfile.ZipFile(src)
    names = z.namelist()

    # p<숫자>.png 형태만 추출, 숫자 순으로 정렬
    pat = re.compile(r"^p(\d+)\.png$", re.IGNORECASE)
    items = []
    for n in names:
        m = pat.match(n)
        if m:
            items.append((int(m.group(1)), n))
    items.sort()

    count = 0
    for num, fname in items:
        data = z.read(fname)
        with open(os.path.join(out_sub, "p%d.png" % num), "wb") as f:
            f.write(data)
        count += 1
    z.close()

    # 장 번호 목록 저장 (뷰어가 읽을 수 있는 최대 장수 등)
    nums = [num for num, _ in items]
    meta = {"name": name, "count": count,
            "min": min(nums) if nums else 0,
            "max": max(nums) if nums else 0}
    with open(os.path.join(OUT_DIR, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    print("  [완료] %s → %s (%d장, 1~%d장)" % (name, out_sub, count, meta["max"]))
    update_hymnbooks_list(name)
    return True


def update_hymnbooks_list(name):
    """data/hymn/hymnbooks.json 에 악보집 이름을 추가(중복 방지)한다."""
    hpath = os.path.join(OUT_DIR, "hymnbooks.json")
    books = []
    if os.path.exists(hpath):
        try:
            with open(hpath, "r", encoding="utf-8") as f:
                books = json.load(f)
        except Exception:
            books = []
    if name not in books:
        books.append(name)
        with open(hpath, "w", encoding="utf-8") as f:
            json.dump(books, f, ensure_ascii=False)
        print("  [목록 갱신] hymnbooks.json 에 '%s' 추가" % name)


def main():
    args = sys.argv[1:]
    if not args:
        print("사용법: python convert_hymn.py <악보집이름>")
        print("예:    python convert_hymn.py 새찬송가")
        return
    for name in args:
        print("-", name)
        convert_one(name)


if __name__ == "__main__":
    main()
