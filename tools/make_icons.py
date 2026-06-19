# -*- coding: utf-8 -*-
# PWA 아이콘 생성기 (icon-192.png, icon-512.png)
# 녹색 테마 #2f6f4f, 흰색 교회 심볼. 4배 슈퍼샘플링 후 축소(안티에일리어싱).
import os
from PIL import Image, ImageDraw

GREEN = (47, 111, 79)      # #2f6f4f
WHITE = (255, 255, 255)
CREAM = (245, 246, 244)    # #f5f6f4 (살짝 따뜻한 흰색)

def make(size):
    N = size * 4                      # 슈퍼샘플 캔버스
    img = Image.new("RGB", (N, N), GREEN)
    d = ImageDraw.Draw(img)

    def f(v):                         # 비율 -> 픽셀
        return v * N

    cx = 0.5 * N

    # 건물 본체
    body = [f(0.345), f(0.520), f(0.655), f(0.760)]
    d.rectangle(body, fill=CREAM)

    # 지붕(삼각형)
    roof = [(f(0.5), f(0.360)), (f(0.300), f(0.535)), (f(0.700), f(0.535))]
    d.polygon(roof, fill=CREAM)

    # 첨탑 십자가
    vbar_w = f(0.030)
    d.rectangle([cx - vbar_w, f(0.150), cx + vbar_w, f(0.330)], fill=CREAM)  # 세로
    hbar_h = f(0.030)
    d.rectangle([f(0.435), f(0.205) - hbar_h, f(0.565), f(0.205) + hbar_h], fill=CREAM)  # 가로

    # 출입문 (아치형, 녹색으로 도려내기)
    dx0, dx1 = f(0.455), f(0.545)
    dy_top, dy_bot = f(0.610), f(0.760)
    d.rectangle([dx0, dy_top, dx1, dy_bot], fill=GREEN)
    d.ellipse([dx0, dy_top - (dx1 - dx0) / 2, dx1, dy_top + (dx1 - dx0) / 2], fill=GREEN)

    # 좌우 작은 창문
    w = f(0.028)
    for wx in (f(0.408), f(0.592)):
        d.rectangle([wx - w, f(0.585), wx + w, f(0.660)], fill=GREEN)

    return img.resize((size, size), Image.LANCZOS)

def main():
    out = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 프로젝트 루트
    for s in (192, 512):
        p = os.path.join(out, "icon-%d.png" % s)
        make(s).save(p, "PNG")
        print("saved:", p)

if __name__ == "__main__":
    main()
