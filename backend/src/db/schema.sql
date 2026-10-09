-- 이 파일은 여러 번 실행해도 안전함. 표가 있으면 지우고 다시 만듦
DROP TABLE IF EXISTS edge;
DROP TABLE IF EXISTS node;

CREATE TABLE node (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  x    DOUBLE NOT NULL,   -- 미터, 지도 원점 기준
  y    DOUBLE NOT NULL,
  type ENUM('normal','charge','load','wait') NOT NULL DEFAULT 'normal'
);

CREATE TABLE edge (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  from_node INT NOT NULL,
  to_node   INT NOT NULL,
  direction ENUM('one','both') NOT NULL DEFAULT 'both',
  distance  DOUBLE NOT NULL,
  FOREIGN KEY (from_node) REFERENCES node(id) ON DELETE CASCADE,
  FOREIGN KEY (to_node)   REFERENCES node(id) ON DELETE CASCADE
);

INSERT INTO node (id, name, x, y, type) VALUES
  (1, 'A', 0,  0, 'charge'),
  (2, 'B', 4,  0, 'normal'),
  (3, 'C', 8,  0, 'normal'),
  (4, 'D', 12, 0, 'charge'),
  (5, 'W', 4,  3, 'wait');

INSERT INTO edge (id, from_node, to_node, direction, distance) VALUES
  (1, 1, 2, 'both', 4),
  (2, 2, 3, 'both', 4),
  (3, 3, 4, 'both', 4),
  (4, 2, 5, 'both', 3);