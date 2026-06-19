# -*- coding: utf-8 -*-
"""
build_responsive.py
gyodok_raw.txt (### N. 제목 + 본문줄들) -> data/responsive/responsive.json
규칙: "(다같이)"로 시작하는 줄 = A(다 함께), 나머지는 L/C 교대(인도자/회중).
번호는 등장 순서대로 1..N 재부여. 절 표기(괄호)는 본문에 그대로 둠.
"""
import os, re, json, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, "gyodok_raw.txt")
OUT  = os.path.join(HERE, "..", "data", "responsive", "responsive.json")

HEADER = re.compile(r"^###\s*\d+\.\s*(.+?)\s*$")
DASAME = re.compile(r"^\(다같이\)\s*")

def parse(path):
    items, cur = [], None
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n").strip()
            if not line:
                continue
            m = HEADER.match(line)
            if m:
                cur = {"title": m.group(1).strip(), "lines": []}
                items.append(cur)
                continue
            if cur is None:
                continue
            cur["lines"].append(line)
    return items

def assign_roles(lines):
    out, toggle = [], 0  # 0 -> L, 1 -> C
    for ln in lines:
        if DASAME.match(ln):
            t = DASAME.sub("", ln).strip()
            out.append({"r": "A", "t": t})
        else:
            out.append({"r": "L" if toggle == 0 else "C", "t": ln})
            toggle ^= 1
    return out

def main():
    items = parse(SRC)
    data = {"title": "교독문", "items": []}
    for i, it in enumerate(items, start=1):
        data["items"].append({
            "no": i,
            "title": it["title"],
            "ref": "",
            "lines": assign_roles(it["lines"]),
        })

    # 백업 후 저장
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = OUT.replace(".json", "_backup_%s.json" % ts)
        with open(OUT, "r", encoding="utf-8") as a, open(bak, "w", encoding="utf-8") as b:
            b.write(a.read())
        print("backup:", os.path.basename(bak))

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    n = len(data["items"])
    print("total:", n)
    print("first:", data["items"][0]["no"], data["items"][0]["title"])
    print("last:", data["items"][-1]["no"], data["items"][-1]["title"])
    # 번호 연속성 체크
    nums = [x["no"] for x in data["items"]]
    gaps = [k for k in range(1, n + 1) if k not in nums]
    print("missing nums:", gaps if gaps else "none")
    # 샘플 점검
    for idx in (0, 87, 136):
        if idx < n:
            it = data["items"][idx]
            roles = "".join(l["r"] for l in it["lines"])
            print("no %d [%s] lines=%d roles=%s" % (it["no"], it["title"], len(it["lines"]), roles))

if __name__ == "__main__":
    main()
