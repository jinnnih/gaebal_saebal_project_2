import { useEffect, useRef, useState } from 'react'
import type { MapNode, MapEdge } from './types'
import './App.css'

const API = 'http://localhost:3000/api'

const SCALE = 40     // 1미터 = 40픽셀
const PAD = 60       // 가장자리 여백(픽셀)
const GRID = 0.5     // 노드를 찍을 때 붙일 격자 간격(미터)
const VIEW_W = 20    // 지도 영역 가로(미터)
const VIEW_H = 12    // 지도 영역 세로(미터)
const NODE_R = 18    // 노드 동그라미 반지름(픽셀)
const EDGE_GAP = NODE_R + 4   // 길·화살촉이 노드에서 이만큼 떨어져서 멈춤 (테두리에 안 겹치게)
const DRAG_MIN_PX = 12   // 누른 자리에서 이만큼은 움직여야 "끌기". 그보다 적으면 그냥 클릭
const SNAP_PX = 70  // 길 잇기: 이 거리(픽셀) 안이면 가장 가까운 노드에 자석처럼 붙음

const C_ARROW = '#805ad5'   // 길 화살표 색 (보라). 방향 하나 = 화살표 하나
const LANE = 7             // 양방일 때 두 화살표를 이 픽셀만큼 옆으로 벌림 (서로 반대쪽으로)
const C_NODE_MODE = '#2b6cb0'   // 노드 모드 색 (파랑)
const C_EDGE_MODE = '#805ad5'   // 길 모드 색 (보라) — 일방통행 보라와 같은 "길" 계열

// 모드 전환 버튼. 현재 모드는 색이 꽉 차고, 아닌 쪽은 테두리만 있음
const modeBtn = (active: boolean, side: 'left' | 'right', color: string): React.CSSProperties => ({
  padding: '7px 18px',
  border: `2px solid ${color}`,
  borderRadius: side === 'left' ? '8px 0 0 8px' : '0 8px 8px 0',
  marginLeft: side === 'right' ? -2 : 0,
  background: active ? color : 'white',
  color: active ? 'white' : color,
  fontWeight: active ? 700 : 500,
  cursor: active ? 'default' : 'pointer',
})

const COLOR = {
  normal: '#4a5568',
  charge: '#38a169',
  load:   '#dd6b20',
  wait:   '#3182ce',
}

type Pt = { x: number; y: number }   // 화면(SVG) 픽셀 좌표
type Mode = 'node' | 'edge'          // 노드 모드 / 길 모드

const toPx = (m: number) => m * SCALE + PAD          // 미터 → 픽셀 (그릴 때)
const toM  = (px: number) => (px - PAD) / SCALE      // 픽셀 → 미터 (클릭할 때)
const snap = (m: number) => Math.round(m / GRID) * GRID

// a → b 선의 양 끝을 반지름만큼 줄임. 그래야 화살촉이 노드 가장자리에서 멈춤.
// 두 점이 너무 가까워서 그릴 게 없으면 null
const trim = (a: Pt, b: Pt, ra: number, rb: number) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len <= ra + rb) return null
  const ux = dx / len   // a → b 방향의 단위 벡터
  const uy = dy / len
  return {
    x1: a.x + ux * ra, y1: a.y + uy * ra,
    x2: b.x - ux * rb, y2: b.y - uy * rb,
  }
}

export default function App() {
  const [nodes, setNodes] = useState<MapNode[]>([])
  const [edges, setEdges] = useState<MapEdge[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)   // 선택한 노드 id (노드 모드)

  const [mode, setMode] = useState<Mode>('node')
  const [dragFrom, setDragFrom] = useState<number | null>(null) // 끌기를 시작한 노드 id
  const [cursor, setCursor] = useState<Pt | null>(null)         // 끄는 중인 마우스 위치
  const pressedAt = useRef<Pt | null>(null)                     // 마우스를 누른 자리 (클릭인지 끌기인지 가르려고)
  const [moving, setMoving] = useState<{ id: number; pos: Pt } | null>(null)  // 노드 모드: 옮기는 중인 노드와 그 임시 위치(미터)
  const movedRef = useRef(false)          // 이번 누름에서 노드가 실제로 움직였는지
  const suppressClick = useRef(false)     // 끌기 끝에 따라오는 click 으로 노드가 선택되는 것 방지

  const load = () =>
    fetch(`${API}/map`)
      .then(res => res.json())
      .then(data => { setNodes(data.nodes); setEdges(data.edges) })

  useEffect(() => { load() }, [])

  // 옮기는 중인 노드는 임시 위치로 그림 (놓기 전에도 화살표가 같이 따라옴)
  const shownNodes = moving
    ? nodes.map(n => n.id === moving.id ? { ...n, x: moving.pos.x, y: moving.pos.y } : n)
    : nodes
  const byId = new Map(shownNodes.map(n => [n.id, n]))

  // 마우스 위치를 SVG 기준 픽셀로
  const pointerPx = (e: React.MouseEvent<SVGSVGElement>): Pt => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  // p 에서 SNAP_PX 안에 있는 노드 중 가장 가까운 것 (skipId 는 제외)
  const nearestNode = (p: Pt, skipId?: number): MapNode | null => {
    let best: MapNode | null = null
    let bestDist = SNAP_PX
    for (const n of nodes) {
      if (n.id === skipId) continue
      const d = Math.hypot(toPx(n.x) - p.x, toPx(n.y) - p.y)
      if (d <= bestDist) { best = n; bestDist = d }
    }
    return best
  }

  const changeMode = (m: Mode) => {
    if (m === mode) return   // 이미 그 모드면 아무것도 안 함
    setMode(m)
    setSelected(null)
    setDragFrom(null)
    setCursor(null)
    setMoving(null)
    setError('')
  }

  // ---------- 노드 모드: 빈 곳 클릭 = 노드 추가 ----------
  const onMapClick = async (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'node') return   // 길 모드에서는 끌기 끝에 click 이 따라오니 무시
    // 노드를 끌다 노드 밖에서 놓으면 click 이 지도로 오는데, 그건 새 노드를 찍으려는 게 아님
    if (suppressClick.current) { suppressClick.current = false; return }

    const box = e.currentTarget.getBoundingClientRect()
    const x = snap(toM(e.clientX - box.left))
    const y = snap(toM(e.clientY - box.top))

    // 지도 밖이면 무시
    if (x < 0 || y < 0 || x > VIEW_W || y > VIEW_H) return

    // 이름은 N1, N2 ... 중 안 쓰는 첫 번호
    const used = new Set(nodes.map(n => n.name))
    let i = 1
    while (used.has(`N${i}`)) i++

    const res = await fetch(`${API}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `N${i}`, x, y, type: 'normal' }),
    })
    if (!res.ok) {
      setError((await res.json()).error)
      return
    }
    setError('')
    await load()
  }

  const onDelete = async () => {
    if (selected === null) return
    const res = await fetch(`${API}/nodes/${selected}`, { method: 'DELETE' })
    if (!res.ok) {
      setError((await res.json()).error)
      return
    }
    setError('')
    setSelected(null) // 지웠으니 선택해제
    await load()
  }

  // ---------- 길 모드: 노드 근처에서 눌러 다른 노드 쪽으로 끌기 = 길 잇기 ----------
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = pointerPx(e)

    // 노드 모드: 노드 위에서 누르면 이동 준비 (실제로 움직여야 이동, 안 움직이면 클릭=선택)
    if (mode === 'node') {
      const hit = nearestNode(p)
      if (!hit || Math.hypot(toPx(hit.x) - p.x, toPx(hit.y) - p.y) > NODE_R) return
      e.preventDefault()
      pressedAt.current = p
      movedRef.current = false
      suppressClick.current = false
      setMoving({ id: hit.id, pos: { x: hit.x, y: hit.y } })
      return
    }

    if (mode !== 'edge') return
    const start = nearestNode(p)     // 정확히 노드를 안 눌러도 가장 가까운 노드에서 시작
    if (!start) return
    e.preventDefault()               // 끌 때 글자가 선택되는 것 방지
    pressedAt.current = p
    setDragFrom(start.id)
    setCursor(p)
  }

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (moving) {
      const p = pointerPx(e)
      const down = pressedAt.current
      // 처음 누른 자리에서 조금 움직여야 이동 시작 (클릭 손떨림 무시)
      if (!movedRef.current && (!down || Math.hypot(p.x - down.x, p.y - down.y) < DRAG_MIN_PX)) return
      movedRef.current = true
      // 격자에 맞추고 지도 밖으로는 못 나가게
      const x = Math.min(VIEW_W, Math.max(0, snap(toM(p.x))))
      const y = Math.min(VIEW_H, Math.max(0, snap(toM(p.y))))
      if (x !== moving.pos.x || y !== moving.pos.y) setMoving({ id: moving.id, pos: { x, y } })
      return
    }
    if (dragFrom === null) return
    setCursor(pointerPx(e))
  }

  const cancelDrag = () => {
    setDragFrom(null)
    setCursor(null)
    setMoving(null)   // 노드 이동 중에 지도 밖으로 나가면 취소 (저장 안 됨)
  }

  // 노드 이동 끝: 놓은 자리를 저장
  const finishMove = async () => {
    if (!moving) return
    const { id, pos } = moving
    setMoving(null)
    if (!movedRef.current) return   // 안 움직였으면 그냥 클릭 → 선택은 노드의 onClick 이 처리
    suppressClick.current = true

    setNodes(ns => ns.map(n => n.id === id ? { ...n, x: pos.x, y: pos.y } : n))   // 서버 응답 전에도 제자리에 머물게
    const res = await fetch(`${API}/nodes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: pos.x, y: pos.y }),
    })
    if (!res.ok) setError((await res.json().catch(() => null))?.error ?? '노드를 옮기지 못함')
    else setError('')
    await load()   // 실패하면 원래 자리로, 성공하면 서버가 다시 계산한 길 거리까지 반영
  }

  const onMouseUp = async (e: React.MouseEvent<SVGSVGElement>) => {
    if (moving) return finishMove()
    if (dragFrom === null) return
    const from = dragFrom
    const start = byId.get(from)
    const p = pointerPx(e)
    cancelDrag()

    // 누른 자리에서 거의 안 움직였으면 끌기가 아니라 클릭 → 길을 만들지 않음 (화살표 클릭 = 선택이 이 경우)
    const down = pressedAt.current
    pressedAt.current = null
    if (!down || Math.hypot(p.x - down.x, p.y - down.y) < DRAG_MIN_PX) return

    // 시작 노드를 거의 벗어나지 않았으면 취소
    if (!start || Math.hypot(p.x - toPx(start.x), p.y - toPx(start.y)) < NODE_R * 2) return

    const target = nearestNode(p, from)   // 놓은 곳에서 가장 가까운 노드에 붙임
    if (!target) return

    const res = await fetch(`${API}/edges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from_node: from,
        to_node: target.id,
        direction: 'one',   // 끈 방향 하나만. 반대로 또 끌면 두 번째 화살표가 생겨 양방이 됨
      }),
    })
    if (!res.ok) {
      setError((await res.json()).error)
      return
    }
    setError('')
    await load()
  }

  // ---------- 그리기 준비 ----------
  const fromNode = dragFrom !== null ? byId.get(dragFrom) : undefined
  const candidate = fromNode && cursor ? nearestNode(cursor, fromNode.id) : null  // 지금 붙을 노드

  let preview = null   // 끄는 동안 보이는 임시 선
  if (fromNode && cursor) {
    const a = { x: toPx(fromNode.x), y: toPx(fromNode.y) }
    const b = candidate ? { x: toPx(candidate.x), y: toPx(candidate.y) } : cursor
    // 붙을 노드가 있으면 그 노드 가장자리에서 멈추고, 없으면 마우스 위치까지
    preview = trim(a, b, EDGE_GAP, candidate ? EDGE_GAP : 0)
  }

  // DB 의 길을 "방향 하나 = 화살표 하나" 로 풀어서 그림.
  // 예전에 만든 both 길은 화살표 두 개(왕복)로 풀고, 반대 방향이 따로 있는 one 길은 둘 다 옆으로 비킴
  const arrows: { key: string; edgeId: number; from: number; to: number; offset: number }[] = []
  for (const e of edges) {
    if (e.direction === 'both') {
      arrows.push({ key: `${e.id}f`, edgeId: e.id, from: e.from_node, to: e.to_node, offset: LANE })
      arrows.push({ key: `${e.id}r`, edgeId: e.id, from: e.to_node, to: e.from_node, offset: LANE })
    } else {
      const hasReverse = edges.some(o =>
        o.id !== e.id && o.direction === 'one' && o.from_node === e.to_node && o.to_node === e.from_node)
      arrows.push({ key: `${e.id}`, edgeId: e.id, from: e.from_node, to: e.to_node, offset: hasReverse ? LANE : 0 })
    }
  }

  const ringColor = (id: number) =>
    id === candidate?.id ? '#48bb78'   // 초록: 여기에 붙을 것
    : id === dragFrom    ? '#4299e1'   // 파랑: 끌기 시작한 노드
    : id === selected    ? '#ecc94b'   // 노랑: 선택된 노드
    : 'none'

  return (
    <div>
      <h1>노드 지도</h1>

      <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span>
          <button onClick={() => changeMode('node')}
                  style={modeBtn(mode === 'node', 'left', C_NODE_MODE)}>
            노드 모드
          </button>
          <button onClick={() => changeMode('edge')}
                  style={modeBtn(mode === 'edge', 'right', C_EDGE_MODE)}>
            길 모드
          </button>
        </span>
        <b style={{ color: mode === 'node' ? C_NODE_MODE : C_EDGE_MODE }}>
          현재: {mode === 'node' ? '노드 모드 (점 찍기)' : '길 모드 (길 잇기)'}
        </b>
      </p>

      {mode === 'node' ? (
        <p>
          빈 곳 클릭 = 노드 추가 · 노드 클릭 = 선택 · 노드 끌기 = 이동 (격자 {GRID}m)
          {' '}
          <button onClick={onDelete} disabled={selected === null}>
            선택한 노드 삭제
          </button>
        </p>
      ) : (
        <p>
          노드 근처를 눌러 다른 노드 쪽으로 끌기 = 끈 방향으로 화살표 하나 · 반대로 또 끌면 양방(화살표 두 줄)
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <svg
        width={VIEW_W * SCALE + PAD * 2}
        height={VIEW_H * SCALE + PAD * 2}
        style={{
          background: '#f7fafc',
          cursor: mode === 'node' ? 'crosshair' : 'grab',
          // 지도 테두리 색으로도 모드를 알림. outline 은 크기에 안 들어가서 클릭 좌표 계산이 안 어긋남
          outline: `3px solid ${mode === 'node' ? C_NODE_MODE : C_EDGE_MODE}`,
          userSelect: 'none',
        }}
        onClick={onMapClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={cancelDrag}
      >
        <defs>
          {/* 화살촉. 뾰족한 끝(refX=10)이 선의 끝점에 오도록 맞춤 */}
          {/* orient="auto-start-reverse": 같은 화살촉을 선의 시작 쪽에 쓰면 자동으로 반대로 뒤집힘 */}
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
                  markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18"
                  orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={C_ARROW} />
          </marker>
          <marker id="arrow-preview" viewBox="0 0 10 10" refX="10" refY="5"
                  markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18"
                  orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4299e1" />
          </marker>
        </defs>

        {arrows.map(ar => {
          const a = byId.get(ar.from)
          const b = byId.get(ar.to)
          if (!a || !b) return null
          const pa = { x: toPx(a.x), y: toPx(a.y) }
          const pb = { x: toPx(b.x), y: toPx(b.y) }

          // 노드 가장자리에서 시작해 가장자리에서 끝남 (화살촉이 노드에 안 가려짐)
          const t = trim(pa, pb, EDGE_GAP, EDGE_GAP)
          if (!t) return null

          // 반대 방향 화살표가 따로 있으면(=양방) 각자 진행 방향의 오른쪽으로 LANE 만큼 비켜서 두 줄이 됨
          // 한 방향뿐이면 offset 0 → 노드 사이 한가운데
          const len = Math.hypot(pb.x - pa.x, pb.y - pa.y)
          const nx = -(pb.y - pa.y) / len * ar.offset   // 진행 방향에 수직인 단위 벡터 × offset
          const ny =  (pb.x - pa.x) / len * ar.offset

          const x1 = t.x1 + nx, y1 = t.y1 + ny, x2 = t.x2 + nx, y2 = t.y2 + ny
          return (
            <line key={ar.key}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={C_ARROW} strokeWidth={4}
              markerEnd="url(#arrow)" />
          )
        })}

        {/* 끄는 동안 보이는 임시 선 */}
        {preview && (
          <line
            x1={preview.x1} y1={preview.y1} x2={preview.x2} y2={preview.y2}
            stroke="#4299e1" strokeWidth={4} strokeDasharray="8 6"
            markerEnd="url(#arrow-preview)"
            style={{ pointerEvents: 'none' }} />
        )}

        {shownNodes.map(n => (
          <g key={n.id}
            onClick={e => {
              e.stopPropagation()                        // 지도 클릭으로 안 넘김
              if (mode !== 'node') return
              if (suppressClick.current) { suppressClick.current = false; return }   // 끌기 끝의 click 은 선택 아님
              setSelected(selected === n.id ? null : n.id) // 다시 누르면 선택 해제
            }}
            style={{ cursor: mode === 'node' ? 'grab' : 'inherit' }}>
            <circle cx={toPx(n.x)} cy={toPx(n.y)} r={NODE_R}
                    fill={COLOR[n.type]}
                    stroke={ringColor(n.id)}
                    strokeWidth={4} />
            <text x={toPx(n.x)} y={toPx(n.y) + 5}
                  textAnchor="middle" fill="white"
                  fontSize={14} fontWeight="bold"
                  style={{ pointerEvents: 'none' }}>
              {n.name}
            </text>
          </g>
        ))}
      </svg>

      <p style={{ fontSize: 13, color: '#4a5568' }}>
        <b style={{ color: C_ARROW }}>화살표 한 줄</b> = 그 방향으로만 갈 수 있음
        {' · '}
        <b style={{ color: C_ARROW }}>화살표 두 줄</b> = 양방(서로 반대 방향)
      </p>
    </div>
  )
}
