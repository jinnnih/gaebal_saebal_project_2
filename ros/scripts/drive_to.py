#!/usr/bin/env python3
"""
로봇을 odom 기준으로 상대 이동시킨다. 손으로 시험할 때 쓰는 도구다.

  python3 drive_to.py robot1 --forward 2.5      앞으로 2.5 m
  python3 drive_to.py robot1 --forward -2.5     뒤로 2.5 m
  python3 drive_to.py robot1 --turn 1.5708      제자리에서 왼쪽 90도

왜 odom 상대 이동인가
  처음엔 gz 의 참값(gz model -p)을 폴링해서 절대 좌표로 몰았는데, 그 호출이
  한 번에 수 초씩 걸려 제어 주기가 벌어졌다. VM 에서 재 보니 표본 사이에
  0.54 m 씩 움직여 목표를 그냥 지나쳤다. odom 은 30 Hz 로 들어오는 토픽이라
  주기가 짧고, 상대 이동이면 set_pose 로 순간이동시켜 odom 원점이 월드와
  어긋나 있어도 상관없다.

  실제 주행은 Nav2 가 맡는다 (계획서 6장). 이건 시험용이다.
"""
import argparse
import math
import sys

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy


def yaw_of(q):
    return math.atan2(2.0 * (q.w * q.z + q.x * q.y),
                      1.0 - 2.0 * (q.y * q.y + q.z * q.z))


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class Mover(Node):
    def __init__(self, robot, forward, turn, speed, turn_speed, tol, ang_tol):
        super().__init__("drive_to")
        self.forward, self.turn = forward, turn
        self.speed, self.turn_speed = speed, turn_speed
        self.tol, self.ang_tol = tol, ang_tol

        qos = QoSProfile(depth=10)
        qos.reliability = ReliabilityPolicy.BEST_EFFORT
        self.pub = self.create_publisher(Twist, "/%s/cmd_vel" % robot, 10)
        self.create_subscription(Odometry, "/%s/odom" % robot, self.on_odom, qos)

        self.start = None          # (x, y, yaw)
        self.cur = None
        self.done = False
        self.last_report = 0.0
        self.create_timer(0.05, self.tick)      # 20 Hz

    def on_odom(self, m):
        p = m.pose.pose
        self.cur = (p.position.x, p.position.y, yaw_of(p.orientation))
        if self.start is None:
            self.start = self.cur
            print("  출발 (%.3f, %.3f) yaw %.3f" % self.start, flush=True)

    def tick(self):
        if self.cur is None or self.done:
            return
        x, y, yaw = self.cur
        sx, sy, syaw = self.start
        cmd = Twist()

        if self.turn is not None:
            turned = wrap(yaw - syaw)
            left = self.turn - turned
            if abs(left) < self.ang_tol:
                self.finish("회전 완료 %.3f rad (목표 %.3f)" % (turned, self.turn))
                return
            cmd.angular.z = max(-self.turn_speed,
                                min(self.turn_speed, 1.5 * left))
            # 너무 느려서 멈춰 버리지 않게 최소 속도를 준다
            if abs(cmd.angular.z) < 0.12:
                cmd.angular.z = 0.12 * (1 if left > 0 else -1)
            self.report(abs(left), "rad")
        else:
            gone = math.hypot(x - sx, y - sy)
            left = abs(self.forward) - gone
            if left < self.tol:
                self.finish("이동 완료 %.3f m (목표 %.3f)" % (gone, abs(self.forward)))
                return
            v = max(0.06, min(self.speed, 0.9 * left))     # 끝에서 감속
            cmd.linear.x = v if self.forward > 0 else -v
            # 직진 유지: 처음 방향에서 틀어진 만큼 되돌린다
            cmd.angular.z = max(-0.3, min(0.3, 1.2 * wrap(syaw - yaw)))
            self.report(left, "m")

        self.pub.publish(cmd)

    def report(self, left, unit):
        if abs(left - self.last_report) > 0.25:
            print("  남은 %.2f %s" % (left, unit), flush=True)
            self.last_report = left

    def finish(self, msg):
        self.done = True
        stop = Twist()
        for _ in range(12):
            self.pub.publish(stop)
        print("  " + msg, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("robot")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--forward", type=float, help="앞(+)/뒤(-) 이동 거리 m")
    g.add_argument("--turn", type=float, help="제자리 회전 rad (왼쪽 +)")
    ap.add_argument("--speed", type=float, default=0.28)
    ap.add_argument("--turn-speed", type=float, default=0.6)
    ap.add_argument("--tol", type=float, default=0.03)
    ap.add_argument("--ang-tol", type=float, default=0.03)
    ap.add_argument("--timeout", type=float, default=180.0, help="실제 시간 한도 s")
    a = ap.parse_args()

    rclpy.init()
    node = Mover(a.robot, a.forward, a.turn, a.speed, a.turn_speed,
                 a.tol, a.ang_tol)
    import time
    t0 = time.time()
    try:
        while rclpy.ok() and not node.done and time.time() - t0 < a.timeout:
            rclpy.spin_once(node, timeout_sec=0.05)
        if not node.done:
            print("  시간 초과", flush=True)
            node.finish("정지")
            for _ in range(10):
                rclpy.spin_once(node, timeout_sec=0.02)
            return 1
        for _ in range(20):          # 정지 명령이 실제로 나가도록
            rclpy.spin_once(node, timeout_sec=0.02)
    finally:
        node.destroy_node()
        rclpy.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
