import { connectionKey, isConnectionDeleted, lineConnectionPairs } from './map'
import type { MetroMap, RouteAnalysis } from './types'

export function getInterchangeIds(map: MetroMap) {
  const sharedEdges = new Map<string, [string, string]>()
  const edgeLineIds = new Map<string, Set<string>>()
  const stationLineIds = new Map<string, Set<string>>()
  const stationsById = new Map(map.stations.map((station) => [station.id, station]))

  map.lines.forEach((line) => {
    line.stationIds.forEach((stationId) => {
      const lineIds = stationLineIds.get(stationId) ?? new Set<string>()
      lineIds.add(line.id)
      stationLineIds.set(stationId, lineIds)
    })
    lineConnectionPairs(line).forEach(({ startId, endId }) => {
      if (isConnectionDeleted(line, startId, endId)) return
      const startLines = stationLineIds.get(startId) ?? new Set<string>()
      startLines.add(line.id)
      stationLineIds.set(startId, startLines)
      const endLines = stationLineIds.get(endId) ?? new Set<string>()
      endLines.add(line.id)
      stationLineIds.set(endId, endLines)
      const key = connectionKey(startId, endId)
      sharedEdges.set(key, [startId, endId])
      const edgeLines = edgeLineIds.get(key) ?? new Set<string>()
      edgeLines.add(line.id)
      edgeLineIds.set(key, edgeLines)
    })
  })

  const incidentSharedEdges = new Map<string, Set<string>>()
  sharedEdges.forEach(([startId, endId], key) => {
    if ((edgeLineIds.get(key)?.size ?? 0) < 2) return
    const startEdges = incidentSharedEdges.get(startId) ?? new Set<string>()
    startEdges.add(key)
    incidentSharedEdges.set(startId, startEdges)
    const endEdges = incidentSharedEdges.get(endId) ?? new Set<string>()
    endEdges.add(key)
    incidentSharedEdges.set(endId, endEdges)
  })

  const convergingIds = new Set([...stationLineIds]
    .filter(([stationId, lineIds]) => stationsById.get(stationId)?.kind !== 'waypoint' && lineIds.size > 1)
    .map(([stationId]) => stationId))

  incidentSharedEdges.forEach((edgeKeys, stationId) => {
    if (!convergingIds.has(stationId) || edgeKeys.size !== 2) return
    const [firstKey, secondKey] = [...edgeKeys]
    const firstLines = edgeLineIds.get(firstKey) ?? new Set<string>()
    const secondLines = edgeLineIds.get(secondKey) ?? new Set<string>()
    const stationLines = stationLineIds.get(stationId) ?? new Set<string>()
    const sameSharedLines = firstLines.size === secondLines.size && [...firstLines].every((lineId) => secondLines.has(lineId))
    const onlySharedLines = stationLines.size === firstLines.size && [...stationLines].every((lineId) => firstLines.has(lineId))
    if (sameSharedLines && onlySharedLines) convergingIds.delete(stationId)
  })

  map.stations.forEach((station) => {
    if (station.interchangeStyle === 'converging') convergingIds.add(station.id)
    if (station.interchangeStyle === 'regular') convergingIds.delete(station.id)
  })

  return convergingIds
}

export function shortestRoute(map: MetroMap, from: string, to: string) {
  if (from === to) return [from]
  const graph = new Map<string, Set<string>>()
  map.lines.forEach((line) => {
    line.stationIds.forEach((id) => { if (!graph.has(id)) graph.set(id, new Set()) })
    lineConnectionPairs(line).forEach(({ startId, endId }) => {
      if (isConnectionDeleted(line, startId, endId)) return
      graph.get(startId)?.add(endId)
      graph.get(endId)?.add(startId)
    })
  })
  ;(map.manualInterchanges ?? []).forEach((group) => group.forEach((id) => {
    group.forEach((otherId) => {
      if (id !== otherId && graph.has(id) && graph.has(otherId)) graph.get(id)?.add(otherId)
    })
  }))
  const queue = [from]
  const previous = new Map<string, string | null>([[from, null]])
  while (queue.length) {
    const current = queue.shift()!
    for (const next of graph.get(current) ?? []) {
      if (previous.has(next)) continue
      previous.set(next, current)
      queue.push(next)
      if (next === to) {
        const path = [to]
        let cursor: string | null = to
        while (previous.get(cursor) !== null) {
          cursor = previous.get(cursor)!
          path.unshift(cursor)
        }
        return path
      }
    }
  }
  return []
}

export function analyzeRoutes(map: MetroMap, junctionIds: Set<string>): RouteAnalysis[] {
  type RouteNode = { stationId: string; lineId: string }
  type RouteEdge = { node: string; cost: number; kind: 'travel' | 'junction' | 'interchange' }

  const nodes = new Map<string, RouteNode>()
  const graph = new Map<string, RouteEdge[]>()
  const lineIdsByStation = new Map<string, Set<string>>()
  const nodeKey = (stationId: string, lineId: string) => `${stationId}|${lineId}`
  const addNode = (stationId: string, lineId: string) => {
    const key = nodeKey(stationId, lineId)
    nodes.set(key, { stationId, lineId })
    if (!graph.has(key)) graph.set(key, [])
    const lineIds = lineIdsByStation.get(stationId) ?? new Set<string>()
    lineIds.add(lineId)
    lineIdsByStation.set(stationId, lineIds)
    return key
  }
  const addEdge = (from: string, to: string, cost: number, kind: RouteEdge['kind']) => {
    graph.get(from)?.push({ node: to, cost, kind })
    graph.get(to)?.push({ node: from, cost, kind })
  }

  map.lines.forEach((line) => {
    line.stationIds.forEach((stationId) => addNode(stationId, line.id))
    lineConnectionPairs(line).forEach(({ startId, endId }) => {
      if (isConnectionDeleted(line, startId, endId)) return
      addEdge(nodeKey(startId, line.id), nodeKey(endId, line.id), 0, 'travel')
    })
  })
  lineIdsByStation.forEach((lineIds, stationId) => {
    const ids = [...lineIds]
    ids.forEach((fromLineId, index) => ids.slice(index + 1).forEach((toLineId) => {
      addEdge(nodeKey(stationId, fromLineId), nodeKey(stationId, toLineId), 1, 'junction')
    }))
  })
  ;(map.manualInterchanges ?? []).forEach((group) => group.forEach((fromStationId, index) => group.slice(index + 1).forEach((toStationId) => {
    const fromLines = lineIdsByStation.get(fromStationId) ?? new Set<string>()
    const toLines = lineIdsByStation.get(toStationId) ?? new Set<string>()
    fromLines.forEach((fromLineId) => toLines.forEach((toLineId) => {
      addEdge(nodeKey(fromStationId, fromLineId), nodeKey(toStationId, toLineId), fromLineId === toLineId ? 0 : 1, 'interchange')
    }))
  })))

  const stationIds = map.stations.filter((station) => station.kind === 'station').map((station) => station.id)
  const routes: RouteAnalysis[] = []

  stationIds.forEach((fromId, fromIndex) => {
    stationIds.slice(fromIndex + 1).forEach((toId) => {
      const fromLines = lineIdsByStation.get(fromId) ?? new Set<string>()
      const toLines = lineIdsByStation.get(toId) ?? new Set<string>()
      if ([...fromLines].some((lineId) => toLines.has(lineId))) return

      const distances = new Map<string, number>()
      const previous = new Map<string, { node: string; kind: RouteEdge['kind'] }>()
      const queue: { node: string; distance: number }[] = []
      fromLines.forEach((lineId) => {
        const key = nodeKey(fromId, lineId)
        distances.set(key, 0)
        queue.push({ node: key, distance: 0 })
      })

      while (queue.length) {
        queue.sort((left, right) => left.distance - right.distance)
        const current = queue.shift()!
        if (current.distance !== distances.get(current.node)) continue
        graph.get(current.node)?.forEach((edge) => {
          const nextDistance = current.distance + edge.cost
          if (nextDistance < (distances.get(edge.node) ?? Number.POSITIVE_INFINITY)) {
            distances.set(edge.node, nextDistance)
            previous.set(edge.node, { node: current.node, kind: edge.kind })
            queue.push({ node: edge.node, distance: nextDistance })
          }
        })
      }

      const target = [...toLines]
        .map((lineId) => nodeKey(toId, lineId))
        .filter((key) => distances.has(key))
        .sort((left, right) => distances.get(left)! - distances.get(right)!)[0]
      if (!target) return

      const path: string[] = []
      let cursor: string | undefined = target
      while (cursor) {
        path.unshift(cursor)
        cursor = previous.get(cursor)?.node
      }
      const pathNodes = path.map((key) => nodes.get(key)!)
      const lineIds: string[] = []
      const transfers: RouteAnalysis['transfers'] = []
      pathNodes.forEach((node, index) => {
        if (pathNodes[index - 1]?.lineId !== node.lineId) lineIds.push(node.lineId)
        const previousNode = pathNodes[index - 1]
        if (previousNode && previousNode.lineId !== node.lineId) {
          transfers.push({
            stationId: previousNode.stationId,
            type: junctionIds.has(previousNode.stationId) ? 'junction' : 'interchange',
          })
        }
      })
      routes.push({ fromId, toId, changes: transfers.length, lineIds, transfers })
    })
  })

  return routes.sort((left, right) => (
    right.changes - left.changes
    || left.fromId.localeCompare(right.fromId)
    || left.toId.localeCompare(right.toId)
  ))
}
