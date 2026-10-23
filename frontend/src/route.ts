// 노드 경로 계산. 화면에 의존하지 않는 순수 함수라서, 서버(4단계 경로탐색)로 그대로 옮길 수 있음.
import type { MapEdge } from './types'

export type Route = {
  nodes: number[]     // 지나는 노드 id 순서 (출발·도착 포함)
  distance: number    // 총 거리(m)
}

// from → to 최단 경로. 방향을 지킴: 'one' 은 from_node → to_node 로만, 'both' 는 양쪽으로.
// 갈 수 없으면 null. 같은 노드면 거리 0 인 경로.
export const findRoute = (edges: MapEdge[], from: number, to: number): Route | null => {
  if (from === to) return { nodes: [from], distance: 0 }

  // 이웃 목록: 노드 id → [(갈 수 있는 노드, 거리)]
  const next = new Map<number, { to: number; d: number }[]>()
  const add = (a: number, b: number, d: number) => {
    if (!next.has(a)) next.set(a, [])
    next.get(a)!.push({ to: b, d })
  }
  for (const e of edges) {
    add(e.from_node, e.to_node, e.distance)
    if (e.direction === 'both') add(e.to_node, e.from_node, e.distance)
  }

  // 다익스트라 (노드가 수십 개라 가장 단순한 방식으로 충분)
  const dist = new Map<number, number>([[from, 0]])
  const prev = new Map<number, number>()
  const done = new Set<number>()
  while (true) {
    let cur: number | null = null
    let best = Infinity
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) { cur = id; best = d }
    }
    if (cur === null) return null          // 더 갈 곳이 없음 = 도착 불가
    if (cur === to) break
    done.add(cur)
    for (const n of next.get(cur) ?? []) {
      const nd = best + n.d
      if (nd < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, nd)
        prev.set(n.to, cur)
      }
    }
  }

  const nodes = [to]
  while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0])!)
  return { nodes, distance: dist.get(to)! }
}
