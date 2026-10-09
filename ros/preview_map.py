#!/usr/bin/env python3
"""
warehouse.sdf 를 위에서 내려본 평면도 PNG 로 그린다. Gazebo 없이 지도를 확인할 때 쓴다.

  python preview_map.py        # map_preview.png 생성
"""
import os


from PIL import Image, ImageDraw, ImageFont

import gen_map as M


def load_font(size):
    """한글이 나오는 폰트를 찾는다. 없으면 기본 폰트로 떨어진다(한글은 깨짐)."""
    for path in (r"C:\Windows\Fonts\malgun.ttf",
                 "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
                 "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()

HERE = os.path.dirname(os.path.abspath(__file__))
PPM = 28                      # px per meter
PAD = 40                      # 여백 px

VIEW = (M.X_MIN - 0.4, M.X_MAX + 0.4, M.Y_MIN - 0.4, M.Y_MAX + 0.4)
W = int((VIEW[1] - VIEW[0]) * PPM) + 2 * PAD
H = int((VIEW[3] - VIEW[2]) * PPM) + 2 * PAD

BG = (247, 247, 245)
WALL = (104, 110, 118)
PART = (150, 158, 166)
RACK = (196, 128, 72)      # 파렛트 랙
ENDRACK = (176, 142, 104)  # 베이 사이 엔드랙
GRID = (226, 226, 222)
TEXT = (38, 40, 44)
EDGE = (60, 64, 70)
S7 = (176, 176, 176)
TYPE_FILL = {
    "normal": (250, 250, 250),
    "wait":   (74, 134, 232),
    "charge": (52, 168, 83),
    "load":   (242, 153, 38),
}


def px(x, y):
    """월드 좌표 -> 이미지 좌표. y 는 위가 +y 가 되도록 뒤집는다."""
    return (PAD + (x - VIEW[0]) * PPM,
            PAD + (VIEW[3] - y) * PPM)


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
F_TITLE = load_font(15)
F_NODE = load_font(14)
F_SMALL = load_font(11)

# 1m 격자
gx = int(M.X_MIN)
while gx <= M.X_MAX:
    d.line([px(gx, VIEW[2]), px(gx, VIEW[3])], fill=GRID)
    gx += 1
gy = int(M.Y_MIN)
while gy <= M.Y_MAX:
    d.line([px(VIEW[0], gy), px(VIEW[1], gy)], fill=GRID)
    gy += 1

# SDF 의 벽/칸막이 (충돌 박스가 있는 것만)
for name, bx0, bx1, by0, by1 in M.collision_boxes(
        os.path.join(HERE, "worlds", "warehouse.sdf"))[0]:
    x0, y0 = px(bx0, by1)
    x1, y1 = px(bx1, by0)
    col = WALL if name.startswith("wall_") else PART
    d.rectangle([x0, y0, x1, y1], fill=col)

# 길
for a, b in M.STAGE7_EDGES:
    pa, pb = px(*M.ALL_XY[a]), px(*M.ALL_XY[b])
    for t in range(0, 24):                        # 점선
        if t % 2:
            continue
        f0, f1 = t / 24, (t + 1) / 24
        d.line([(pa[0] + (pb[0] - pa[0]) * f0, pa[1] + (pb[1] - pa[1]) * f0),
                (pa[0] + (pb[0] - pa[0]) * f1, pa[1] + (pb[1] - pa[1]) * f1)],
               fill=S7, width=3)
for a, b in M.EDGES:
    d.line([px(*M.ALL_XY[a]), px(*M.ALL_XY[b])], fill=EDGE, width=4)

# 선반
for sid, _qr, node in M.SHELVES:
    sx, sy = M.ALL_XY[node]
    h = M.DECK / 2
    x0, y0 = px(sx - h, sy + h)
    x1, y1 = px(sx + h, sy - h)
    d.rectangle([x0, y0, x1, y1], outline=(120, 82, 44), width=3)
    d.rectangle([px(sx - 0.14, sy + 0.14), px(sx + 0.14, sy - 0.14)],
                fill=(30, 30, 30))

# 노드
R = 15
for n, x, y, t in M.NODES:
    cx, cy = px(x, y)
    fill = (22, 158, 82) if n in M.DROP_NODES else TYPE_FILL[t]
    d.ellipse([cx - R, cy - R, cx + R, cy + R],
              fill=fill, outline=(30, 32, 36), width=3)
    d.text((cx + R + 5, cy - R - 2), n, fill=TEXT, font=F_NODE)
    d.text((cx + R + 5, cy + 2), "(%g,%g)" % (x, y), fill=(120, 124, 130), font=F_SMALL)
for n, x, y, _t in M.STAGE7_NODES:
    cx, cy = px(x, y)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=S7, width=3)
    d.text((cx + R + 5, cy - R - 2), "%s (7단계)" % n, fill=S7, font=F_NODE)

# 범례
d.text((PAD, 12), "PROJECT_2 물류센터  -  %gm 격자, 원점 = F4(0,0), 단위 m  |  포드 %d개 / 자리 %d개"
       % (M.GRID, len(M.SHELVES), len(M.POD_SLOTS)),
       fill=TEXT, font=F_TITLE)
lx, ly = PAD, H - 26
for label, col in (("normal", TYPE_FILL["normal"]), ("wait", TYPE_FILL["wait"]),
                   ("charge", TYPE_FILL["charge"]), ("load", TYPE_FILL["load"]),
                   ("지정 위치", (22, 158, 82))):
    d.ellipse([lx, ly, lx + 14, ly + 14], fill=col, outline=(80, 82, 86), width=2)
    d.text((lx + 20, ly + 2), label, fill=TEXT, font=F_SMALL)
    lx += 24 + int(d.textlength(label, font=F_SMALL)) + 18

out = os.path.join(HERE, "map_preview.png")
img.save(out)
print("%s  (%dx%d)" % (os.path.relpath(out, os.path.dirname(HERE)), W, H))
