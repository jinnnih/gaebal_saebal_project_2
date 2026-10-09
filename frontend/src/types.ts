export type NodeType = 'normal' | 'charge' | 'load' | 'wait'

export type MapNode = {
  id: number
  name: string
  x: number          // 미터, 지도 원점 기준
  y: number
  type: NodeType
}

export type MapEdge = {
  id: number
  from_node: number  // MapNode.id
  to_node: number
  direction: 'one' | 'both'
  distance: number   // 미터
}