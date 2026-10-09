#!/usr/bin/env python3
"""
평면도 하나에서 Gazebo 월드와 DB seed 를 같이 생성한다.

좌표계는 계획서 4장 결정대로 미터, 지도 원점 기준이고 원점은 노드 F4 이다.
월드와 seed.sql 이 같은 평면도에서 나오므로 둘이 어긋날 수 없다.

  python gen_map.py     # worlds/warehouse.sdf, db/seed.sql 재생성

창고 모양
  물류센터 배치다. 가운데에 포드 블록 4개가 있고 그 사이로 통로가 지나간다.
  북서 모서리에 사무동, 동쪽 벽에 피킹 스테이션 2개와 충전 뱅크 2개,
  북/남 벽에 입고/출고 도크가 붙는다.

  로봇은 포드 밑으로 들어가 들어올려 피킹 스테이션(지정 위치)에 내려놓는다.
"""
import os
from math import hypot

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NL = "\n"

# ---------------------------------------------------------------------------
# 평면도 - 이 파일의 유일한 진실
# ---------------------------------------------------------------------------
#   .  통로 노드 (normal)
#   P  포드 자리 (load)        블록 안. 2칸 깊이라 어느 칸이든 통로에 바로 닿는다
#   K  피킹 스테이션 (load)    포드를 내려놓는 지정 위치. 비어 있어야 한다
#   C  충전 (charge)
#   W  대기 (wait)             피킹 스테이션 앞 대기열
#   #  구조물 (노드 없음)      사무동
#
#        A  B  C  D  E  F  G  H  I  J  K
LAYOUT = [
    "##.........",   # 1  입고 도크 통로
    "##PPP.PPPWK",   # 2  포드 블록 상단 / 대기 / 피킹1
    "..PPP.PPPWK",   # 3                      / 피킹2
    "...........",   # 4  중앙 통로 (원점 행)
    "..PPP.PPP..",   # 5  포드 블록 하단
    "..PPP.PPP.C",   # 6                      / 충전1
    "..........C",   # 7  출고 도크 통로      / 충전2
]
GRID = 2.5                      # 노드 간격
COLS = "ABCDEFGHIJK"
ORIGIN_COL, ORIGIN_ROW = 5, 3   # 이 칸이 (0,0) = 노드 F4

TYPE_OF = {".": "normal", "P": "load", "K": "load", "C": "charge", "W": "wait"}

# 포드를 비워 둘 자리. 실제 창고도 꽉 차 있지는 않다.
POD_EMPTY = {"D2", "I3", "C5", "H5", "E6", "G6"}

# 7단계 데모용. 바닥은 열려 있지만 seed 에는 넣지 않는다.
# 포드 블록 사이 중앙 세로 통로(F열)를 노드 지도에 아직 안 이어 둔 상태다.
# 웹에서 이어 주면 남북 지름길이 바로 생긴다.
STAGE7_EDGES = [("F2", "F3"), ("F3", "F4"), ("F4", "F5"), ("F5", "F6")]
STAGE7_NODES = []


def cell_name(c, r):
    return "%s%d" % (COLS[c], r + 1)


def cell_xy(c, r):
    return ((c - ORIGIN_COL) * GRID, (ORIGIN_ROW - r) * GRID)


def _build_nodes():
    out = []
    for r, line in enumerate(LAYOUT):
        for c, ch in enumerate(line):
            if ch == "#":
                continue
            x, y = cell_xy(c, r)
            out.append((cell_name(c, r), x, y, TYPE_OF[ch]))
    return out


def _cells_of(sym):
    return [cell_name(c, r)
            for r, line in enumerate(LAYOUT)
            for c, ch in enumerate(line) if ch == sym]


NODES = _build_nodes()
ALL_XY = {n: (x, y) for n, x, y, _ in NODES}

DROP_NODES = _cells_of("K")                       # 지정 위치 (피킹 스테이션)
CHARGE_NODES = _cells_of("C")
WAIT_NODES = _cells_of("W")
POD_SLOTS = _cells_of("P")                        # 포드가 놓일 수 있는 자리
POD_NODES = [n for n in POD_SLOTS if n not in POD_EMPTY]

# 포드: (id, qr_code, 놓인 노드)
SHELVES = [("S%d" % (i + 1), "POD-S%d" % (i + 1), n)
           for i, n in enumerate(POD_NODES)]


def grid_edges():
    """격자에서 한 칸 떨어진 이웃끼리 길을 만든다. 7단계용은 빼 둔다."""
    skip = {tuple(sorted(e)) for e in STAGE7_EDGES}
    pos = {n: ALL_XY[n] for n, _x, _y, _t in NODES}
    names = list(pos)
    out = []
    for i, a in enumerate(names):
        ax, ay = pos[a]
        for b in names[i + 1:]:
            bx, by = pos[b]
            step = (abs(ax - bx) == GRID and ay == by) or \
                   (abs(ay - by) == GRID and ax == bx)
            if step and tuple(sorted((a, b))) not in skip:
                out.append((a, b))
    return out


EDGES = grid_edges()

# ---------------------------------------------------------------------------
# 창고 치수 (m)
# ---------------------------------------------------------------------------
N_COL, N_ROW = len(LAYOUT[0]), len(LAYOUT)
MARGIN = 2.5                                      # 노드 격자 바깥 여백
X_MIN = cell_xy(0, 0)[0] - MARGIN
X_MAX = cell_xy(N_COL - 1, 0)[0] + MARGIN
Y_MAX = cell_xy(0, 0)[1] + MARGIN
Y_MIN = cell_xy(0, N_ROW - 1)[1] - MARGIN
WALL_T = 0.25
WALL_H = 3.2

OFFICE_H = 2.8
STATION_H = 1.05
CHARGER_H = 1.30
COLUMN = 0.36
COLUMN_H = 3.2

# 색
WALL_RGBA = "0.87 0.87 0.84 1"
OFFICE_RGBA = "0.80 0.81 0.83 1"
OFFICE_GLASS = "0.35 0.47 0.56 1"
STATION_RGBA = "0.72 0.74 0.76 1"
STATION_TOP = "0.30 0.33 0.36 1"
CHARGER_RGBA = "0.22 0.45 0.30 1"
COLUMN_RGBA = "0.56 0.57 0.58 1"
DOCK_DARK = "0.20 0.22 0.25 1"
LINE_YELLOW = "0.93 0.76 0.10 1"
BLOCK_FLOOR = "0.33 0.34 0.36 1"
AISLE_LINE = "0.62 0.62 0.60 1"
DROP_GREEN = "0.16 0.62 0.32 1"

POD_DECK = "0.88 0.40 0.08 1"
POD_STEEL = "0.45 0.47 0.50 1"
POD_LEG = "0.26 0.28 0.31 1"
CARTONS = ("0.74 0.60 0.42 1", "0.80 0.67 0.49 1", "0.68 0.55 0.38 1")

NODE_TYPE_RGBA = {
    "normal": "0.78 0.78 0.76 1",
    "wait":   "0.20 0.45 0.88 1",
    "charge": "0.15 0.65 0.32 1",
    "load":   "0.95 0.58 0.12 1",
}


def dist(a, b):
    (ax, ay), (bx, by) = ALL_XY[a], ALL_XY[b]
    return round(hypot(bx - ax, by - ay), 3)


def collision_boxes(sdf_path):
    """월드 SDF 에서 고정 구조물의 충돌 박스를 뽑는다.

    돌려주는 값: ([(이름, x0, x1, y0, y1), ...], [모델 이름, ...])

    pod_ 로 시작하는 모델은 로봇이 들어 옮기는 포드라서 뺀다.
    정적 지도와 그래프 검사에는 영구 구조물만 들어가야 한다.
    """
    import xml.etree.ElementTree as ET

    world = ET.parse(sdf_path).getroot().find("world")
    boxes, names = [], []
    for model in world.findall("model"):
        name = model.get("name")
        names.append(name)
        if name.startswith("pod_"):
            continue
        mp = (model.findtext("pose") or "0 0 0 0 0 0").split()
        mx, my = float(mp[0]), float(mp[1])
        for coll in model.findall("./link/collision"):
            sz = coll.find("./geometry/box/size")
            if sz is None:
                continue
            sx, sy, _sz = [float(v) for v in sz.text.split()]
            cp = (coll.findtext("pose") or "0 0 0 0 0 0").split()
            cx, cy = mx + float(cp[0]), my + float(cp[1])
            boxes.append((name, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2))
    return boxes, names


# ---------------------------------------------------------------------------
# SDF 조각
# ---------------------------------------------------------------------------
def _box(sx, sy, sz):
    return "<box><size>%g %g %g</size></box>" % (sx, sy, sz)


def _material(rgba):
    return ("<material>"
            "\n            <ambient>%s</ambient>"
            "\n            <diffuse>%s</diffuse>"
            "\n            <specular>0.1 0.1 0.1 1</specular>"
            "\n          </material>" % (rgba, rgba))


def static_model(name, collisions, visuals):
    """정적 모델 하나. collisions / visuals 는 (cx,cy,cz,geo,rgba) 목록."""
    parts = []
    for i, (cx, cy, cz, geo, _r) in enumerate(collisions):
        parts.append(
            '\n        <collision name="c%d">'
            '\n          <pose>%g %g %g 0 0 0</pose>'
            '\n          <geometry>%s</geometry>'
            '\n        </collision>' % (i, cx, cy, cz, geo))
    for i, (cx, cy, cz, geo, rgba) in enumerate(visuals):
        parts.append(
            '\n        <visual name="v%d">'
            '\n          <pose>%g %g %g 0 0 0</pose>'
            '\n          <geometry>%s</geometry>'
            '\n          %s'
            '\n        </visual>' % (i, cx, cy, cz, geo, _material(rgba)))
    return ('\n    <model name="%s">'
            '\n      <static>true</static>'
            '\n      <link name="l">%s'
            '\n      </link>'
            '\n    </model>' % (name, "".join(parts)))


def solid(name, cx, cy, sx, sy, sz, rgba, extra_vis=()):
    b = (cx, cy, sz / 2, _box(sx, sy, sz), rgba)
    return static_model(name, [b], [b] + list(extra_vis))


def paint(name, marks):
    """바닥 도색. 충돌 없음 - 로봇이 밟고 지나간다. marks: (cx,cy,sx,sy,rgba)"""
    return static_model(name, [], [
        (cx, cy, 0.006, _box(sx, sy, 0.012), rgba) for cx, cy, sx, sy, rgba in marks])


def border(cx, cy, sx, sy, w, rgba):
    return [(cx, cy + sy / 2, sx, w, rgba), (cx, cy - sy / 2, sx, w, rgba),
            (cx - sx / 2, cy, w, sy, rgba), (cx + sx / 2, cy, w, sy, rgba)]


def pod_blocks():
    """평면도에서 P 가 붙어 있는 덩어리를 찾아 (x0,x1,y0,y1) 로 돌려준다."""
    seen, blocks = set(), []
    for r, line in enumerate(LAYOUT):
        for c, ch in enumerate(line):
            if ch != "P" or (c, r) in seen:
                continue
            stack, cells = [(c, r)], []
            seen.add((c, r))
            while stack:
                cc, rr = stack.pop()
                cells.append((cc, rr))
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nc, nr = cc + dc, rr + dr
                    if (0 <= nr < N_ROW and 0 <= nc < N_COL
                            and LAYOUT[nr][nc] == "P" and (nc, nr) not in seen):
                        seen.add((nc, nr))
                        stack.append((nc, nr))
            xs = [cell_xy(cc, rr)[0] for cc, rr in cells]
            ys = [cell_xy(cc, rr)[1] for cc, rr in cells]
            blocks.append((min(xs), max(xs), min(ys), max(ys)))
    return blocks


# ---------------------------------------------------------------------------
# 포드 (움직이는 선반)
# ---------------------------------------------------------------------------
DECK = 1.00
DECK_T = 0.06
LEG = 0.08
LEG_H = 0.42         # 바닥 ~ 데크 밑면 = 로봇이 들어갈 높이
LEG_OFF = 0.42       # 다리 중심의 축 거리 -> 안쪽 통과 폭 0.76m
MARK = 0.60
POD_MASS = 9.0
POD_LEVELS = (0.52, 1.02)
POD_TOP = LEG_H + POD_LEVELS[-1] + 0.12


def pod_model(sid, qr_png, x, y):
    """월드에 인라인으로 들어가는 포드. static 이 아니라 들어올릴 수 있다."""
    import random
    rnd = random.Random(int(sid[1:]) * 977)
    legs = ((1, 1), (1, -1), (-1, 1), (-1, -1))

    v = [(sx * LEG_OFF, sy * LEG_OFF, LEG_H / 2, _box(LEG, LEG, LEG_H), POD_LEG)
         for sx, sy in legs]
    v.append((0, 0, LEG_H + DECK_T / 2, _box(DECK, DECK, DECK_T), POD_DECK))
    v += [(sx * LEG_OFF, sy * LEG_OFF, (LEG_H + POD_TOP) / 2,
           _box(LEG, LEG, POD_TOP - LEG_H), POD_STEEL) for sx, sy in legs]
    for z in POD_LEVELS:
        v.append((0, 0, LEG_H + z, _box(DECK, DECK, 0.04), POD_STEEL))
        for sx in (-1, 1):
            h = rnd.choice((0.26, 0.34, 0.40))
            v.append((sx * 0.22, 0, LEG_H + z + 0.02 + h / 2,
                      _box(0.38, 0.70, h), rnd.choice(CARTONS)))

    vis = "".join(
        '\n        <visual name="v%d">'
        '\n          <pose>%g %g %g 0 0 0</pose>'
        '\n          <geometry>%s</geometry>'
        '\n          %s'
        '\n        </visual>' % (i, a, b, c, g, _material(r))
        for i, (a, b, c, g, r) in enumerate(v))

    coll = "".join(
        '\n        <collision name="leg_%d">'
        '\n          <pose>%g %g %g 0 0 0</pose>'
        '\n          <geometry>%s</geometry>'
        '\n          <surface>'
        '\n            <friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction>'
        '\n          </surface>'
        '\n        </collision>'
        % (i, sx * LEG_OFF, sy * LEG_OFF, LEG_H / 2, _box(LEG, LEG, LEG_H))
        for i, (sx, sy) in enumerate(legs))
    coll += ('\n        <collision name="deck">'
             '\n          <pose>0 0 %g 0 0 0</pose>'
             '\n          <geometry>%s</geometry>'
             '\n        </collision>' % (LEG_H + DECK_T / 2, _box(DECK, DECK, DECK_T)))

    ixx = POD_MASS / 12.0 * (DECK ** 2 + POD_TOP ** 2)
    izz = POD_MASS / 12.0 * (2 * DECK ** 2)

    return (
        '\n    <!-- 포드 %s. 들어올려야 하므로 static 이 아니다. 주행 중 미끄러짐은'
        '\n         계획서 9장대로 lift 때 로봇 링크에 detachable_joint 로 붙여 막는다. -->'
        '\n    <model name="pod_%s">'
        '\n      <static>false</static>'
        '\n      <pose>%g %g 0 0 0 0</pose>'
        '\n      <link name="body">'
        '\n        <inertial>'
        '\n          <pose>0 0 %g 0 0 0</pose>'
        '\n          <mass>%g</mass>'
        '\n          <inertia>'
        '\n            <ixx>%.4f</ixx><iyy>%.4f</iyy><izz>%.4f</izz>'
        '\n            <ixy>0</ixy><ixz>0</ixz><iyz>0</iyz>'
        '\n          </inertia>'
        '\n        </inertial>'
        '%s%s'
        '\n        <!-- 데크 밑면 마커판. 로봇의 위를 보는 카메라가 이걸 읽는다.'
        '\n             QR 이 불안정하면 albedo_map 을 aruco_%s.png 로 바꾸면 된다.'
        '\n             서버 쪽은 바뀌는 게 없다 (계획서 9장). -->'
        '\n        <visual name="marker">'
        '\n          <pose>0 0 %g 0 0 0</pose>'
        '\n          <geometry>%s</geometry>'
        '\n          <material>'
        '\n            <ambient>1 1 1 1</ambient>'
        '\n            <diffuse>1 1 1 1</diffuse>'
        '\n            <pbr>'
        '\n              <metal>'
        '\n                <albedo_map>model://pod_markers/materials/textures/%s</albedo_map>'
        '\n                <metalness>0.0</metalness>'
        '\n                <roughness>0.9</roughness>'
        '\n              </metal>'
        '\n            </pbr>'
        '\n          </material>'
        '\n        </visual>'
        '\n      </link>'
        '\n    </model>'
    ) % (sid, sid.lower(), x, y, POD_TOP / 2, POD_MASS, ixx, ixx, izz,
         coll, vis, sid, LEG_H - 0.002, _box(MARK, MARK, 0.004), qr_png)


# ---------------------------------------------------------------------------
# 월드
# ---------------------------------------------------------------------------
def build_world():
    parts, lights, pods = [], [], []
    ow = (X_MAX - X_MIN) + 2 * WALL_T
    oh = (Y_MAX - Y_MIN) + 2 * WALL_T
    cy_mid = (Y_MIN + Y_MAX) / 2.0

    # 둘레 벽
    for nm, cx, cy, sx, sy in (
            ("wall_north", 0, Y_MAX + WALL_T / 2, ow, WALL_T),
            ("wall_south", 0, Y_MIN - WALL_T / 2, ow, WALL_T),
            ("wall_west", X_MIN - WALL_T / 2, cy_mid, WALL_T, oh),
            ("wall_east", X_MAX + WALL_T / 2, cy_mid, WALL_T, oh)):
        parts.append(solid(nm, cx, cy, sx, sy, WALL_H, WALL_RGBA))

    # 사무동 - 평면도의 # 덩어리. 바닥이 직사각형이 아니게 만드는 구조물이다.
    off = [(c, r) for r, line in enumerate(LAYOUT)
           for c, ch in enumerate(line) if ch == "#"]
    if off:
        xs = [cell_xy(c, r)[0] for c, r in off]
        ys = [cell_xy(c, r)[1] for c, r in off]
        ox0, ox1 = min(xs) - GRID / 2, max(xs) + GRID / 2
        oy0, oy1 = min(ys) - GRID / 2, max(ys) + GRID / 2
        ocx, ocy = (ox0 + ox1) / 2, (oy0 + oy1) / 2
        osx, osy = ox1 - ox0, oy1 - oy0
        parts.append(solid("office", ocx, ocy, osx, osy, OFFICE_H, OFFICE_RGBA, [
            # 통로 쪽 두 면에 창
            (ocx, oy0 + 0.04, 1.75, _box(osx * 0.8, 0.08, 0.9), OFFICE_GLASS),
            (ox1 - 0.04, ocy, 1.75, _box(0.08, osy * 0.8, 0.9), OFFICE_GLASS),
        ]))

    # 포드 블록 바닥 도색 - 보관 구역임을 나타낸다
    marks = []
    for bx0, bx1, by0, by1 in pod_blocks():
        w, h = (bx1 - bx0) + GRID * 0.9, (by1 - by0) + GRID * 0.9
        cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
        marks.append((cx, cy, w, h, BLOCK_FLOOR))
        marks += border(cx, cy, w, h, 0.10, LINE_YELLOW)
    parts.append(paint("block_floor", marks))

    # 통로 중심선
    lane = []
    for r, line in enumerate(LAYOUT):
        if set(line) <= {".", "#"}:                        # 통째로 통로인 행
            lane.append((0, cell_xy(0, r)[1], X_MAX - X_MIN - 1.0, 0.07, AISLE_LINE))
    parts.append(paint("aisle_lines", lane))

    # 노드 바닥 마커
    for n, x, y, t in NODES:
        m = []
        if n in DROP_NODES:
            m.append((x, y, 2.0, 2.0, "0.84 0.88 0.84 1"))
            m += border(x, y, 2.0, 2.0, 0.12, DROP_GREEN)
            m.append((x, y, 1.1, 1.1, DROP_GREEN))
        elif t == "charge":
            m += border(x, y, 2.0, 2.0, 0.12, LINE_YELLOW)
            m.append((x, y, 1.0, 1.0, NODE_TYPE_RGBA[t]))
        elif t == "wait":
            m += border(x, y, 1.5, 1.5, 0.10, NODE_TYPE_RGBA[t])
        elif t == "load":
            m.append((x, y, 1.3, 1.3, NODE_TYPE_RGBA[t]))
        else:
            m.append((x, y, 0.45, 0.45, NODE_TYPE_RGBA[t]))
        parts.append(paint("mark_%s" % n, m))

    # 피킹 스테이션 - 지정 위치 바로 옆 동쪽 벽에 붙은 작업대
    for i, n in enumerate(DROP_NODES):
        _x, y = ALL_XY[n]
        sx = X_MAX - 0.95
        parts.append(solid("pick_station_%d" % i, sx, y, 1.5, 2.1,
                           STATION_H, STATION_RGBA, [
            (sx, y, STATION_H + 0.03, _box(1.6, 2.2, 0.06), STATION_TOP),
            (sx - 0.1, y, STATION_H + 0.5, _box(0.08, 1.2, 0.9), STATION_TOP),
        ]))

    # 충전기 - 충전 노드 옆 동쪽 벽에 붙은 함
    for i, n in enumerate(CHARGE_NODES):
        _x, y = ALL_XY[n]
        sx = X_MAX - 0.55
        parts.append(solid("charger_%d" % i, sx, y, 0.7, 1.3,
                           CHARGER_H, CHARGER_RGBA))

    # 구조 기둥 - 격자 모서리에 둔다. 격자와 어긋나 있어 길을 막지 않는다.
    for i, (cc, rr) in enumerate(((2, 0), (5, 0), (2, 5), (5, 5), (8, 2), (8, 5))):
        cx = cell_xy(cc, rr)[0] + GRID / 2
        cy = cell_xy(cc, rr)[1] - GRID / 2
        parts.append(solid("column_%d" % i, cx, cy, COLUMN, COLUMN,
                           COLUMN_H, COLUMN_RGBA))

    # 도크 도어 - 북쪽 입고, 남쪽 출고
    for i, dx in enumerate((-2.5, 2.5)):
        parts.append(static_model("dock_in_%d" % i, [], [
            (dx, Y_MAX - 0.03, 1.25, _box(3.0, 0.06, 2.4), DOCK_DARK)]))
    for i, dx in enumerate((2.5, 7.5)):
        parts.append(static_model("dock_out_%d" % i, [], [
            (dx, Y_MIN + 0.03, 1.25, _box(3.0, 0.06, 2.4), DOCK_DARK)]))

    # 조명 - 광원만. 발광 박스를 띄우면 위에서 볼 때 흰 막대가 바닥을 가로지른다.
    for i, (lx, ly) in enumerate(((-8, 4), (0, 4), (8, 4),
                                  (-8, -4), (0, -4), (8, -4))):
        lights.append(
            '\n    <light type="point" name="bay_light_%d">'
            '\n      <pose>%g %g 3.0 0 0 0</pose>'
            '\n      <diffuse>0.20 0.20 0.19 1</diffuse>'
            '\n      <specular>0.1 0.1 0.1 1</specular>'
            '\n      <attenuation>'
            '\n        <range>18</range><constant>0.4</constant>'
            '\n        <linear>0.05</linear><quadratic>0.004</quadratic>'
            '\n      </attenuation>'
            '\n      <cast_shadows>false</cast_shadows>'
            '\n    </light>' % (i, lx, ly))

    # 포드
    for sid, qr, node in SHELVES:
        x, y = ALL_XY[node]
        pods.append(pod_model(sid, "qr_%s.png" % sid, x, y))

    plan = NL.join("  %s   %s" % ("".join(l), "") for l in LAYOUT)
    header = (
        '<?xml version="1.0" ?>\n'
        '<!--\n'
        '  PROJECT_2 노드형 관제 시스템 - Gazebo 월드 (물류센터)\n'
        '  gen_map.py 가 생성한 파일이다. 직접 고치지 말고 gen_map.py 의 평면도를 고쳐라.\n'
        '\n'
        '  좌표계: 미터, 원점 = 노드 F4 = (0,0). seed.sql 의 node.x / node.y 와 같은 기준.\n'
        '  내부 범위: x [%g, %g], y [%g, %g]  (%g x %g m), %gm 격자\n'
        '\n'
        '  평면도 (A~K 가로, 1~7 세로)\n'
        '%s\n'
        '    .=통로  P=포드자리  K=피킹(지정위치)  C=충전  W=대기  #=사무동\n'
        '\n'
        '  포드 %d개가 블록 4개에 나뉘어 놓여 있다. 블록은 2칸 깊이라\n'
        '  어느 포드든 바로 옆이 통로여서 들고 빠져나올 수 있다.\n'
        '\n'
        '  pod_ 로 시작하는 모델은 로봇이 옮기는 포드라 정적 지도에 넣지 않는다.\n'
        '\n'
        '  로봇 스폰 권장 위치 (충전 노드)\n'
        '    1호기: x=%g  y=%g  yaw=3.14159\n'
        '    2호기: x=%g  y=%g  yaw=3.14159\n'
        '-->\n' % (X_MIN, X_MAX, Y_MIN, Y_MAX, X_MAX - X_MIN, Y_MAX - Y_MIN, GRID,
                   plan, len(SHELVES),
                   ALL_XY[CHARGE_NODES[0]][0], ALL_XY[CHARGE_NODES[0]][1],
                   ALL_XY[CHARGE_NODES[1]][0], ALL_XY[CHARGE_NODES[1]][1])
    )

    body = """<sdf version="1.10">
  <world name="warehouse">

    <physics name="1ms" type="ignored">
      <max_step_size>0.001</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>

    <plugin filename="gz-sim-physics-system"
            name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-user-commands-system"
            name="gz::sim::systems::UserCommands"/>
    <plugin filename="gz-sim-scene-broadcaster-system"
            name="gz::sim::systems::SceneBroadcaster"/>
    <plugin filename="gz-sim-sensors-system"
            name="gz::sim::systems::Sensors">
      <render_engine>ogre2</render_engine>
    </plugin>
    <plugin filename="gz-sim-imu-system"
            name="gz::sim::systems::Imu"/>
    <plugin filename="gz-sim-contact-system"
            name="gz::sim::systems::Contact"/>

    <!-- 열자마자 창고 전체가 보이도록 시작 카메라를 비스듬히 위에서 내려보게 둔다.
         engine 태그를 비워 두었으므로 gz sim 의 render-engine-gui 옵션으로
         바꿀 수 있다. VMware 의 SVGA3D 에서는 ogre2 가 화면을 깜빡이니 ogre 를 써라.
         (XML 주석 안에는 연속된 붙임표를 넣을 수 없어서 옵션명을 풀어 적었다.) -->
    <gui fullscreen="0">
      <plugin filename="MinimalScene" name="3D View">
        <gz-gui>
          <title>3D View</title>
          <property type="bool" key="showTitleBar">false</property>
          <property type="string" key="state">docked</property>
        </gz-gui>
        <scene>scene</scene>
        <ambient_light>0.35 0.35 0.35</ambient_light>
        <background_color>0.74 0.79 0.84</background_color>
        <camera_pose>0 -16 20 0 0.900 1.5708</camera_pose>
      </plugin>

      <!-- 아래 셋은 기능만 하는 플러그인이라 화면을 먹지 않게 작은 위젯으로 띄운다. -->
      <plugin filename="GzSceneManager" name="Scene Manager">
        <gz-gui>
          <property key="resizable" type="bool">false</property>
          <property key="width" type="double">5</property>
          <property key="height" type="double">5</property>
          <property key="state" type="string">floating</property>
          <property key="showTitleBar" type="bool">false</property>
        </gz-gui>
      </plugin>
      <plugin filename="InteractiveViewControl" name="Scene control">
        <gz-gui>
          <property key="resizable" type="bool">false</property>
          <property key="width" type="double">5</property>
          <property key="height" type="double">5</property>
          <property key="state" type="string">floating</property>
          <property key="showTitleBar" type="bool">false</property>
        </gz-gui>
      </plugin>
      <plugin filename="CameraTracking" name="Camera Tracking">
        <gz-gui>
          <property key="resizable" type="bool">false</property>
          <property key="width" type="double">5</property>
          <property key="height" type="double">5</property>
          <property key="state" type="string">floating</property>
          <property key="showTitleBar" type="bool">false</property>
        </gz-gui>
      </plugin>
      <plugin filename="WorldControl" name="World control">
        <gz-gui>
          <property type="bool" key="showTitleBar">false</property>
          <property type="string" key="state">floating</property>
          <property type="double" key="width">121</property>
          <property type="double" key="height">72</property>
          <property type="double" key="z">1</property>
          <anchors target="3D View">
            <line own="left" target="left"/>
            <line own="bottom" target="bottom"/>
          </anchors>
        </gz-gui>
        <play_pause>true</play_pause>
        <step>true</step>
        <start_paused>false</start_paused>
      </plugin>
      <plugin filename="WorldStats" name="World stats">
        <gz-gui>
          <property type="bool" key="showTitleBar">false</property>
          <property type="string" key="state">floating</property>
          <property type="double" key="width">290</property>
          <property type="double" key="height">110</property>
          <property type="double" key="z">1</property>
          <anchors target="3D View">
            <line own="right" target="right"/>
            <line own="bottom" target="bottom"/>
          </anchors>
        </gz-gui>
        <sim_time>true</sim_time>
        <real_time>true</real_time>
        <real_time_factor>true</real_time_factor>
      </plugin>
    </gui>

    <gravity>0 0 -9.8</gravity>

    <scene>
      <ambient>0.35 0.35 0.35 1</ambient>
      <background>0.74 0.79 0.84 1</background>
      <shadows>true</shadows>
      <grid>false</grid>
    </scene>

    <light type="directional" name="sun">
      <pose>0 0 10 0 0 0</pose>
      <cast_shadows>true</cast_shadows>
      <diffuse>0.55 0.55 0.53 1</diffuse>
      <specular>0.15 0.15 0.15 1</specular>
      <direction>-0.4 0.3 -0.9</direction>
      <attenuation>
        <range>80</range>
        <constant>0.9</constant>
        <linear>0.01</linear>
        <quadratic>0.001</quadratic>
      </attenuation>
    </light>

    <model name="ground">
      <static>true</static>
      <link name="l">
        <collision name="c">
          <geometry><plane><normal>0 0 1</normal><size>90 90</size></plane></geometry>
          <surface>
            <friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction>
          </surface>
        </collision>
        <visual name="v">
          <geometry><plane><normal>0 0 1</normal><size>90 90</size></plane></geometry>
          <material>
            <ambient>0.40 0.41 0.42 1</ambient>
            <diffuse>0.50 0.51 0.52 1</diffuse>
            <specular>0.03 0.03 0.03 1</specular>
          </material>
        </visual>
      </link>
    </model>
"""

    tail = "\n\n  </world>\n</sdf>\n"
    return header + body + "".join(lights) + "".join(parts) + "".join(pods) + tail


# ---------------------------------------------------------------------------
# seed.sql
# ---------------------------------------------------------------------------
def build_seed():
    nrows = ",\n".join("  ('%s', %g, %g, '%s')" % (n, x, y, t) for n, x, y, t in NODES)
    erows = ",\n".join(
        "  ((SELECT id FROM node WHERE name='%s'),\n"
        "   (SELECT id FROM node WHERE name='%s'), 'both', %g)" % (a, b, dist(a, b))
        for a, b in EDGES)
    srows = ",\n".join(
        "--   ('%s', (SELECT id FROM node WHERE name='%s'), NULL)" % (qr, nd)
        for _sid, qr, nd in SHELVES)
    s7e = NL.join("--   %s - %s  (거리 %g)" % (a, b, dist(a, b)) for a, b in STAGE7_EDGES)
    plan = NL.join("--     " + l for l in LAYOUT)

    return """-- PROJECT_2 노드형 관제 시스템 - 초기 지도 데이터
-- gen_map.py 생성물. 직접 고치지 말고 gen_map.py 의 평면도를 고쳐라.
-- 좌표는 미터, 원점 = 노드 F4 = (0,0). sim/worlds/warehouse.sdf 와 같은 기준이다.
--
-- 평면도 (A~K 가로, 1~7 세로)
%s
--     .=통로  P=포드자리  K=피킹(지정위치)  C=충전  W=대기  #=사무동

START TRANSACTION;

DELETE FROM edge;
DELETE FROM node;
ALTER TABLE node AUTO_INCREMENT = 1;
ALTER TABLE edge AUTO_INCREMENT = 1;

-- 노드 (%d개). %gm 격자
--   지정 위치 %s 는 포드를 내려놓을 자리라 비어 있어야 한다.
--   외길은 두지 않았다. 어느 노드가 막혀도 격자로 우회할 수 있다.
INSERT INTO node (name, x, y, type) VALUES
%s;

-- 길 (%d개) - 격자 이웃끼리 모두 양방향. 거리는 좌표에서 계산한 값
INSERT INTO edge (from_node, to_node, direction, distance) VALUES
%s;

-- 설정값 (계획서 4장 + 9장 결정 사항)
INSERT INTO config (`key`, `value`) VALUES
  ('battery_charge_threshold', '40'),
  ('battery_charge_target',    '80'),
  ('node_lock_timeout_sec',    '60'),
  ('robot_max_speed',          '0.7'),
  ('map_origin_x',             '0'),
  ('map_origin_y',             '0'),
  ('map_resolution',           '0.05')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

-- 로봇 2대. namespace 는 ROS 쪽 토픽 접두사와 같아야 한다.
INSERT INTO robot (name, adapter, namespace) VALUES
  ('robot1', 'mock', '/robot1'),
  ('robot2', 'mock', '/robot2')
ON DUPLICATE KEY UPDATE adapter = VALUES(adapter);

COMMIT;

-- 포드 %d개 (9단계). shelf 테이블이 생긴 뒤에 주석을 풀어라.
-- INSERT INTO shelf (qr_code, node_id, carried_by) VALUES
%s;

-- -------------------------------------------------------------------------
-- 7단계 데모용으로 일부러 비워 둔 길
--   포드 블록 사이 중앙 세로 통로(F열)를 노드 지도에 아직 안 이어 뒀다.
--   바닥은 열려 있으니 웹 편집 화면에서 이어 주면 남북 지름길이 바로 생긴다.
%s
--
--   노드 추가 데모는 따로 자리를 비워 둘 필요가 없다. 통로가 열려 있어서
--   아무 빈 자리나 찍고 길을 이으면 된다.
-- -------------------------------------------------------------------------
""" % (plan, len(NODES), GRID, " ".join(DROP_NODES), nrows, len(EDGES), erows,
       len(SHELVES), srows, s7e)


def main():
    os.makedirs(os.path.join(HERE, "worlds"), exist_ok=True)
    db = os.path.join(ROOT, "db")
    os.makedirs(db, exist_ok=True)

    wp = os.path.join(HERE, "worlds", "warehouse.sdf")
    with open(wp, "w", encoding="utf-8") as f:
        f.write(build_world())
    print("world  ", os.path.relpath(wp, ROOT), "(%d KB)" % (os.path.getsize(wp) // 1024))
    print("pods   ", "%d개 / 자리 %d개" % (len(SHELVES), len(POD_SLOTS)))

    sp = os.path.join(db, "seed.sql")
    with open(sp, "w", encoding="utf-8") as f:
        f.write(build_seed())
    print("seed   ", os.path.relpath(sp, ROOT),
          "(노드 %d, 길 %d)" % (len(NODES), len(EDGES)))


if __name__ == "__main__":
    main()
