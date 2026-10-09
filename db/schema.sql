-- PROJECT_2 노드형 관제 시스템 - 스키마
-- 계획서 4장 기준. 테이블 옆 괄호는 그 테이블이 생기는 단계다.
-- 점유(lock)와 대기열은 초 단위로 바뀌므로 DB 에 두지 않고 서버 메모리에만 둔다.

CREATE DATABASE IF NOT EXISTS fleet
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE fleet;

-- 노드 (1c) -----------------------------------------------------------------
-- x, y 는 미터이고 지도 원점 기준이다. sim/worlds/warehouse.sdf 와 같은 좌표계.
CREATE TABLE IF NOT EXISTS node (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  x    DOUBLE NOT NULL,
  y    DOUBLE NOT NULL,
  type ENUM('normal','charge','load','wait') NOT NULL DEFAULT 'normal'
) ENGINE=InnoDB;

-- 길 (1c) -------------------------------------------------------------------
-- direction='both' 면 양방향. 'one' 은 from_node -> to_node 만 허용.
-- distance 는 저장하되 노드를 옮기면 서버가 좌표로 다시 계산한다 (계획서 4장).
CREATE TABLE IF NOT EXISTS edge (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  from_node INT NOT NULL,
  to_node   INT NOT NULL,
  direction ENUM('one','both') NOT NULL DEFAULT 'both',
  distance  DOUBLE NOT NULL,
  UNIQUE KEY uq_edge (from_node, to_node),
  FOREIGN KEY (from_node) REFERENCES node(id) ON DELETE CASCADE,
  FOREIGN KEY (to_node)   REFERENCES node(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 로봇 (2) ------------------------------------------------------------------
-- adapter 가 'mock' 이면 서버 안 타이머 기반 가짜 로봇, 'ros' 면 rosbridge 경유.
-- namespace 는 ROS 토픽 접두사와 같아야 한다 (/robot1 -> /robot1/goal ...).
CREATE TABLE IF NOT EXISTS robot (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(32) NOT NULL UNIQUE,
  adapter   ENUM('mock','ros') NOT NULL DEFAULT 'mock',
  namespace VARCHAR(64) NOT NULL
) ENGINE=InnoDB;

-- 작업 (3) ------------------------------------------------------------------
-- 9단계에서 kind / shelf_id / drop_node 를 더한다. 아래 ALTER 참고.
CREATE TABLE IF NOT EXISTS task (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  robot_id    INT NOT NULL,
  target_node INT NOT NULL,
  status      ENUM('pending','running','done','failed','canceled')
                NOT NULL DEFAULT 'pending',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  KEY idx_task_robot_status (robot_id, status),
  FOREIGN KEY (robot_id)    REFERENCES robot(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node) REFERENCES node(id)  ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 설정 (6, 편집 화면은 8) ----------------------------------------------------
-- value 는 문자열로 두고 읽을 때 숫자로 바꾼다 (계획서 4장 결정).
-- 서버가 메모리에 캐시하고 PUT 이 올 때 갱신한다 (계획서 6장 8단계 주의점).
CREATE TABLE IF NOT EXISTS config (
  `key`   VARCHAR(64) PRIMARY KEY,
  `value` VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- 이벤트 (5) ----------------------------------------------------------------
-- 대기 시작, 타임아웃, 양보, 충전 출발, 선반 실패 같은 기록.
CREATE TABLE IF NOT EXISTS event (
  id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  robot_id INT NULL,
  kind     VARCHAR(32) NOT NULL,
  detail   JSON NULL,
  KEY idx_event_ts (ts),
  FOREIGN KEY (robot_id) REFERENCES robot(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 9단계 (선반 적재). 9단계에 들어갈 때 아래 주석을 풀어라.
-- ---------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS shelf (
--   id         INT AUTO_INCREMENT PRIMARY KEY,
--   qr_code    VARCHAR(64) NOT NULL UNIQUE,
--   node_id    INT NULL,          -- 놓인 노드. 로봇이 들고 있으면 NULL
--   carried_by INT NULL,          -- 들고 있는 로봇. 놓여 있으면 NULL
--   UNIQUE KEY uq_shelf_node (node_id),   -- 한 노드에 선반 하나 (계획서 9장)
--   FOREIGN KEY (node_id)    REFERENCES node(id)  ON DELETE SET NULL,
--   FOREIGN KEY (carried_by) REFERENCES robot(id) ON DELETE SET NULL
-- ) ENGINE=InnoDB;
--
-- ALTER TABLE task
--   ADD COLUMN kind      ENUM('move','transport') NOT NULL DEFAULT 'move',
--   ADD COLUMN shelf_id  INT NULL,
--   ADD COLUMN drop_node INT NULL,
--   ADD FOREIGN KEY (shelf_id)  REFERENCES shelf(id) ON DELETE SET NULL,
--   ADD FOREIGN KEY (drop_node) REFERENCES node(id)  ON DELETE RESTRICT;
