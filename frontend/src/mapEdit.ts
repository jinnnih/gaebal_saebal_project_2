// 매핑 지도 수정용 계산. 좌표는 전부 미터 (지도와 같은 좌표계).
// 라이다 지도에서 벽·장애물이 비뚤거나 끊겨 있을 때 선으로 정리하는 데 씀.

export type Line = {
  id: number
  x1: number; y1: number
  x2: number; y2: number
  style: 'solid' | 'dashed'   // solid = 벽/장애물 실선, dashed = 라이다가 흐리게·점선으로 잡은 것
}

type P = { x: number; y: number }

const STRAIGHT_DEG = 20            // 수평/수직에서 이 각도 안쪽으로 기울었으면 "평평해야 하는 선"으로 봄
const TAN = Math.tan(STRAIGHT_DEG * Math.PI / 180)
export const CONNECT_M = 0.4       // 끝점끼리 이 거리(m) 안이면 "끊긴 선"으로 보고 이음
const MIN_LEN = 0.3                // 이보다 짧게 그린 선은 무시 (클릭 실수)
const RES = 0.05                   // 지도 해상도(m/픽셀). 좌표를 여기에 맞춰 둠

export const gridSnap = (v: number, step = RES) => Math.round(v / step) * step

// 점 p 에서 선분 l 까지의 거리
export const distToSegment = (p: P, l: Line) => {
  const dx = l.x2 - l.x1
  const dy = l.y2 - l.y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / len2))
  return Math.hypot(p.x - (l.x1 + t * dx), p.y - (l.y1 + t * dy))
}

// 이미 있는 선들의 끝점 중 p 와 가장 가까운 것 (CONNECT_M 안일 때만)
const nearestEndpoint = (lines: Line[], p: P): P | null => {
  let best: P | null = null
  let bestD = CONNECT_M
  for (const l of lines) {
    for (const q of [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]) {
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d <= bestD) { best = q; bestD = d }
    }
  }
  return best
}

// a 에서 b 쪽으로 그은 선이 거의 수평/수직이면 b 를 축에 맞춤
const axisSnap = (a: P, b: P): P => {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  if (dy <= dx * TAN) return { x: b.x, y: a.y }   // 수평
  if (dx <= dy * TAN) return { x: a.x, y: b.y }   // 수직
  return b
}

// 사용자가 끈 선(a → b)을 정리해서 새 선으로. 시작·끝점은 가까운 기존 끝점에 붙고,
// 끝점이 안 붙었으면 straighten 이 켜졌을 때 수평/수직으로 폄
export const buildLine = (a: P, b: P, lines: Line[], straighten: boolean, id: number): Line | null => {
  const p1 = nearestEndpoint(lines, a) ?? a
  let p2 = nearestEndpoint(lines, b)
  if (!p2) p2 = straighten ? axisSnap(p1, b) : b
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < MIN_LEN) return null
  return { id, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, style: 'solid' }
}

// 선택 영역(없으면 전체)의 선을 한꺼번에 정리: ① 평평하게 ② 끊긴 곳 잇기
// target 이 true 인 선만 고침. 연결은 "한쪽이라도 대상"이면 함.
export const cleanUp = (lines: Line[], target: (l: Line) => boolean) => {
  let straightened = 0
  let joined = 0
  const out = lines.map(l => ({ ...l }))

  for (const l of out) {
    if (!target(l)) continue
    const dx = l.x2 - l.x1
    const dy = l.y2 - l.y1
    if (dx === 0 || dy === 0) continue   // 이미 평평함
    if (Math.abs(dy) <= Math.abs(dx) * TAN) {
      l.y1 = l.y2 = gridSnap((l.y1 + l.y2) / 2)
      straightened++
    } else if (Math.abs(dx) <= Math.abs(dy) * TAN) {
      l.x1 = l.x2 = gridSnap((l.x1 + l.x2) / 2)
      straightened++
    }
  }

  // 뒤쪽 선의 끝점을 앞쪽 선의 끝점 위치로 붙임
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!target(out[i]) && !target(out[j])) continue
      const a = out[i]
      const b = out[j]
      for (const k of [1, 2] as const) {
        const bx = k === 1 ? b.x1 : b.x2
        const by = k === 1 ? b.y1 : b.y2
        for (const q of [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }]) {
          const d = Math.hypot(q.x - bx, q.y - by)
          if (d > 0.001 && d <= CONNECT_M) {
            if (k === 1) { b.x1 = q.x; b.y1 = q.y } else { b.x2 = q.x; b.y2 = q.y }
            joined++
            break
          }
        }
      }
    }
  }
  return { lines: out, straightened, joined }
}

// 더미 데이터: 라이다가 불완전하게 잡은 선들. 이걸로 "선 보정"·"점선→실선" 을 눈으로 확인
export const SEED_LINES: Line[] = [
  { id: 1, x1: 2.0, y1: 10.0, x2: 4.4, y2: 10.3, style: 'solid' },     // 비뚤어진 선
  { id: 2, x1: 14.0, y1: 5.5, x2: 15.6, y2: 5.5, style: 'solid' },     // 끊긴 선 (왼쪽 조각)
  { id: 3, x1: 15.9, y1: 5.52, x2: 17.4, y2: 5.46, style: 'solid' },   // 끊긴 선 (오른쪽 조각, 살짝 기움)
  { id: 4, x1: 6.0, y1: 5.0, x2: 9.0, y2: 5.0, style: 'dashed' },      // 점선으로 잡힌 장애물
  { id: 5, x1: 9.0, y1: 5.0, x2: 9.0, y2: 6.2, style: 'dashed' },
]
