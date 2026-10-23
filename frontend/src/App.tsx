import { useEffect, useRef, useState } from 'react'
import type { MapNode, MapEdge } from './types'
import { SEED_LINES, buildLine, cleanUp, distToSegment, gridSnap } from './mapEdit'
import type { Line } from './mapEdit'
import './App.css'

const API = 'http://localhost:3000/api'

const SCALE = 40     // 1미터 = 40픽셀
const PAD = 60       // 가장자리 여백(픽셀)
const GRID = 0.5     // 노드를 찍을 때 붙일 격자 간격(미터)
const VIEW_W = 20    // 지도 영역 가로(미터)
const VIEW_H = 12    // 지도 영역 세로(미터)
const BOX_W = VIEW_W * SCALE + PAD * 2   // 지도(SVG) 내부 좌표계 크기 — 확대해도 이 값은 그대로
const BOX_H = VIEW_H * SCALE + PAD * 2
const NODE_R = 10    // 노드 동그라미 반지름(픽셀)
const NODE_HIT = NODE_R + 4   // 노드를 눌렀다고 보는 반지름 (작은 노드도 누르기 쉽게)
const EDGE_GAP = NODE_R + 3   // 길·화살촉이 노드에서 이만큼 떨어져서 멈춤 (테두리에 안 겹치게)
const DRAG_MIN_PX = 12   // 누른 자리에서 이만큼은 움직여야 "끌기". 그보다 적으면 그냥 클릭
const SNAP_PX = 45  // 길 잇기: 이 거리(픽셀) 안이면 가장 가까운 노드에 자석처럼 붙음
const ERASE_M = 0.3 // 지우개: 선에서 이 거리(m) 안을 누르면 그 선을 지움

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3]   // 확대·축소 단계
const MAP_ALPHA = 0.5   // 노드 탭에서 매핑 지도가 비치는 정도 (노드가 잘 보이게 흐리게)

const C_ARROW = '#805ad5'   // 길 화살표 색 (보라). 방향 하나 = 화살표 하나
const LANE = 4             // 양방일 때 두 화살표를 이 픽셀만큼 옆으로 벌림 (서로 반대쪽으로)
const C_NODE_MODE = '#2b6cb0'   // 노드 모드 색 (파랑)
const C_EDGE_MODE = '#805ad5'   // 길 모드 색 (보라) — 일방통행 보라와 같은 "길" 계열
const C_DEL_MODE  = '#e53e3e'   // 삭제 모드 색 (빨강). 지워질 대상도 이 색으로 미리 보여줌
const C_MAP_EDIT  = '#dd6b20'   // 맵 수정 색 (주황)

// 모드 전환 버튼. 현재 모드는 색이 꽉 차고, 아닌 쪽은 테두리만 있음
const modeBtn = (active: boolean, side: 'left' | 'mid' | 'right', color: string): React.CSSProperties => ({
  padding: '7px 18px',
  border: `2px solid ${color}`,
  borderRadius: side === 'left' ? '8px 0 0 8px' : side === 'right' ? '0 8px 8px 0' : 0,
  marginLeft: side === 'left' ? 0 : -2,
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
type Mode = 'node' | 'edge' | 'delete'   // 노드 모드 / 길 모드 / 삭제 모드
type Target = { kind: 'node' | 'edge'; id: number }   // 삭제 모드에서 마우스가 올라간 대상

type Tab = 'node' | 'manual' | 'mapping'   // 오른쪽 패널 탭: 노드 / 수동 조작 / 매핑
const TABS: { id: Tab; label: string }[] = [
  { id: 'node', label: '노드' },
  { id: 'manual', label: '수동 조작' },
  { id: 'mapping', label: '매핑' },
]

type MapTab = 'create' | 'edit'            // 매핑 탭 안의 두 갈래: 맵 생성 / 맵 수정
type Tool = 'line' | 'erase' | 'region'    // 맵 수정 도구: 선 그리기 / 지우개 / 영역 선택(부분 매핑)
type Rect = { x0: number; y0: number; x1: number; y1: number }   // 미터

// 더미 매핑 지도 (public/maps/warehouse.png + warehouse.yaml). 실제 지도로 바꿀 때 이 파일들만 교체
const MAP_IMG = { src: '/maps/warehouse.png', w: 400, h: 240, resolution: 0.05 }

const MODE_COLOR: Record<Mode, string> = { node: C_NODE_MODE, edge: C_EDGE_MODE, delete: C_DEL_MODE }
const MODE_LABEL: Record<Mode, string> = {
  node: '노드 모드 (점 찍기)',
  edge: '길 모드 (길 잇기)',
  delete: '삭제 모드 (누르면 바로 삭제)',
}

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
  const [hover, setHover] = useState<Target | null>(null)         // 삭제 모드: 마우스가 올라간 대상 (빨갛게 미리 보여줌)

  const [tab, setTab] = useState<Tab>('node')
  const [zoom, setZoom] = useState(1)                   // 지도 확대 배율
  const [mapOn, setMapOn] = useState(true)              // 노드 탭: 매핑 지도 레이어 보이기

  // ---- 매핑 탭 (아직 서버·로봇과 연결 안 된 더미) ----
  const [mapTab, setMapTab] = useState<MapTab>('create')
  const [mapName, setMapName] = useState('warehouse')   // 맵 생성: 맵 이름
  const [mapping, setMapping] = useState(false)         // 맵 생성: 매핑 진행 중인지
  const [progress, setProgress] = useState(100)         // 맵 생성: 지금까지 그려진 지도 (%)
  const [saveMsg, setSaveMsg] = useState('')

  const [lines, setLines] = useState<Line[]>(SEED_LINES)   // 맵 수정: 라이다가 잡은 선들 (실선/점선)
  const [undo, setUndo] = useState<Line[][]>([])
  const [tool, setTool] = useState<Tool>('line')
  const [straightOn, setStraightOn] = useState(true)    // 선 그릴 때 자동으로 수평/수직 보정
  const [region, setRegion] = useState<Rect | null>(null)   // 선택한 영역 (부분 매핑·보정 대상)
  const [draft, setDraft] = useState<{ a: Pt; b: Pt } | null>(null)   // 끄는 중인 선/영역 (미터)
  const [partial, setPartial] = useState<number | null>(null)         // 부분 매핑 진행률 (%), 안 하면 null
  const [editMsg, setEditMsg] = useState('')
  const nextLineId = useRef(100)

  const [lastCmd, setLastCmd] = useState('없음')         // 수동 조작 마지막으로 누른 버튼

  const [mode, setMode] = useState<Mode>('node')
  const [dragFrom, setDragFrom] = useState<number | null>(null) // 끌기를 시작한 노드 id
  const [cursor, setCursor] = useState<Pt | null>(null)         // 끄는 중인 마우스 위치
  const pressedAt = useRef<Pt | null>(null)                     // 마우스를 누른 자리 (클릭인지 끌기인지 가르려고)
  const [moving, setMoving] = useState<{ id: number; pos: Pt } | null>(null)  // 노드 모드: 옮기는 중인 노드와 그 임시 위치(미터)
  const movedRef = useRef(false)          // 이번 누름에서 노드가 실제로 움직였는지
  const suppressClick = useRef(false)     // 끌기 끝에 따라오는 click 으로 노드가 선택되는 것 방지

  const mapEditing = tab === 'mapping' && mapTab === 'edit'   // 지도에서 선·영역을 그릴 수 있는 상태

  const load = () =>
    fetch(`${API}/map`)
      .then(res => res.json())
      .then(data => { setNodes(data.nodes); setEdges(data.edges) })

  useEffect(() => { load() }, [])

  // 더미 맵 생성: 150ms 마다 2% 씩 지도가 그려지고, 100% 가 되면 끝
  useEffect(() => {
    if (!mapping) return
    const t = setTimeout(() => {
      if (progress >= 100) setMapping(false)
      else setProgress(Math.min(100, progress + 2))
    }, 150)
    return () => clearTimeout(t)
  }, [mapping, progress])

  // 더미 부분 매핑: 선택한 영역만 150ms 마다 4% 씩 다시 그려짐
  useEffect(() => {
    if (partial === null) return
    const t = setTimeout(() => {
      if (partial >= 100) {
        setPartial(null)
        setEditMsg('부분 매핑 완료 (더미) — 선택한 영역만 갱신, 전체 매핑은 필요 없음')
      } else {
        setPartial(partial + 4)
      }
    }, 150)
    return () => clearTimeout(t)
  }, [partial])

  // 옮기는 중인 노드는 임시 위치로 그림 (놓기 전에도 화살표가 같이 따라옴)
  const shownNodes = moving
    ? nodes.map(n => n.id === moving.id ? { ...n, x: moving.pos.x, y: moving.pos.y } : n)
    : nodes
  const byId = new Map(shownNodes.map(n => [n.id, n]))

  // 마우스 위치를 지도 내부 좌표(픽셀, BOX_W x BOX_H 기준)로. 확대해서 화면에서 커져도 같은 값이 나옴
  const pointerPx = (e: React.MouseEvent<SVGSVGElement>): Pt => {
    const box = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - box.left) * (BOX_W / box.width),
      y: (e.clientY - box.top) * (BOX_H / box.height),
    }
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

  const goTab = (t: Tab) => {
    setTab(t)
    setDraft(null)
    setDragFrom(null)
    setCursor(null)
    setMoving(null)
  }

  const changeMode = (m: Mode) => {
    if (m === mode) return   // 이미 그 모드면 아무것도 안 함
    setMode(m)
    setSelected(null)
    setHover(null)
    setDragFrom(null)
    setCursor(null)
    setMoving(null)
    setError('')
  }

  // ---------- 노드 모드: 빈 곳 클릭 = 노드 추가 ----------
  const onMapClick = async (e: React.MouseEvent<SVGSVGElement>) => {
    if (tab !== 'node' || mode !== 'node') return   // 길·삭제 모드에서는 끌기 끝에 click 이 따라오니 무시
    // 노드를 끌다 노드 밖에서 놓으면 click 이 지도로 오는데, 그건 새 노드를 찍으려는 게 아님
    if (suppressClick.current) { suppressClick.current = false; return }

    const p = pointerPx(e)
    const x = snap(toM(p.x))
    const y = snap(toM(p.y))

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

  // 노드·길 삭제. 노드를 지우면 이어진 길도 DB 가 같이 지움
  const remove = async (kind: 'nodes' | 'edges', id: number) => {
    const res = await fetch(`${API}/${kind}/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? '삭제하지 못함')
    } else {
      setError('')
    }
    setHover(null)
    if (kind === 'nodes' && selected === id) setSelected(null)
    await load()
  }

  const onDelete = () => { if (selected !== null) remove('nodes', selected) }

  // ---------- 맵 수정 탭: 선 그리기 · 지우개 · 영역 선택 ----------
  const pushUndo = () => setUndo(u => [...u.slice(-19), lines])   // 최근 20번까지 되돌리기

  const mapPoint = (e: React.MouseEvent<SVGSVGElement>): Pt => {
    const p = pointerPx(e)
    const step = tool === 'region' ? 0.5 : 0.05   // 영역은 0.5m, 선은 지도 해상도(0.05m)에 맞춤
    return {
      x: Math.min(VIEW_W, Math.max(0, gridSnap(toM(p.x), step))),
      y: Math.min(VIEW_H, Math.max(0, gridSnap(toM(p.y), step))),
    }
  }

  const mapDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!mapEditing || mapping || partial !== null) return
    e.preventDefault()
    const m = mapPoint(e)
    if (tool === 'erase') {
      let best: Line | null = null
      let bestD = ERASE_M
      for (const l of lines) {
        const d = distToSegment(m, l)
        if (d <= bestD) { best = l; bestD = d }
      }
      if (best) {
        const id = best.id
        pushUndo()
        setLines(ls => ls.filter(l => l.id !== id))
        setEditMsg('선 1개 지움')
      }
      return
    }
    setDraft({ a: m, b: m })
  }

  const mapMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draft) return
    setDraft({ a: draft.a, b: mapPoint(e) })
  }

  const mapUp = () => {
    if (!draft) return
    const { a, b } = draft
    setDraft(null)
    if (tool === 'line') {
      const l = buildLine(a, b, lines, straightOn, nextLineId.current++)
      if (!l) return
      pushUndo()
      setLines(ls => [...ls, l])
      setEditMsg('선 추가')
    } else if (tool === 'region') {
      const r = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
      if (r.x1 - r.x0 < 0.5 || r.y1 - r.y0 < 0.5) { setRegion(null); return }   // 너무 작으면 선택 해제
      setRegion(r)
      setEditMsg('')
    }
  }

  // 선택 영역(없으면 전체)에 들어가는 선인지: 선의 가운데 점 기준
  const inTarget = (l: Line) =>
    !region || (
      (l.x1 + l.x2) / 2 >= region.x0 && (l.x1 + l.x2) / 2 <= region.x1 &&
      (l.y1 + l.y2) / 2 >= region.y0 && (l.y1 + l.y2) / 2 <= region.y1
    )

  const onCleanUp = () => {
    const r = cleanUp(lines, inTarget)
    if (r.straightened === 0 && r.joined === 0) { setEditMsg('보정할 선이 없음'); return }
    pushUndo()
    setLines(r.lines)
    setEditMsg(`평평하게 ${r.straightened}개 · 끊긴 곳 ${r.joined}곳 연결`)
  }

  const onDashedToSolid = () => {
    const n = lines.filter(l => l.style === 'dashed' && inTarget(l)).length
    if (n === 0) { setEditMsg('점선이 없음'); return }
    pushUndo()
    setLines(ls => ls.map(l => l.style === 'dashed' && inTarget(l) ? { ...l, style: 'solid' } : l))
    setEditMsg(`점선 ${n}개를 실선으로`)
  }

  const onUndo = () => {
    const prev = undo[undo.length - 1]
    if (!prev) return
    setLines(prev)
    setUndo(u => u.slice(0, -1))
    setEditMsg('되돌림')
  }

  // 새 맵: 지도를 비우고 처음부터 매핑
  const onNewMap = () => {
    if (!window.confirm('현재 지도를 지우고 새 맵을 만듭니다. 계속할까요?')) return
    setMapping(false)
    setProgress(0)
    setSaveMsg('')
    setLines([])
    setUndo([])
    setRegion(null)
    setEditMsg('')
  }

  // ---------- 길 모드: 노드 근처에서 눌러 다른 노드 쪽으로 끌기 = 길 잇기 ----------
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tab === 'mapping') { mapDown(e); return }
    if (tab !== 'node') return
    const p = pointerPx(e)

    // 노드 모드: 노드 위에서 누르면 이동 준비 (실제로 움직여야 이동, 안 움직이면 클릭=선택)
    if (mode === 'node') {
      const hit = nearestNode(p)
      if (!hit || Math.hypot(toPx(hit.x) - p.x, toPx(hit.y) - p.y) > NODE_HIT) return
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
    if (tab === 'mapping') { mapMove(e); return }
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
    setDraft(null)
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
    if (tab === 'mapping') { mapUp(); return }
    if (moving) return finishMove()
    if (dragFrom === null) return
    const from = dragFrom
    const start = byId.get(from)
    const p = pointerPx(e)
    cancelDrag()

    // 누른 자리에서 거의 안 움직였으면 끌기가 아니라 클릭 → 길을 만들지 않음
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

  // 맵 수정에서 선을 끄는 중이면, 놓았을 때 어떻게 보정될지 미리 보여줌
  const draftLine = mapEditing && tool === 'line' && draft
    ? buildLine(draft.a, draft.b, lines, straightOn, -1)
    : null
  const draftRect = mapEditing && tool === 'region' && draft
    ? { x0: Math.min(draft.a.x, draft.b.x), y0: Math.min(draft.a.y, draft.b.y), x1: Math.max(draft.a.x, draft.b.x), y1: Math.max(draft.a.y, draft.b.y) }
    : null
  const shownRegion = draftRect ?? region

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
    mode === 'delete' && hover?.kind === 'node' && hover.id === id ? C_DEL_MODE   // 빨강: 지워질 노드
    : id === candidate?.id ? '#48bb78'   // 초록: 여기에 붙을 것
    : id === dragFrom    ? '#4299e1'   // 파랑: 끌기 시작한 노드
    : id === selected    ? '#ecc94b'   // 노랑: 선택된 노드
    : 'none'

  const zoomIdx = ZOOMS.indexOf(zoom)
  const svgEditable = tab === 'node' || mapEditing   // 지도를 눌러서 뭔가 할 수 있는 탭인지

  return (
    <div>
      <h1>노드 지도</h1>

      {/* row-reverse: 소스에서는 패널을 먼저 쓰지만 화면에서는 지도 오른쪽에 놓임. 좁은 화면에서는 줄이 바뀜 */}
      <div style={{ display: 'flex', flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: 16 }}>
      <aside style={{ width: 320, textAlign: 'left' }}>
        <div style={{ display: 'flex', marginBottom: 12 }}>
          {TABS.map((t, i) => (
            <button key={t.id} onClick={() => goTab(t.id)}
                    style={{ ...modeBtn(tab === t.id, i === 0 ? 'left' : i === TABS.length - 1 ? 'right' : 'mid', '#2d3748'), padding: '7px 12px', flex: 1 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'node' && (<>
      <p style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <span>
          <button onClick={() => changeMode('node')}
                  style={modeBtn(mode === 'node', 'left', C_NODE_MODE)}>
            노드 모드
          </button>
          <button onClick={() => changeMode('edge')}
                  style={modeBtn(mode === 'edge', 'mid', C_EDGE_MODE)}>
            길 모드
          </button>
          <button onClick={() => changeMode('delete')}
                  style={modeBtn(mode === 'delete', 'right', C_DEL_MODE)}>
            삭제 모드
          </button>
        </span>
        <b style={{ color: MODE_COLOR[mode] }}>현재: {MODE_LABEL[mode]}</b>
      </p>

      {mode === 'node' ? (
        <p>
          빈 곳 클릭 = 노드 추가 · 노드 클릭 = 선택 · 노드 끌기 = 이동 (격자 {GRID}m)
          {' '}
          <button onClick={onDelete} disabled={selected === null}>
            선택한 노드 삭제
          </button>
        </p>
      ) : mode === 'edge' ? (
        <p>
          노드 근처를 눌러 다른 노드 쪽으로 끌기 = 끈 방향으로 화살표 하나 · 반대로 또 끌면 양방(화살표 두 줄)
        </p>
      ) : (
        <p>
          화살표를 누르면 그 길이 · 노드를 누르면 그 노드(이어진 길 포함)가 <b style={{ color: C_DEL_MODE }}>바로 삭제</b>됨
        </p>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, fontSize: 14 }}>
        <label>
          <input type="checkbox" checked={mapOn} onChange={e => setMapOn(e.target.checked)} />
          {' '}매핑 지도 보이기
        </label>
      </div>
        </>)}

        {tab === 'manual' && (
          <div>
            <p style={{ color: '#718096', fontSize: 13 }}>더미 — 로봇에 연결 전. 누르면 마지막 명령만 바뀜</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 6, justifyContent: 'center' }}>
              <span />
              <button style={{ height: 48, fontSize: 20 }} onClick={() => setLastCmd('전진')}>▲</button>
              <span />
              <button style={{ height: 48, fontSize: 20 }} onClick={() => setLastCmd('좌회전')}>◀</button>
              <button style={{ height: 48, fontSize: 20 }} onClick={() => setLastCmd('정지')}>■</button>
              <button style={{ height: 48, fontSize: 20 }} onClick={() => setLastCmd('우회전')}>▶</button>
              <span />
              <button style={{ height: 48, fontSize: 20 }} onClick={() => setLastCmd('후진')}>▼</button>
              <span />
            </div>
            <p>마지막 명령: <b>{lastCmd}</b></p>
          </div>
        )}

        {tab === 'mapping' && (
          <div>
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <button onClick={() => { setMapTab('create'); setDraft(null) }}
                      style={{ ...modeBtn(mapTab === 'create', 'left', C_MAP_EDIT), flex: 1 }}>
                맵 생성
              </button>
              <button onClick={() => { setMapTab('edit'); setDraft(null) }}
                      style={{ ...modeBtn(mapTab === 'edit', 'right', C_MAP_EDIT), flex: 1 }}>
                맵 수정
              </button>
            </div>

            {mapTab === 'create' && (
              <div>
                <p style={{ color: '#718096', fontSize: 13 }}>
                  더미 — 실제로는 로봇이 라이다로 SLAM 매핑하고, 저장하면 맵 이름.png · 맵 이름.yaml 이 생김
                </p>
                <p>
                  맵 이름{' '}
                  <input value={mapName} onChange={e => setMapName(e.target.value)} style={{ width: 130 }} />
                  {' '}
                  <button onClick={onNewMap}>새 맵 만들기</button>
                </p>
                <p>
                  상태:{' '}
                  <b>{mapping ? `매핑 중 ${progress}%` : progress < 100 ? `중지됨 ${progress}%` : '완료 (100%)'}</b>
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button disabled={mapping}
                          onClick={() => { setProgress(0); setSaveMsg(''); setMapping(true) }}>
                    매핑 시작
                  </button>
                  <button disabled={!mapping} onClick={() => setMapping(false)}>중지</button>
                  <button disabled={mapping || progress === 0}
                          onClick={() => setSaveMsg(`저장됨 (더미) — ${mapName}.png · ${mapName}.yaml`)}>
                    지도 저장
                  </button>
                </div>
                {saveMsg && <p style={{ color: '#2f855a', fontSize: 13 }}>{saveMsg}</p>}
                <p style={{ fontSize: 13 }}>
                  로봇 좌표 (더미): R1 ({(progress / 100 * VIEW_W).toFixed(1)}, 6.0) · R2 (—, —)
                </p>
                <p style={{ fontSize: 13, color: '#4a5568' }}>
                  지도 파일: {MAP_IMG.src.split('/').pop()} · {MAP_IMG.w}×{MAP_IMG.h}px · {MAP_IMG.resolution} m/px
                </p>
              </div>
            )}

            {mapTab === 'edit' && (
              <div>
                <p style={{ color: '#718096', fontSize: 13 }}>
                  바뀐 곳(장애물 추가 등)만 고치려고 전체를 다시 매핑하지 않아도 되게 하는 도구. 수정 결과는 더미라 저장되지 않음
                </p>

                <div style={{ display: 'flex', marginBottom: 8 }}>
                  <button onClick={() => setTool('line')} style={{ ...modeBtn(tool === 'line', 'left', C_MAP_EDIT), padding: '6px 8px', flex: 1 }}>선 그리기</button>
                  <button onClick={() => setTool('erase')} style={{ ...modeBtn(tool === 'erase', 'mid', C_MAP_EDIT), padding: '6px 8px', flex: 1 }}>지우개</button>
                  <button onClick={() => setTool('region')} style={{ ...modeBtn(tool === 'region', 'right', C_MAP_EDIT), padding: '6px 8px', flex: 1 }}>영역 선택</button>
                </div>
                <p style={{ fontSize: 13, margin: '4px 0' }}>
                  {tool === 'line' && '끌어서 벽을 그림. 끝이 기존 선 끝에 가까우면 붙음'}
                  {tool === 'erase' && '지울 선을 누름'}
                  {tool === 'region' && '끌어서 영역을 고름 — 아래 보정과 부분 매핑이 이 영역에만 적용됨'}
                </p>
                <label style={{ fontSize: 14 }}>
                  <input type="checkbox" checked={straightOn} onChange={e => setStraightOn(e.target.checked)} />
                  {' '}그릴 때 자동 직선 보정
                </label>

                <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 8 }}>
                  <p style={{ fontSize: 13, margin: '0 0 6px' }}>
                    대상: <b>{region ? `선택 영역 ${(region.x1 - region.x0).toFixed(1)}×${(region.y1 - region.y0).toFixed(1)} m` : '지도 전체'}</b>
                    {region && <>{' '}<button onClick={() => setRegion(null)}>해제</button></>}
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={onCleanUp} disabled={partial !== null}>선 보정 (평평하게·연결)</button>
                    <button onClick={onDashedToSolid} disabled={partial !== null}>점선 → 실선</button>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 8 }}>
                  <button disabled={!region || partial !== null} onClick={() => { setEditMsg(''); setPartial(0) }}>
                    부분 매핑 시작 (더미)
                  </button>
                  {' '}
                  {partial !== null && <b>{partial}%</b>}
                  {!region && <span style={{ fontSize: 12, color: '#718096' }}> 영역을 먼저 선택</span>}
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button onClick={onUndo} disabled={undo.length === 0}>되돌리기</button>
                  <button onClick={() => setEditMsg('수정 저장됨 (더미)')}>수정 저장</button>
                </div>
                {editMsg && <p style={{ color: '#2f855a', fontSize: 13 }}>{editMsg}</p>}
              </div>
            )}
          </div>
        )}
      </aside>

      <div>
        {/* 확대·축소. 지도 내부 좌표는 그대로고 화면 크기만 바뀜 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <button onClick={() => setZoom(ZOOMS[Math.max(0, zoomIdx - 1)])} disabled={zoomIdx <= 0}>－</button>
          <span style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])} disabled={zoomIdx >= ZOOMS.length - 1}>＋</button>
          <button onClick={() => setZoom(1)} disabled={zoom === 1}>100%</button>
        </div>

        <div style={{ maxWidth: 'calc(100vw - 32px)', maxHeight: '78vh', overflow: 'auto', padding: 4 }}>
      <svg
        width={BOX_W * zoom}
        height={BOX_H * zoom}
        viewBox={`0 0 ${BOX_W} ${BOX_H}`}
        style={{
          display: 'block',
          background: '#f7fafc',
          cursor: tab === 'node' ? (mode === 'node' ? 'crosshair' : mode === 'edge' ? 'grab' : 'default')
                : mapEditing ? (tool === 'erase' ? 'pointer' : 'crosshair') : 'default',
          // 지도 테두리 색으로도 모드를 알림. outline 은 크기에 안 들어가서 클릭 좌표 계산이 안 어긋남
          outline: `3px solid ${tab === 'node' ? MODE_COLOR[mode] : mapEditing ? C_MAP_EDIT : '#a0aec0'}`,
          pointerEvents: svgEditable ? 'auto' : 'none',   // 노드 탭·맵 수정이 아니면 지도를 눌러도 편집 안 됨
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
                  markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10"
                  orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={C_ARROW} />
          </marker>
          <marker id="arrow-delete" viewBox="0 0 10 10" refX="10" refY="5"
                  markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10"
                  orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={C_DEL_MODE} />
          </marker>
          <marker id="arrow-preview" viewBox="0 0 10 10" refX="10" refY="5"
                  markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10"
                  orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4299e1" />
          </marker>
        </defs>

        {/* 맨 아래 레이어: 매핑 지도 이미지 + 라이다가 잡은 선들. 지도 한 칸 = resolution(m) 이라 20 x 12 m 영역에 딱 맞춤.
            매핑 탭에서는 진하게, 노드 탭에서는 흐리게. progress 만큼만 왼쪽부터 그려짐(더미) */}
        {(tab === 'mapping' || mapOn) && (
          <g opacity={tab === 'mapping' ? 1 : MAP_ALPHA} style={{ pointerEvents: 'none' }}>
            <clipPath id="mapped">
              <rect x={toPx(0)} y={toPx(0)} width={VIEW_W * SCALE * progress / 100} height={VIEW_H * SCALE} />
            </clipPath>
            <image href={MAP_IMG.src} x={toPx(0)} y={toPx(0)}
                   width={VIEW_W * SCALE} height={VIEW_H * SCALE}
                   preserveAspectRatio="none" clipPath="url(#mapped)"
                   style={{ imageRendering: 'pixelated' }} />
            {mapping && (
              <line x1={toPx(0) + VIEW_W * SCALE * progress / 100} y1={toPx(0)}
                    x2={toPx(0) + VIEW_W * SCALE * progress / 100} y2={toPx(VIEW_H)}
                    stroke="#ed8936" strokeWidth={3} />
            )}
            {lines.map(l => (
              <line key={l.id}
                    x1={toPx(l.x1)} y1={toPx(l.y1)} x2={toPx(l.x2)} y2={toPx(l.y2)}
                    stroke={l.style === 'solid' ? '#1a202c' : '#718096'}
                    strokeWidth={l.style === 'solid' ? 5 : 3}
                    strokeDasharray={l.style === 'dashed' ? '5 5' : undefined} />
            ))}
          </g>
        )}

        {/* 맵 수정: 선택 영역 / 부분 매핑 진행 / 그리는 중인 선 */}
        {mapEditing && shownRegion && (
          <g style={{ pointerEvents: 'none' }}>
            <rect x={toPx(shownRegion.x0)} y={toPx(shownRegion.y0)}
                  width={(shownRegion.x1 - shownRegion.x0) * SCALE} height={(shownRegion.y1 - shownRegion.y0) * SCALE}
                  fill={C_MAP_EDIT} fillOpacity={0.08} stroke={C_MAP_EDIT} strokeWidth={2} strokeDasharray="6 4" />
            {partial !== null && !draftRect && (
              <rect x={toPx(shownRegion.x0)} y={toPx(shownRegion.y0)}
                    width={(shownRegion.x1 - shownRegion.x0) * SCALE * partial / 100}
                    height={(shownRegion.y1 - shownRegion.y0) * SCALE}
                    fill={C_MAP_EDIT} fillOpacity={0.3} />
            )}
          </g>
        )}
        {mapEditing && draft && tool === 'line' && (
          <g style={{ pointerEvents: 'none' }}>
            {/* 파란 점선 = 내가 끈 그대로, 주황 실선 = 놓으면 보정되어 만들어질 선 */}
            <line x1={toPx(draft.a.x)} y1={toPx(draft.a.y)} x2={toPx(draft.b.x)} y2={toPx(draft.b.y)}
                  stroke="#4299e1" strokeWidth={2} strokeDasharray="5 4" />
            {draftLine && (
              <line x1={toPx(draftLine.x1)} y1={toPx(draftLine.y1)} x2={toPx(draftLine.x2)} y2={toPx(draftLine.y2)}
                    stroke={C_MAP_EDIT} strokeWidth={5} strokeOpacity={0.7} />
            )}
          </g>
        )}

        {tab !== 'mapping' && arrows.map(ar => {
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
          // 삭제 모드에서 마우스가 올라간 길은 빨갛게 (옛 both 길은 두 화살표가 같이 빨개짐)
          const doomed = mode === 'delete' && hover?.kind === 'edge' && hover.id === ar.edgeId

          return (
            <g key={ar.key}
               onClick={ev => {
                 ev.stopPropagation()
                 if (mode === 'delete') remove('edges', ar.edgeId)
               }}
               onMouseEnter={() => { if (mode === 'delete') setHover({ kind: 'edge', id: ar.edgeId }) }}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: mode === 'delete' ? 'pointer' : 'inherit' }}>
              {/* 보이는 선 */}
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={doomed ? C_DEL_MODE : C_ARROW} strokeWidth={doomed ? 3 : 2}
                    markerEnd={doomed ? 'url(#arrow-delete)' : 'url(#arrow)'}
                    style={{ pointerEvents: 'none' }} />
              {/* 안 보이는 두꺼운 선: 얇은 화살표도 대충 눌러서 잡히게 (삭제 모드에서만) */}
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="transparent" strokeWidth={12}
                    style={{ pointerEvents: mode === 'delete' ? 'stroke' : 'none' }} />
            </g>
          )
        })}

        {/* 끄는 동안 보이는 임시 선 */}
        {preview && (
          <line
            x1={preview.x1} y1={preview.y1} x2={preview.x2} y2={preview.y2}
            stroke="#4299e1" strokeWidth={2} strokeDasharray="6 4"
            markerEnd="url(#arrow-preview)"
            style={{ pointerEvents: 'none' }} />
        )}

        {tab !== 'mapping' && shownNodes.map(n => (
          <g key={n.id}
            onClick={e => {
              e.stopPropagation()                        // 지도 클릭으로 안 넘김
              if (mode === 'delete') { remove('nodes', n.id); return }
              if (mode !== 'node') return
              if (suppressClick.current) { suppressClick.current = false; return }   // 끌기 끝의 click 은 선택 아님
              setSelected(selected === n.id ? null : n.id) // 다시 누르면 선택 해제
            }}
            onMouseEnter={() => { if (mode === 'delete') setHover({ kind: 'node', id: n.id }) }}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: mode === 'node' ? 'grab' : mode === 'delete' ? 'pointer' : 'inherit' }}>
            <circle cx={toPx(n.x)} cy={toPx(n.y)} r={NODE_R}
                    fill={COLOR[n.type]}
                    stroke={ringColor(n.id)}
                    strokeWidth={3} />
            <text x={toPx(n.x)} y={toPx(n.y) + 3.5}
                  textAnchor="middle" fill="white"
                  fontSize={10} fontWeight="bold"
                  style={{ pointerEvents: 'none' }}>
              {n.name}
            </text>
          </g>
        ))}
      </svg>
        </div>

      {tab === 'mapping' && mapTab === 'edit' ? (
        <p style={{ fontSize: 13, color: '#4a5568' }}>
          <b style={{ color: '#1a202c' }}>검정 굵은 선</b> = 벽·장애물(실선)
          {' · '}
          <b style={{ color: '#718096' }}>회색 점선</b> = 라이다가 흐리게 잡은 것
        </p>
      ) : (
        <p style={{ fontSize: 13, color: '#4a5568' }}>
          <b style={{ color: C_ARROW }}>화살표 한 줄</b> = 그 방향으로만 갈 수 있음
          {' · '}
          <b style={{ color: C_ARROW }}>화살표 두 줄</b> = 양방(서로 반대 방향)
        </p>
      )}
      </div>
      </div>
    </div>
  )
}
