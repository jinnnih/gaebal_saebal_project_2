#!/bin/bash
# PROJECT_2 시뮬레이션 실행
#
#   ./run_sim.sh          GUI 로 띄운다
#   ./run_sim.sh -s       헤드리스 (서버만)
#   ./run_sim.sh -c       월드 파싱 검사만 하고 끝낸다
#
# gz 는 /usr/bin 이 아니라 ROS vendor 경로에 있어서 setup.bash 소싱이 꼭 필요하다.
#   확인된 환경: Ubuntu 24.04.4 / ROS2 Jazzy / Gazebo Sim 8.11.0 (Harmonic)
#
# 서버와 GUI 를 따로 띄운다. 서버에만 LIBGL_ALWAYS_SOFTWARE=1 을 준다.
#   VMware 의 SVGA3D 드라이버는 오프스크린 GPU 센서 렌더링을 못 한다.
#   그대로 두면 라이다가 거리와 무관하게 늘 같은 값을 뱉는다
#   (ogre 면 전부 range_min, ogre2 면 전부 inf). 실측으로 확인한 조합:
#
#     엔진   LIBGL_ALWAYS_SOFTWARE   라이다
#     ogre   0                       실패 (전부 0.12)
#     ogre   1                       정상
#     ogre2  0                       실패 (전부 inf)
#     ogre2  1                       정상
#
#   GUI 는 화면에 그리는 것뿐이라 하드웨어 가속을 그대로 쓴다.
set -e

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORLD="$HERE/worlds/warehouse.sdf"

ROS_SETUP=/opt/ros/jazzy/setup.bash
if [ ! -f "$ROS_SETUP" ]; then
  echo "ROS2 Jazzy 가 $ROS_SETUP 에 없다. ROS_DISTRO 를 확인해라." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ROS_SETUP"

# gz sim 은 GZ_SIM_RESOURCE_PATH 로 model:// 를 찾고,
# gz sdf 같은 단독 도구는 SDF_PATH 를 본다. 둘 다 넣는다.
export GZ_SIM_RESOURCE_PATH="$HERE/models:${GZ_SIM_RESOURCE_PATH:-}"
export SDF_PATH="$HERE/models:${SDF_PATH:-}"

# VMware 의 SVGA3D 에서는 ogre2 가 GUI 화면을 깜빡인다.
# 실제 GPU 가 있는 장비면 GZ_GUI_ENGINE=ogre2 로 덮어라.
GUI_ENGINE="${GZ_GUI_ENGINE:-ogre}"

case "${1:-}" in
  -c)
    gz sdf -k "$WORLD"
    ;;
  -s)
    LIBGL_ALWAYS_SOFTWARE=1 exec gz sim -s -r -v 2 "$WORLD"
    ;;
  *)
    LIBGL_ALWAYS_SOFTWARE=1 gz sim -s -r -v 2 "$WORLD" &
    SRV=$!
    trap 'kill $SRV 2>/dev/null' EXIT INT TERM
    sleep 3
    gz sim -g --render-engine-gui "$GUI_ENGINE"
    ;;
esac
