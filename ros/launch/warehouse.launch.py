#!/usr/bin/env python3
"""
PROJECT_2 - 창고 월드에 포드 운반 로봇 2대를 띄운다.

  ros2 launch warehouse.launch.py
  ros2 launch warehouse.launch.py gui:=false        헤드리스
  ros2 launch warehouse.launch.py engine:=ogre2     실제 GPU 장비

ament 패키지로 만들지 않았으므로 파일 경로로 바로 실행한다.
colcon 워크스페이스에 넣게 되면 get_package_share_directory 로 바꾸면 된다.

로봇은 충전 노드에 스폰한다 (ros/gen_map.py 의 CHARGE_NODES).
"""
import os

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, TimerAction
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

ROS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD = os.path.join(ROS_DIR, "worlds", "warehouse.sdf")
XACRO = os.path.join(ROS_DIR, "description", "pod_bot.urdf.xacro")
BRIDGE = os.path.join(ROS_DIR, "config", "bridge.yaml")
MODELS = os.path.join(ROS_DIR, "models")

# 로봇을 스폰할 시각(초). GUI 가 장면을 다 받은 뒤여야 화면에 그려진다.
SPAWN_AT = 16.0

# 스폰 위치. 충전 노드 K6 / K7 에 벽을 등지고 선다.
ROBOTS = [
    # ns,        x,     y,     yaw
    ("robot1", 12.5, -5.0, 3.14159),
    ("robot2", 12.5, -7.5, 3.14159),
]


def robot_description(ns):
    """xacro 를 돌려 URDF 문자열을 만든다."""
    import subprocess
    return subprocess.run(
        ["xacro", XACRO, "ns:=%s" % ns],
        check=True, capture_output=True, text=True).stdout


def generate_launch_description():
    gui = LaunchConfiguration("gui")
    engine = LaunchConfiguration("engine")

    acts = [
        DeclareLaunchArgument("gui", default_value="true",
                              description="Gazebo GUI 를 띄울지"),
        # VMware 의 SVGA3D 에서는 ogre2 가 화면을 깜빡인다. 기본을 ogre 로 둔다.
        DeclareLaunchArgument("engine", default_value="ogre",
                              description="GUI 렌더 엔진 (ogre | ogre2)"),
    ]

    # gz sim. ros_gz_sim 의 launch 를 거치지 않고 직접 띄운다 -
    # 렌더 엔진과 리소스 경로를 그대로 넘기기 쉽다.
    gz_env = {
        "GZ_SIM_RESOURCE_PATH": MODELS + os.pathsep
                                + os.environ.get("GZ_SIM_RESOURCE_PATH", ""),
        "SDF_PATH": MODELS + os.pathsep + os.environ.get("SDF_PATH", ""),
    }
    # 서버. LIBGL_ALWAYS_SOFTWARE=1 이 꼭 필요하다 -
    # VMware 의 SVGA3D 드라이버는 오프스크린 GPU 센서 렌더링을 못 해서,
    # 이게 없으면 라이다가 거리와 무관하게 늘 같은 값을 뱉는다
    # (ogre 면 전부 range_min, ogre2 면 전부 inf). run_sim.sh 주석 참고.
    srv_env = dict(gz_env)
    srv_env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    acts.append(ExecuteProcess(
        cmd=["gz", "sim", "-s", "-r", "-v", "2", WORLD],
        output="screen", additional_env=srv_env,
    ))
    # GUI 는 화면에 그리는 것뿐이라 하드웨어 가속을 그대로 쓴다.
    acts.append(TimerAction(period=3.0, actions=[ExecuteProcess(
        cmd=["gz", "sim", "-g", "--render-engine-gui", engine],
        output="screen", additional_env=gz_env,
        condition=IfCondition(gui),
    )]))

    # ros_gz_bridge
    acts.append(Node(
        package="ros_gz_bridge", executable="parameter_bridge",
        name="gz_bridge", output="screen",
        parameters=[{"config_file": BRIDGE,
                     "use_sim_time": True}],
    ))

    for i, (ns, x, y, yaw) in enumerate(ROBOTS):
        urdf = robot_description(ns)

        # TF 를 내보내는 robot_state_publisher
        acts.append(Node(
            package="robot_state_publisher", executable="robot_state_publisher",
            name="robot_state_publisher", namespace=ns, output="screen",
            parameters=[{"robot_description": urdf,
                         "frame_prefix": ns + "/",
                         "use_sim_time": True}],
        ))

        # 스폰은 GUI 가 완전히 뜬 뒤에 해야 한다.
        #
        # 너무 일찍 쏘면 물리에는 들어가지만 GUI 가 그 엔티티를 놓쳐서
        # 화면에 로봇이 안 그려진다. 월드가 크면(포드 18개) 더 심하다.
        # 실측: GUI 3초 + 스폰 6초 -> 안 보임. GUI 가 다 뜬 뒤 스폰 -> 보임.
        # 두 대를 동시에 쏘지 않고 조금 어긋나게 둔다.
        acts.append(TimerAction(period=SPAWN_AT + 3.0 * i, actions=[Node(
            package="ros_gz_sim", executable="create",
            name="spawn_" + ns, output="screen",
            arguments=["-world", "warehouse",
                       "-string", urdf,
                       "-name", ns,
                       "-x", str(x), "-y", str(y), "-z", "0.02",
                       "-Y", str(yaw)],
        )]))

    return LaunchDescription(acts)
