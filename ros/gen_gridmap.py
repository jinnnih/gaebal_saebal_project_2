#!/usr/bin/env python3
"""
warehouse.sdf 의 고정 구조물에서 Nav2 점유 격자(pgm + yaml)를 바로 만든다.

보통은 SLAM 을 돌려 뽑지만 이 월드는 우리가 생성한 것이라 기하에서 정확히 뽑을 수
있다. 그러면 계획서 8장 리스크의 "SLAM 지도와 노드 좌표계가 어긋남" 이 아예 생기지
않고, 나중에 진짜 SLAM 을 돌릴 때 비교할 정답지가 된다.

  python gen_gridmap.py      # maps/warehouse.pgm + maps/warehouse.yaml

선반은 <include> 로 들어오는 움직이는 물체라 격자에 넣지 않는다. 정적 지도에는
영구 구조물만 들어가야 한다.
"""
import os

import gen_map as M

HERE = os.path.dirname(os.path.abspath(__file__))

RES = 0.05           # m/px. config.map_resolution 과 같은 값이어야 한다
MARGIN = 0.3         # 외벽 바깥 여백 (m)

# ROS map_server 가 쓰는 값
FREE = 254
UNKNOWN = 205
OCCUPIED = 0


def build():
    boxes, _names = M.collision_boxes(os.path.join(HERE, "worlds", "warehouse.sdf"))

    # 외벽을 포함한 전체 범위 + 여백
    x0 = M.X_MIN - M.WALL_T - MARGIN
    x1 = M.X_MAX + M.WALL_T + MARGIN
    y0 = M.Y_MIN - M.WALL_T - MARGIN
    y1 = M.Y_MAX + M.WALL_T + MARGIN

    w = int(round((x1 - x0) / RES))
    h = int(round((y1 - y0) / RES))

    # 셀 하나하나 판정. 4만 셀 수준이라 그냥 돌려도 된다.
    # 이미지 0행 = 지도 위쪽(y 최대). yaml 의 origin 은 왼쪽 아래 모서리다.
    rows = []
    for r in range(h):
        wy = y0 + (h - r - 0.5) * RES
        row = bytearray(w)
        for c in range(w):
            wx = x0 + (c + 0.5) * RES
            hit = False
            for _n, bx0, bx1, by0, by1 in boxes:
                if bx0 <= wx <= bx1 and by0 <= wy <= by1:
                    hit = True
                    break
            if hit:
                row[c] = OCCUPIED
            elif M.X_MIN <= wx <= M.X_MAX and M.Y_MIN <= wy <= M.Y_MAX:
                row[c] = FREE          # 창고 내부
            else:
                row[c] = UNKNOWN       # 건물 바깥은 미지 영역
        rows.append(bytes(row))

    return rows, w, h, x0, y0


def write_pgm(path, rows, w, h):
    with open(path, "wb") as f:
        f.write(b"P5\n")
        f.write(b"# PROJECT_2 warehouse - gen_gridmap.py generated from warehouse.sdf\n")
        f.write(("%d %d\n255\n" % (w, h)).encode())
        for row in rows:
            f.write(row)


# free_thresh 는 0.196 이어야 한다. 0.25 로 두면 미지값 205 가
# (255-205)/255 = 0.19608 < 0.25 로 계산되어 전부 자유 공간으로 들어간다.
# 0.196 이 ROS 의 기본값인 이유가 정확히 이 경계 때문이다.
FREE_THRESH = 0.196

YAML = """# PROJECT_2 노드형 관제 시스템 - 점유 격자
# gen_gridmap.py 생성물. warehouse.sdf 의 고정 구조물에서 뽑았다.
# resolution 과 origin 은 config 테이블의 map_resolution / map_origin_x,y 와 맞춰라.
#
# free_thresh 를 0.25 로 올리지 마라. 미지값 205 가 (255-205)/255 = 0.19608 이라
# 0.25 보다 작아져서 창고 바깥까지 전부 자유 공간이 된다.
image: warehouse.pgm
mode: trinary
resolution: %g
origin: [%g, %g, 0.0]
negate: 0
occupied_thresh: 0.65
free_thresh: %g
"""


def main():
    out = os.path.join(HERE, "maps")
    os.makedirs(out, exist_ok=True)

    rows, w, h, ox, oy = build()

    pgm = os.path.join(out, "warehouse.pgm")
    write_pgm(pgm, rows, w, h)

    yml = os.path.join(out, "warehouse.yaml")
    with open(yml, "w", encoding="utf-8") as f:
        f.write(YAML % (RES, ox, oy, FREE_THRESH))

    occ = sum(r.count(OCCUPIED) for r in rows)
    free = sum(r.count(FREE) for r in rows)
    unk = sum(r.count(UNKNOWN) for r in rows)
    print("maps/warehouse.pgm   %d x %d px  (%.1f x %.1f m @ %g m/px)"
          % (w, h, w * RES, h * RES, RES))
    print("maps/warehouse.yaml  origin = [%g, %g, 0.0]" % (ox, oy))
    print("셀: 점유 %d / 자유 %d / 미지 %d  (합 %d)" % (occ, free, unk, occ + free + unk))

    # 검증 - 모든 노드가 자유 셀 위에 있어야 하고, 로봇 폭만큼 여유가 있어야 한다
    bad = []
    half = int(round((0.5 / 2) / RES))      # 로봇 폭 0.5m 의 절반
    for n, x, y, _t in M.NODES + M.STAGE7_NODES:
        c = int((x - ox) / RES)
        r = h - 1 - int((y - oy) / RES)
        for dr in range(-half, half + 1):
            for dc in range(-half, half + 1):
                rr, cc = r + dr, c + dc
                if not (0 <= rr < h and 0 <= cc < w) or rows[rr][cc] != FREE:
                    bad.append(n)
                    break
            if bad and bad[-1] == n:
                break
    if bad:
        print("FAIL  자유 공간이 아닌 노드: %s" % sorted(set(bad)))
        return 1
    print("ok    노드 %d개 전부 자유 셀 위, 로봇 폭 0.5m 여유 확보"
          % len(M.NODES + M.STAGE7_NODES))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
