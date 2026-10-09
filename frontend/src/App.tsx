import { useEffect, useState } from 'react'
import type { MapNode, MapEdge } from './types'
import './App.css'

const API = 'http://localhost:3000/api'

const SCALE = 40     // 1미터 = 40픽셀
const PAD = 60       // 가장자리 여백(픽셀)
const GRID = 0.5     // 노드를 찍을 때 붙일 격자 간격(미터)
const VIEW_W = 20    // 지도 영역 가로(미터)
const VIEW_H = 12    // 지도 영역 세로(미터)

const COLOR = {
  normal: '#4a5568',
  charge: '#38a169',
  load:   '#dd6b20',
  wait:   '#3182ce',
}

const toPx = (m: number) => m * SCALE + PAD          // 미터 → 픽셀 (그릴 때)
const toM  = (px: number) => (px - PAD) / SCALE      // 픽셀 → 미터 (클릭할 때)
const snap = (m: number) => Math.round(m / GRID) * GRID

export default function App() {
  const [nodes, setNodes] = useState<MapNode[]>([])
  const [edges, setEdges] = useState<MapEdge[]>([])
  const [error, setError] = useState('')

  const load = () =>
    fetch(`${API}/map`)
      .then(res => res.json())
      .then(data => { setNodes(data.nodes); setEdges(data.edges) })

  useEffect(() => { load() }, [])

  // 빈 곳을 클릭하면 그 자리에 노드를 추가
  const onMapClick = async (e: React.MouseEvent<SVGSVGElement>) => {
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

  const byId = new Map(nodes.map(n => [n.id, n]))

  return (
    <div>
      <h1>노드 지도</h1>
      <p>빈 곳을 클릭하면 노드가 생깁니다 (격자 {GRID}m)</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <svg
        width={VIEW_W * SCALE + PAD * 2}
        height={VIEW_H * SCALE + PAD * 2}
        style={{ background: '#f7fafc', cursor: 'crosshair' }}
        onClick={onMapClick}
      >
        {edges.map(e => {
          const a = byId.get(e.from_node)
          const b = byId.get(e.to_node)
          if (!a || !b) return null
          return (
            <line key={e.id}
              x1={toPx(a.x)} y1={toPx(a.y)}
              x2={toPx(b.x)} y2={toPx(b.y)}
              stroke="#cbd5e0" strokeWidth={6} />
          )
        })}

        {nodes.map(n => (
          <g key={n.id}>
            <circle cx={toPx(n.x)} cy={toPx(n.y)} r={18} fill={COLOR[n.type]} />
            <text x={toPx(n.x)} y={toPx(n.y) + 5}
                  textAnchor="middle" fill="white"
                  fontSize={14} fontWeight="bold"
                  style={{ pointerEvents: 'none' }}>
              {n.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}