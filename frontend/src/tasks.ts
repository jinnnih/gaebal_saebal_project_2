// 이동 작업 규칙. 화면에 의존하지 않는 순수 함수라서, 서버(3~5단계: 이동 명령·경로·노드 점유)로 그대로 옮길 수 있음.
import type { MapEdge } from './types'
import { findRoute } from './route'

export type TaskStatus = 'running' | 'waiting' | 'done' | 'cancelled'

export type Task = {
  id: number
  amr: string
  from: number          // 출발 노드 id (짐을 받으러 가는 곳)
  to: number            // 도착 노드 id
  path: number[]        // 현재 위치 → 출발 → 도착, 노드 id 순서
  idx: number           // path 에서 AMR 이 지금 서 있는 칸
  status: TaskStatus    // waiting = 다음 노드를 다른 AMR 이 점유 중이라 기다림
  blockedBy?: string    // 기다리는 이유가 된 AMR
}

export type Positions = Record<string, number>   // AMR 이름 → 지금 서 있는 노드 id

export const isActive = (t: Task) => t.status === 'running' || t.status === 'waiting'

// 현재 위치(cur) → 출발(from) → 도착(to) 전체 경로. 안 되면 이유를 돌려줌
export type PathResult = { ok: true; path: number[] } | { ok: false; reason: string }

export const planPath = (edges: MapEdge[], cur: number, from: number, to: number): PathResult => {
  if (from === to) return { ok: false, reason: '출발과 도착이 같은 노드임' }
  const a = findRoute(edges, cur, from)
  if (!a) return { ok: false, reason: '현재 위치에서 출발 노드로 갈 수 없음' }
  const b = findRoute(edges, from, to)
  if (!b) return { ok: false, reason: '출발 → 도착 경로가 없음 (끊긴 길 · 일방통행 방향 확인)' }
  return { ok: true, path: [...a.nodes, ...b.nodes.slice(1)] }
}

// 한 걸음. 진행 중인 작업마다 다음 노드가 비어 있으면 한 칸 가고, 다른 AMR 이 있으면 기다림.
// 앞 작업이 먼저 움직이고 그 결과가 바로 반영되므로, 같은 노드를 두 AMR 이 동시에 차지하는 일은 없음.
export const step = (tasks: Task[], pos: Positions): { tasks: Task[]; pos: Positions } => {
  const nextPos = { ...pos }
  const out = tasks.map((t): Task => {
    if (!isActive(t)) return t
    const nxt = t.path[t.idx + 1]
    if (nxt === undefined) return { ...t, status: 'done', blockedBy: undefined }
    const holder = Object.keys(nextPos).find(a => a !== t.amr && nextPos[a] === nxt)
    if (holder) return { ...t, status: 'waiting', blockedBy: holder }
    nextPos[t.amr] = nxt
    const idx = t.idx + 1
    return { ...t, idx, status: idx >= t.path.length - 1 ? 'done' : 'running', blockedBy: undefined }
  })
  return { tasks: out, pos: nextPos }
}
