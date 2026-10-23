#!/usr/bin/env python3
"""
로봇 모델이 포드와 지도에 맞는지 검사한다.

  python3 check_robot.py

보는 것
  1. xacro 가 돌아가고 결과가 올바른 URDF 인지
  2. 링크/관절이 하나의 트리로 이어지는지 (떠 있는 링크가 없는지)
  3. 전폭이 포드 다리 사이로 들어가는지
  4. 리프트를 내렸을 때 포드 데크 밑면 아래로 지나갈 수 있는지
  5. 리프트를 올렸을 때 포드 다리가 바닥에서 뜨는지
  6. 로봇이 통로에서 회전할 수 있는지 (회전 반경 대 격자 간격)
  7. 위를 보는 카메라 화각에 포드 마커가 들어오는지
  8. 스폰 위치가 실제 노드 좌표와 맞는지
"""
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from math import atan2, cos, hypot, sin, tan

import gen_map as M

HERE = os.path.dirname(os.path.abspath(__file__))
XACRO = os.path.join(HERE, "description", "pod_bot.urdf.xacro")

fails = []


def fail(msg):
    fails.append(msg)
    print("  FAIL  " + msg)


def ok(msg):
    print("  ok    " + msg)


# ---------------------------------------------------------------------------
print("1. xacro -> URDF")
try:
    urdf = subprocess.run(["xacro", XACRO, "ns:=robot1"],
                          check=True, capture_output=True, text=True).stdout
except FileNotFoundError:
    print("  FAIL  xacro 가 없다. source /opt/ros/jazzy/setup.bash 했는지 확인해라.")
    sys.exit(1)
except subprocess.CalledProcessError as e:
    print("  FAIL  xacro 실패:\n" + e.stderr[-2000:])
    sys.exit(1)

try:
    root = ET.fromstring(urdf)
except ET.ParseError as e:
    print("  FAIL  URDF 가 올바른 XML 이 아니다: %s" % e)
    sys.exit(1)
ok("xacro 통과, URDF %d bytes" % len(urdf))

links = {l.get("name") for l in root.findall("link")}
joints = root.findall("joint")
ok("링크 %d개, 관절 %d개" % (len(links), len(joints)))

# 네임스페이스가 토픽에 박혔는지
if "/robot1/scan" not in urdf or "/robot1/cmd_vel" not in urdf:
    fail("ns 인자가 토픽 이름에 반영되지 않았다")
else:
    ok("ns 인자가 토픽에 반영됨 (/robot1/scan, /robot1/cmd_vel)")


# ---------------------------------------------------------------------------
print("\n2. 링크 트리")
child_of = {}
for j in joints:
    p = j.find("parent").get("link")
    c = j.find("child").get("link")
    child_of[c] = p
roots = [l for l in links if l not in child_of]
if len(roots) != 1:
    fail("뿌리 링크가 %d개다 (떠 있는 링크가 있다): %s" % (len(roots), sorted(roots)))
else:
    ok("뿌리 링크 하나: %s" % roots[0])
unknown = [c for c in child_of if c not in links] + \
          [p for p in child_of.values() if p not in links]
if unknown:
    fail("정의되지 않은 링크를 참조한다: %s" % sorted(set(unknown)))


def xyz_of(joint_name):
    for j in joints:
        if j.get("name") == joint_name:
            o = j.find("origin")
            if o is None or o.get("xyz") is None:
                return (0.0, 0.0, 0.0)
            return tuple(float(v) for v in o.get("xyz").split())
    return None


def limit_of(joint_name):
    for j in joints:
        if j.get("name") == joint_name:
            lim = j.find("limit")
            if lim is None:
                return None
            return float(lim.get("lower")), float(lim.get("upper"))
    return None


def box_of(link_name):
    for l in root.findall("link"):
        if l.get("name") != link_name:
            continue
        b = l.find("./collision/geometry/box")
        if b is not None:
            return tuple(float(v) for v in b.get("size").split())
    return None


# 본체 치수
base = box_of("base_link")
if base is None:
    fail("base_link 에 박스 충돌이 없다")
    print("\nFAIL %d" % len(fails))
    sys.exit(1)
base_l, base_w, base_h = base
base_z = xyz_of("base_joint")[2]
wheel_y = abs(xyz_of("wheel_left_joint")[1])
track = 2 * wheel_y
# 바퀴 두께는 cylinder 라 박스로 안 잡힌다. 모델에서 직접 읽는다.
WHEEL_T = 0.04
for _l in root.findall("link"):
    if _l.get("name") == "wheel_left_link":
        _c = _l.find("./collision/geometry/cylinder")
        if _c is not None:
            WHEEL_T = float(_c.get("length"))
width = max(base_w, track + WHEEL_T)

lift_lo, lift_hi = limit_of("lift_joint")
lift_z0 = base_z + xyz_of("lift_joint")[2]          # 내렸을 때 판 중심
# 판 두께는 모델에서 읽는다 (하드코딩하면 치수를 바꿀 때 조용히 틀어진다)
lift_box = box_of("lift_link")
lift_t = lift_box[2] if lift_box else 0.04
top_down = lift_z0 + lift_t / 2                     # 내렸을 때 로봇 최고점
top_up = top_down + lift_hi

print("\n3~5. 포드와의 치수 관계")
ok("로봇 전폭 %.3f m (본체 %.2f, 윤거 %.2f)" % (width, base_w, track))
ok("리프트 내림 최고점 %.3f m / 올림 %.3f m (행정 %.2f)" % (top_down, top_up, lift_hi))
ok("포드: 다리 사이 %.3f m, 데크 밑면 %.3f m, 마커 %.2f m"
   % (M.LEG_OFF * 2 - M.LEG, M.LEG_H, M.MARK))

gap = M.LEG_OFF * 2 - M.LEG
if width + 0.05 > gap:
    fail("전폭 %.3f 가 포드 다리 사이 %.3f 에 여유 있게 안 들어간다" % (width, gap))
else:
    ok("포드 밑으로 들어간다 (여유 좌우 %.3f m)" % ((gap - width) / 2))

if top_down + 0.03 > M.LEG_H:
    fail("리프트를 내려도 최고점 %.3f 가 데크 밑면 %.3f 에 걸린다" % (top_down, M.LEG_H))
else:
    ok("리프트 내리면 데크 밑을 지나간다 (여유 %.3f m)" % (M.LEG_H - top_down))

raise_by = top_up - M.LEG_H
if raise_by < 0.03:
    fail("리프트를 올려도 포드가 %.3f m 밖에 안 뜬다 (0.03 이상 필요)" % raise_by)
else:
    ok("리프트 올리면 포드 다리가 %.3f m 뜬다" % raise_by)


# ---------------------------------------------------------------------------
print("\n6. 통로에서 회전")
turn_r = hypot(base_l / 2, width / 2)      # 제자리 회전 시 외접 반경
ok("제자리 회전 외접 반경 %.3f m, 격자 간격 %.2f m" % (turn_r, M.GRID))
if 2 * turn_r > M.GRID:
    fail("회전 지름 %.3f 가 격자 간격 %.2f 보다 크다 - 통로에서 못 돈다"
         % (2 * turn_r, M.GRID))
else:
    ok("통로 한 칸 안에서 제자리 회전 가능")

# 포드가 놓인 노드 사이를 포드를 들고 지나갈 수 있나
# (포드 데크 1.0m 를 들고 격자 간격 2.5m 통로를 지난다)
if M.DECK + 0.3 > M.GRID:
    fail("포드 데크 %.2f 를 들고 격자 간격 %.2f 통로를 지나기 빠듯하다"
         % (M.DECK, M.GRID))
else:
    ok("포드(%.2f m)를 들고 통로를 지날 여유 %.2f m" % (M.DECK, M.GRID - M.DECK))


# ---------------------------------------------------------------------------
print("\n7. 위를 보는 카메라")
cam_z = base_z + xyz_of("pod_cam_joint")[2]
fov = None
for s in root.iter("sensor"):
    if s.get("type") == "camera":
        h = s.find("./camera/horizontal_fov")
        if h is not None:
            fov = float(h.text)
if fov is None:
    fail("카메라 센서에 horizontal_fov 가 없다")
else:
    d = M.LEG_H - cam_z
    seen = 2 * d * tan(fov / 2)
    ok("카메라 z=%.3f, 데크까지 %.3f m, FOV %.2f rad -> 보이는 폭 %.3f m"
       % (cam_z, d, fov, seen))
    if seen < M.MARK * 1.15:
        need = 2 * atan2(M.MARK * 1.15 / 2, d)
        fail("마커 %.2f m 가 화각에 안 들어온다. FOV %.2f rad 이상이거나 "
             "마커를 %.2f m 이하로 줄여야 한다" % (M.MARK, need, seen / 1.15))
    else:
        ok("마커 %.2f m 가 여유 있게 들어온다" % M.MARK)

# 리프트 플레이트가 카메라 시야(로봇 중심축)를 가리지 않는지.
# 충돌체는 꽉 찬 판이지만 렌더링되지 않으므로 카메라와 무관하다.
# 가리는 것은 "보이는 것"뿐이라 visual 만 본다.
def covers_axis(vis):
    """이 visual 이 (0,0) 세로축 위를 덮는가."""
    b = vis.find("./geometry/box")
    if b is None:
        c = vis.find("./geometry/cylinder")
        if c is None:
            return False
        o = vis.find("origin")
        xyz = [float(v) for v in (o.get("xyz") if o is not None
                                  and o.get("xyz") else "0 0 0").split()]
        return hypot(xyz[0], xyz[1]) < float(c.get("radius"))
    sx, sy, _sz = [float(v) for v in b.get("size").split()]
    o = vis.find("origin")
    xyz = [float(v) for v in (o.get("xyz") if o is not None
                              and o.get("xyz") else "0 0 0").split()]
    rpy = [float(v) for v in (o.get("rpy") if o is not None
                              and o.get("rpy") else "0 0 0").split()]
    # 중심에서 원점까지의 벡터를 박스 좌표계로 되돌린다
    dx, dy, yaw = -xyz[0], -xyz[1], rpy[2]
    lx = dx * cos(-yaw) - dy * sin(-yaw)
    ly = dx * sin(-yaw) + dy * cos(-yaw)
    return abs(lx) <= sx / 2 and abs(ly) <= sy / 2

blockers = []
nvis = 0
for l in root.findall("link"):
    if l.get("name") != "lift_link":
        continue
    for v in l.findall("visual"):
        nvis += 1
        if covers_axis(v):
            blockers.append(v.get("name") or "(이름없음)")
if blockers:
    fail("리프트의 %s 가 카메라 바로 위를 덮는다 - 마커를 못 읽는다" % blockers)
else:
    ok("리프트 보이는 조각 %d개 모두 중심축을 비켜 있다 - 카메라 시야 확보" % nvis)


# ---------------------------------------------------------------------------
print("\n8. 스폰 위치")
sys.path.insert(0, os.path.join(HERE, "launch"))
spawn = [("robot1", 12.5, -5.0), ("robot2", 12.5, -7.5)]
for ns, x, y in spawn:
    hit = [n for n, nx, ny, _t in M.NODES if abs(nx - x) < 1e-6 and abs(ny - y) < 1e-6]
    if not hit:
        fail("%s 스폰 위치 (%g, %g) 에 노드가 없다" % (ns, x, y))
    else:
        t = dict((n, t) for n, _x, _y, t in M.NODES)[hit[0]]
        if t != "charge":
            fail("%s 가 충전 노드가 아닌 %s(%s) 에 스폰된다" % (ns, hit[0], t))
        else:
            ok("%s -> 노드 %s (충전) (%g, %g)" % (ns, hit[0], x, y))

print("\n" + "=" * 60)
print("FAIL %d" % len(fails))
sys.exit(1 if fails else 0)
