"""
convert_bible.py — 성경 .bdb(SQLite) → JSON 변환 도구

[사용법]
1) 변환할 역본의 .bdb 파일이 ../bible_data/ 안에 있어야 합니다.
2) 아래 명령으로 실행합니다.

   특정 역본만 변환:
       python convert_bible.py 개역개정
   (확장자 .bdb 는 빼고 파일 이름만 적습니다)

   bible_data 안의 모든 .bdb 를 한 번에 변환:
       python convert_bible.py --all

3) 결과 JSON 은 ../data/bible/<역본이름>.json 에 생성됩니다.

[출력 JSON 구조]
{
  "version": "개역개정",
  "books": [
    { "no": 1, "name": "창세기", "abbr": "창",
      "chapters": [ ["1절 본문", "2절 본문", ...], ["..."], ... ] },
    ...
  ]
}
"""
import os
import sys
import sqlite3
import json

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "..", "bible_data")
OUT_DIR = os.path.join(HERE, "..", "data", "bible")

BOOKS = [
    (1, "창세기", "창"), (2, "출애굽기", "출"), (3, "레위기", "레"),
    (4, "민수기", "민"), (5, "신명기", "신"), (6, "여호수아", "수"),
    (7, "사사기", "삿"), (8, "룻기", "룻"), (9, "사무엘상", "삼상"),
    (10, "사무엘하", "삼하"), (11, "열왕기상", "왕상"), (12, "열왕기하", "왕하"),
    (13, "역대상", "대상"), (14, "역대하", "대하"), (15, "에스라", "스"),
    (16, "느헤미야", "느"), (17, "에스더", "에"), (18, "욥기", "욥"),
    (19, "시편", "시"), (20, "잠언", "잠"), (21, "전도서", "전"),
    (22, "아가", "아"), (23, "이사야", "사"), (24, "예레미야", "렘"),
    (25, "예레미야애가", "애"), (26, "에스겔", "겔"), (27, "다니엘", "단"),
    (28, "호세아", "호"), (29, "요엘", "욜"), (30, "아모스", "암"),
    (31, "오바댜", "옵"), (32, "요나", "욘"), (33, "미가", "미"),
    (34, "나훔", "나"), (35, "하박국", "합"), (36, "스바냐", "습"),
    (37, "학개", "학"), (38, "스가랴", "슥"), (39, "말라기", "말"),
    (40, "마태복음", "마"), (41, "마가복음", "막"), (42, "누가복음", "눅"),
    (43, "요한복음", "요"), (44, "사도행전", "행"), (45, "로마서", "롬"),
    (46, "고린도전서", "고전"), (47, "고린도후서", "고후"), (48, "갈라디아서", "갈"),
    (49, "에베소서", "엡"), (50, "빌립보서", "빌"), (51, "골로새서", "골"),
    (52, "데살로니가전서", "살전"), (53, "데살로니가후서", "살후"), (54, "디모데전서", "딤전"),
    (55, "디모데후서", "딤후"), (56, "디도서", "딛"), (57, "빌레몬서", "몬"),
    (58, "히브리서", "히"), (59, "야고보서", "약"), (60, "베드로전서", "벧전"),
    (61, "베드로후서", "벧후"), (62, "요한일서", "요일"), (63, "요한이서", "요이"),
    (64, "요한삼서", "요삼"), (65, "유다서", "유"), (66, "요한계시록", "계"),
]


def convert_one(version):
    src = os.path.join(SRC_DIR, version + ".bdb")
    if not os.path.exists(src):
        print("  [건너뜀] 파일 없음:", src)
        return False

    con = sqlite3.connect(src)
    cur = con.cursor()
    try:
        rows = cur.execute(
            "SELECT book, chapter, verse, btext FROM Bible ORDER BY book, chapter, verse"
        ).fetchall()
    except sqlite3.OperationalError as e:
        print("  [오류] Bible 테이블을 읽을 수 없음:", version, e)
        con.close()
        return False
    con.close()

    name_map = {no: (name, abbr) for no, name, abbr in BOOKS}
    bucket = {}
    for book, chapter, verse, btext in rows:
        bucket.setdefault(book, {}).setdefault(chapter, {})[verse] = (btext or "").strip()

    books_out = []
    for no in sorted(bucket.keys()):
        name, abbr = name_map.get(no, ("책%d" % no, str(no)))
        chapters_out = []
        for ch in sorted(bucket[no].keys()):
            verses = bucket[no][ch]
            chapters_out.append([verses[v] for v in sorted(verses.keys())])
        books_out.append({"no": no, "name": name, "abbr": abbr, "chapters": chapters_out})

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, version + ".json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"version": version, "books": books_out}, f, ensure_ascii=False)
    print("  [완료] %s → %s (%d권)" % (version, out_path, len(books_out)))
    update_versions_list(version)
    return True


def update_versions_list(version):
    """data/bible/versions.json 에 역본 이름을 추가(중복 방지)한다."""
    vpath = os.path.join(OUT_DIR, "versions.json")
    versions = []
    if os.path.exists(vpath):
        try:
            with open(vpath, "r", encoding="utf-8") as f:
                versions = json.load(f)
        except Exception:
            versions = []
    if version not in versions:
        versions.append(version)
        with open(vpath, "w", encoding="utf-8") as f:
            json.dump(versions, f, ensure_ascii=False)
        print("  [목록 갱신] versions.json 에 '%s' 추가" % version)


def main():
    args = sys.argv[1:]
    if not args:
        print("사용법: python convert_bible.py <역본이름>")
        print("       python convert_bible.py --all")
        return

    if args[0] == "--all":
        files = [f for f in os.listdir(SRC_DIR) if f.endswith(".bdb")]
        print("총 %d개 역본 변환 시작" % len(files))
        ok = 0
        for f in files:
            version = f[:-4]
            print("-", version)
            if convert_one(version):
                ok += 1
        print("변환 완료: %d / %d" % (ok, len(files)))
    else:
        for version in args:
            print("-", version)
            convert_one(version)


if __name__ == "__main__":
    main()
