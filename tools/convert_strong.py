# -*- coding: utf-8 -*-
"""
convert_strong.py — 원어(스트롱) 데이터 변환 도구

[하는 일]
1) 개역개정S.sdb (스트롱 태깅 성경) → data/bible/개역개정S.json
   - 기존 convert_bible.py 와 동일 구조. 단, 단어 뒤 <WH####>/<WG####> 코드를 '보존'.
   - versions.json 에 "개역개정S" 추가.
2) HebGrkKo.dct (한글 원어사전) → data/bible/lexicon_ko.json
   - Lexicon(scode, dtext) → { "G25": "뜻...", "H3068": "뜻..." } 맵.
   - 개인용: .gitignore 로 공개 저장소 제외 대상.

[사용법]
   python convert_strong.py
"""
import os, sqlite3, json

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "..", "bible_data")
OUT_DIR = os.path.join(HERE, "..", "data", "bible")

BOOKS = [
    (1,"창세기","창"),(2,"출애굽기","출"),(3,"레위기","레"),(4,"민수기","민"),(5,"신명기","신"),
    (6,"여호수아","수"),(7,"사사기","삿"),(8,"룻기","룻"),(9,"사무엘상","삼상"),(10,"사무엘하","삼하"),
    (11,"열왕기상","왕상"),(12,"열왕기하","왕하"),(13,"역대상","대상"),(14,"역대하","대하"),(15,"에스라","스"),
    (16,"느헤미야","느"),(17,"에스더","에"),(18,"욥기","욥"),(19,"시편","시"),(20,"잠언","잠"),
    (21,"전도서","전"),(22,"아가","아"),(23,"이사야","사"),(24,"예레미야","렘"),(25,"예레미야애가","애"),
    (26,"에스겔","겔"),(27,"다니엘","단"),(28,"호세아","호"),(29,"요엘","욜"),(30,"아모스","암"),
    (31,"오바댜","옵"),(32,"요나","욘"),(33,"미가","미"),(34,"나훔","나"),(35,"하박국","합"),
    (36,"스바냐","습"),(37,"학개","학"),(38,"스가랴","슥"),(39,"말라기","말"),(40,"마태복음","마"),
    (41,"마가복음","막"),(42,"누가복음","눅"),(43,"요한복음","요"),(44,"사도행전","행"),(45,"로마서","롬"),
    (46,"고린도전서","고전"),(47,"고린도후서","고후"),(48,"갈라디아서","갈"),(49,"에베소서","엡"),(50,"빌립보서","빌"),
    (51,"골로새서","골"),(52,"데살로니가전서","살전"),(53,"데살로니가후서","살후"),(54,"디모데전서","딤전"),(55,"디모데후서","딤후"),
    (56,"디도서","딛"),(57,"빌레몬서","몬"),(58,"히브리서","히"),(59,"야고보서","약"),(60,"베드로전서","벧전"),
    (61,"베드로후서","벧후"),(62,"요한일서","요일"),(63,"요한이서","요이"),(64,"요한삼서","요삼"),(65,"유다서","유"),(66,"요한계시록","계"),
]

def convert_strong_bible(srcname="개역개정S", outname="개역개정S"):
    src = os.path.join(SRC_DIR, srcname + ".sdb")
    con = sqlite3.connect(src); cur = con.cursor()
    rows = cur.execute("SELECT book, chapter, verse, btext FROM Bible ORDER BY book, chapter, verse").fetchall()
    con.close()
    name_map = {no:(n,a) for no,n,a in BOOKS}
    bucket = {}
    skipped = 0
    for book, ch, v, bt in rows:
        try:
            book, ch, v = int(book), int(ch), int(v)
        except (ValueError, TypeError):
            skipped += 1; continue
        if not (1 <= book <= 66):
            skipped += 1; continue
        bucket.setdefault(book, {}).setdefault(ch, {})[v] = (bt or "").strip()  # 코드 보존
    if skipped:
        print("  [주의] 비정상 행 %d개 건너뜀" % skipped)
    books_out = []
    for no in sorted(bucket):
        name, abbr = name_map.get(no, ("책%d"%no, str(no)))
        chapters = [[bucket[no][ch][v] for v in sorted(bucket[no][ch])] for ch in sorted(bucket[no])]
        books_out.append({"no":no,"name":name,"abbr":abbr,"chapters":chapters})
    os.makedirs(OUT_DIR, exist_ok=True)
    outp = os.path.join(OUT_DIR, outname + ".json")
    json.dump({"version":outname,"books":books_out}, open(outp,"w",encoding="utf-8"), ensure_ascii=False)
    # versions.json 갱신
    vpath = os.path.join(OUT_DIR, "versions.json")
    versions = json.load(open(vpath,encoding="utf-8")) if os.path.exists(vpath) else []
    if outname not in versions:
        versions.append(outname); json.dump(versions, open(vpath,"w",encoding="utf-8"), ensure_ascii=False)
    print("  [완료] %s → %s (%d권), versions.json 갱신" % (srcname, outp, len(books_out)))

def convert_lexicon(srcname="HebGrkKo", outname="lexicon_ko"):
    src = os.path.join(OUT_DIR, srcname + ".dct")
    con = sqlite3.connect(src); cur = con.cursor()
    rows = cur.execute("SELECT scode, dtext FROM Lexicon").fetchall()
    con.close()
    lex = {code: txt for code, txt in rows if code}
    outp = os.path.join(OUT_DIR, outname + ".json")
    json.dump(lex, open(outp,"w",encoding="utf-8"), ensure_ascii=False)
    print("  [완료] %s → %s (%d개 항목)" % (srcname, outp, len(lex)))

if __name__ == "__main__":
    print("- 성경(스트롱) 변환")
    convert_strong_bible()
    print("- 원어사전 변환")
    convert_lexicon()
    print("끝.")
