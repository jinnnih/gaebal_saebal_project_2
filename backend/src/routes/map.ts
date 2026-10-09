import { Router } from 'express'
import { pool } from '../db/pool.ts'

export const mapRouter = Router()

const NODE_TYPES = ['normal', 'charge', 'load', 'wait']

// 두 노드 사이 거리(미터). 서버만 계산함
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y)

// ---------- 조회 ----------
mapRouter.get('/map', async (_req, res) => {
  const [nodes] = await pool.query('SELECT * FROM node')
  const [edges] = await pool.query('SELECT * FROM edge')
  res.json({ nodes, edges })
})

// ---------- 노드 ----------
mapRouter.post('/nodes', async (req, res) => {
  const { name, x, y, type = 'normal' } = req.body
  if (typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'name 이 필요함' })
  if (typeof x !== 'number' || typeof y !== 'number')
    return res.status(400).json({ error: 'x, y 는 숫자여야 함' })
  if (!NODE_TYPES.includes(type))
    return res.status(400).json({ error: `type 은 ${NODE_TYPES.join('/')} 중 하나` })

  try {
    const [r]: any = await pool.query(
      'INSERT INTO node (name, x, y, type) VALUES (?, ?, ?, ?)',
      [name.trim(), x, y, type])
    res.status(201).json({ id: r.insertId, name: name.trim(), x, y, type })
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: '같은 이름의 노드가 이미 있음' })
    throw e
  }
})

mapRouter.delete('/nodes/:id', async (req, res) => {
  // TODO(5단계): 점유 중이거나 경로에 들어 있는 노드는 삭제 거부
  const [r]: any = await pool.query('DELETE FROM node WHERE id = ?', [req.params.id])
  if (r.affectedRows === 0) return res.status(404).json({ error: '없는 노드' })
  res.status(204).end()   // 연결된 길은 DB 의 ON DELETE CASCADE 가 지움
})

// ---------- 길 ----------
mapRouter.post('/edges', async (req, res) => {
  const { from_node, to_node, direction = 'both' } = req.body
  if (!Number.isInteger(from_node) || !Number.isInteger(to_node))
    return res.status(400).json({ error: 'from_node, to_node 는 정수' })
  if (from_node === to_node)
    return res.status(400).json({ error: '같은 노드끼리는 이을 수 없음' })
  if (!['one', 'both'].includes(direction))
    return res.status(400).json({ error: 'direction 은 one/both' })

  const [rows]: any = await pool.query(
    'SELECT id, x, y FROM node WHERE id IN (?, ?)', [from_node, to_node])
  if (rows.length !== 2) return res.status(404).json({ error: '없는 노드가 있음' })

  const a = rows.find((n: any) => n.id === from_node)
  const b = rows.find((n: any) => n.id === to_node)
  const distance = dist(a, b)

  const [r]: any = await pool.query(
    'INSERT INTO edge (from_node, to_node, direction, distance) VALUES (?, ?, ?, ?)',
    [from_node, to_node, direction, distance])
  res.status(201).json({ id: r.insertId, from_node, to_node, direction, distance })
})

mapRouter.delete('/edges/:id', async (req, res) => {
  const [r]: any = await pool.query('DELETE FROM edge WHERE id = ?', [req.params.id])
  if (r.affectedRows === 0) return res.status(404).json({ error: '없는 길' })
  res.status(204).end()
})