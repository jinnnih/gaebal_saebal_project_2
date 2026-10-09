#!/usr/bin/env python3
"""
생성한 월드와 노드 표가 서로 맞는지 검사한다.

  python check_map.py

보는 것
  1. warehouse.sdf 가 올바른 XML 이고 모델 이름이 유일한지
  2. 모든 노드가 벽에 박혀 있지 않은지
  3. seed 에 넣은 모든 길이 로봇 폭만큼 열려 있는지
  4. 7단계에서 추가할 길도 바닥이 미리 열려 있는지
  5. 그래프가 전부 이어져 있는지
  6. 외길이 없는지 - 노드 하나가 막혀도 우회로가 있는지
  7. 포드를 든 로봇이 보관 구역에서 지정 위치까지 갈 수 있는지
     (계획서 9장: 선반을 든 로봇은 선반 있는 노드를 못 지나간다)
  8. seed.sql 의 좌표가 노드 표와 일치하는지
"""
import os
import sys
from collections import defaultdict, deque

import gen_map as M

HERE = os.path.dirname(os.path.abspath(__file__))
ROBOT_W = 0.6        # 로봇 폭. 이 폭이 지나갈 수 있어야 길로 인정한다.
CLEAR = 0.02

fails = []


def fail(msg):
    fails.append(msg)
    print("  FAIL  " + msg)


def ok(msg):
    print("  ok    " + msg)


# ---------------------------------------------------------------------------
print("1. SDF 파싱")
wp = os.path.join(HERE, "worlds", "warehouse.sdf")
try:
    boxes, model_names = M.collision_boxes(wp)
except Exception as e:                                   # noqa: BLE001
    print("  FAIL  파싱 실패: %s" % e)
    sys.exit(1)
ok("warehouse.sdf 파싱 성공")

if len(model_names) != len(set(model_names)):
    dup = sorted({n for n in model_names if model_names.count(n) > 1})
    fail("월드 안에 같은 이름의 모델이 있다: %s" % dup)
else:
    ok("모델 이름 %d개 전부 유일" % len(model_names))
ok("충돌 박스 %d개 (둘레 벽만 - 내부는 열린 바닥)" % len(boxes))


def blocked(x0, x1, y0, y1):
    return [n for n, bx0, bx1, by0, by1 in boxes
            if x0 < bx1 and bx0 < x1 and y0 < by1 and by0 < y1]


# ---------------------------------------------------------------------------
print("\n2. 노드 위치")
bad = []
for n, x, y, _t in M.NODES + M.STAGE7_NODES:
    h = ROBOT_W / 2 + CLEAR
    if blocked(x - h, x + h, y - h, y + h):
        bad.append(n)
if bad:
    fail("벽에 겹치는 노드: %s" % bad)
else:
    ok("노드 %d개 모두 로봇 폭 여유 확보" % len(M.NODES + M.STAGE7_NODES))


# ---------------------------------------------------------------------------
def corridor_clear(a, b):
    (ax, ay), (bx, by) = M.ALL_XY[a], M.ALL_XY[b]
    h = ROBOT_W / 2 + CLEAR
    if abs(ax - bx) < 1e-9:
        return blocked(ax - h, ax + h, min(ay, by), max(ay, by))
    if abs(ay - by) < 1e-9:
        return blocked(min(ax, bx), max(ax, bx), ay - h, ay + h)
    return ["비격자 대각선 길은 검사하지 않음"]


print("\n3. seed 에 들어가는 길 %d개" % len(M.EDGES))
nblocked = 0
for a, b in M.EDGES:
    hit = corridor_clear(a, b)
    if hit:
        fail("길 %s-%s 가 막혀 있다: %s" % (a, b, sorted(set(hit))))
        nblocked += 1
if not nblocked:
    ok("%d개 전부 열림 (각 %gm)" % (len(M.EDGES), M.GRID))

print("\n4. 7단계에서 추가할 길 %d개 (바닥이 미리 열려 있어야 한다)" % len(M.STAGE7_EDGES))
for a, b in M.STAGE7_EDGES:
    hit = corridor_clear(a, b)
    if hit:
        fail("7단계 길 %s-%s 가 막혀 있다: %s" % (a, b, sorted(set(hit))))
    else:
        ok("%-3s - %-3s  열림 (거리 %g) - seed 에는 없음" % (a, b, M.dist(a, b)))


# ---------------------------------------------------------------------------
adj = defaultdict(set)
for a, b in M.EDGES:
    adj[a].add(b)
    adj[b].add(a)
NAMES = [n for n, _x, _y, _t in M.NODES]


def reach(start, banned=()):
    seen, q = {start}, deque([start])
    while q:
        cur = q.popleft()
        for nxt in adj[cur]:
            if nxt in seen or nxt in banned:
                continue
            seen.add(nxt)
            q.append(nxt)
    return seen


print("\n5. 연결성")
r = reach(NAMES[0])
if len(r) != len(NAMES):
    fail("끊긴 노드: %s" % sorted(set(NAMES) - r))
else:
    ok("노드 %d개가 전부 이어져 있다 (길 %d개)" % (len(NAMES), len(M.EDGES)))

iso = [n for n in NAMES if not adj[n]]
if iso:
    fail("길이 하나도 없는 노드: %s" % iso)

print("\n6. 외길 없음 - 노드 하나가 막혀도 우회로가 있는지")
cut = []
for n in NAMES:
    rest = [m for m in NAMES if m != n]
    if not rest:
        continue
    got = reach(rest[0], banned={n})
    missing = set(rest) - got
    if missing:
        cut.append((n, sorted(missing)))
if cut:
    for n, missing in cut:
        fail("%s 가 막히면 %s 에 못 간다 (외길 지점)" % (n, missing))
else:
    ok("어느 노드가 막혀도 나머지가 전부 연결된다 - 외길 없음")

print("\n7. 포드를 든 로봇의 경로 (포드 있는 노드는 못 지나간다)")
pod_nodes = {node for _sid, _qr, node in M.SHELVES}
ok("포드 위치: %s" % sorted(pod_nodes))
ok("지정 위치: %s" % M.DROP_NODES)
for sid, _qr, start in M.SHELVES:
    others = pod_nodes - {start}
    got = reach(start, banned=others)
    for drop in M.DROP_NODES:
        if drop not in got:
            fail("%s(%s) 를 들고 %s 까지 갈 수 없다 - 다른 포드에 막힌다"
                 % (sid, start, drop))
    if all(d in got for d in M.DROP_NODES):
        ok("%s(%s) -> %s  다른 포드를 피해 도달 가능"
           % (sid, start, ", ".join(M.DROP_NODES)))

for d in M.DROP_NODES:
    if d in pod_nodes:
        fail("지정 위치 %s 에 이미 포드가 있다" % d)
    t = dict((n, t) for n, _x, _y, t in M.NODES)[d]
    if t != "load":
        fail("지정 위치 %s 의 type 이 load 가 아니다 (%s)" % (d, t))


# ---------------------------------------------------------------------------
print("\n8. seed.sql 과 좌표 일치")
sp = os.path.join(os.path.dirname(HERE), "db", "seed.sql")
sql = open(sp, encoding="utf-8").read()
head = sql.split("-- 7단계")[0]
miss = [n for n, x, y, t in M.NODES
        if "('%s', %g, %g, '%s')" % (n, x, y, t) not in sql]
if miss:
    fail("seed.sql 에 없는 노드: %s" % miss)
else:
    ok("노드 %d개 좌표가 seed.sql 과 일치" % len(M.NODES))
for n, _x, _y, _t in M.STAGE7_NODES:
    if ("'%s'" % n) in head:
        fail("7단계용 노드 %s 가 seed 본문에 들어가 있다" % n)

print("\n" + "=" * 60)
print("FAIL %d" % len(fails))
sys.exit(1 if fails else 0)
