import { COLORS, GRID_SIZE, UNASSIGNED_GROUP_ID } from './constants'
import type { Interchange, LineGroup, LineNamingPattern, LineStyle, MetroLine, MetroMap, Station } from './types'

export const initialMap: MetroMap = {
  version: 1,
  title: 'New metro map',
  stations: [
    { id: 's1', name: 'Central', kind: 'station', x: 280, y: 360, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icons: [] },
    { id: 's2', name: 'Museum', kind: 'station', x: 480, y: 160, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icons: [] },
    { id: 's3', name: 'Harbor', kind: 'station', x: 680, y: 360, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icons: [] },
    { id: 's4', name: 'University', kind: 'station', x: 480, y: 560, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icons: [] },
  ],
  lines: [
    { id: 'l1', name: 'Blue Line', color: COLORS[1], style: 'solid', lineGroupId: 'g-metro', order: 0, stationIds: ['s1', 's2', 's3'] },
    { id: 'l2', name: 'Teal Line', color: COLORS[4], style: 'dashed', lineGroupId: 'g-metro', order: 1, stationIds: ['s1', 's4', 's3'] },
  ],
  lineGroups: [{ id: 'g-metro', name: 'Metro', style: 'solid', namingPattern: 'simple' }],
  termini: [],
}

export const cloneMap = (map: MetroMap): MetroMap => JSON.parse(JSON.stringify(map)) as MetroMap

export const nextId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const emptyMap = (): MetroMap => ({
  version: 1,
  title: 'New metro map',
  stations: [],
  lines: [],
  lineGroups: [{ id: nextId('g'), name: 'Metro', style: 'solid', namingPattern: 'simple' }],
  termini: [],
})

export function isWaypoint(station: Station) {
  return station.kind === 'waypoint'
}

export function stationIcons(station: Station) {
  return [...new Set(station.icons)]
}

export function normalizeMap(source: MetroMap): MetroMap {
  const stations = source.stations.map((station) => {
    const icons = stationIcons(station)
    return station.kind === 'waypoint'
      ? { ...station, icons, name: '' }
      : { ...station, icons }
  })
  const legacyGeneratedNames = new Set(source.lines
    .filter((line) => (line as MetroLine & { nameOverridden?: boolean }).nameOverridden === false)
    .map((line) => line.id))
  const lines = source.lines.map((line) => {
    const legacyStyleOverridden = (line as MetroLine & { styleOverridden?: boolean }).styleOverridden
    const normalized = Object.fromEntries(Object.entries(line).filter(([key]) => key !== 'styleOverridden' && key !== 'nameOverridden')) as MetroLine
    if (legacyStyleOverridden === false) delete normalized.style
    return normalized
  })
  const sourceGroups = source.lineGroups?.length
    ? source.lineGroups
    : [{ id: 'g-metro', name: 'Metro', style: 'solid' as LineStyle, namingPattern: 'simple' as LineNamingPattern }]
  const groups = sourceGroups.map((group) => ({
    ...group,
    style: group.style ?? 'solid' as LineStyle,
    namingPattern: group.namingPattern ?? 'simple' as LineNamingPattern,
  }))
  const firstGroup = groups[0]
  lines.forEach((line) => {
    const group = groups.find((candidate) => candidate.id === line.lineGroupId) ?? firstGroup
    if (!group) return
    line.lineGroupId = group.id
    if (legacyGeneratedNames.has(line.id) && group.namingPattern !== 'simple') delete line.name
  })
  const groupOrders = new Map<string, number>()
  lines.forEach((line) => {
    const groupId = line.lineGroupId ?? firstGroup?.id ?? ''
    const fallbackOrder = groupOrders.get(groupId) ?? 0
    if (!Number.isFinite(line.order)) line.order = fallbackOrder
    groupOrders.set(groupId, Math.max(fallbackOrder, line.order ?? fallbackOrder) + 1)
  })
  groups.forEach((group) => {
    if (group.namingPattern === 'simple' && lines.some((line) => line.lineGroupId === group.id && !line.name?.trim())) {
      throw new Error(`Line group "${group.name || group.id}" uses simple naming, so every line must have a name.`)
    }
  })
  const unassigned = groups.find((group) => group.id === UNASSIGNED_GROUP_ID)
  const orderedGroups = unassigned ? [unassigned, ...groups.filter((group) => group.id !== UNASSIGNED_GROUP_ID)] : groups
  return removeEmptyUnassigned({
    ...source,
    stations,
    lines,
    termini: Array.isArray(source.termini) ? source.termini : [],
    lineGroups: orderedGroups.length
      ? orderedGroups
      : [{ id: 'g-metro', name: 'Metro', style: 'solid', namingPattern: 'simple' }],
  })
}

export function alphabetName(index: number) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

export function generatedLineName(group: LineGroup, index: number) {
  if (group.namingPattern === 'alphabet') return `${group.namingPrefix ?? ''}${alphabetName(index)}`
  if (group.namingPattern === 'numbered') return `${group.namingPrefix ?? ''}${index + 1}`
  return `Line ${index + 1}`
}

export function effectiveLineStyle(line: MetroLine, groups: LineGroup[] = []) {
  return line.style ?? groups.find((group) => group.id === line.lineGroupId)?.style ?? 'solid'
}

export function effectiveLineName(line: MetroLine, groups: LineGroup[] = [], lines: MetroLine[] = []) {
  if (line.name !== undefined) return line.name
  const group = groups.find((candidate) => candidate.id === line.lineGroupId)
  if (!group || group.namingPattern === 'simple') return ''
  const index = lines
    .filter((candidate) => candidate.lineGroupId === line.lineGroupId)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
    .findIndex((candidate) => candidate.id === line.id)
  return generatedLineName(group, Math.max(0, index))
}

export function resetLineName(map: MetroMap, lineId: string): MetroMap {
  const line = map.lines.find((item) => item.id === lineId)
  const group = line && map.lineGroups?.find((item) => item.id === line.lineGroupId)
  if (!line || !group) return map
  const groupIndex = map.lines
    .filter((item) => item.lineGroupId === group.id)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
    .findIndex((item) => item.id === line.id)
  const name = group.namingPattern === 'simple' ? generatedLineName(group, Math.max(0, groupIndex)) : undefined
  return {
    ...map,
    lines: map.lines.map((item) => {
      if (item.id !== lineId) return item
      if (name !== undefined) return { ...item, name }
      const { name: _name, ...withoutName } = item
      return withoutName
    }),
  }
}

export function applyGroupNaming(
  map: MetroMap,
  groupId: string,
  patch: Partial<Pick<LineGroup, 'namingPattern' | 'namingPrefix'>>,
) {
  const groups = (map.lineGroups ?? []).map((group) => group.id === groupId ? { ...group, ...patch } : group)
  const group = groups.find((item) => item.id === groupId)
  if (!group) return { ...map, lineGroups: groups }
  return {
    ...map,
    lineGroups: groups,
  }
}

export function lineNameOrder(line: MetroLine, group: LineGroup) {
  if (group.namingPattern === 'numbered') {
    const number = Number.parseInt((line.name ?? '').slice((group.namingPrefix ?? '').length), 10)
    return Number.isNaN(number) ? Number.MAX_SAFE_INTEGER : number
  }

  if (group.namingPattern === 'alphabet') {
    const value = (line.name ?? '').slice((group.namingPrefix ?? '').length).toUpperCase()
    return value ? [...value].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) : Number.MAX_SAFE_INTEGER
  }

  return (line.name ?? '').toLocaleLowerCase()
}

export function deleteLineGroup(map: MetroMap, groupId: string) {
  const deleted = map.lineGroups?.find((group) => group.id === groupId)
  if (!deleted || deleted.ephemeral) return map
  const remainingGroups = (map.lineGroups ?? []).filter((group) => group.id !== groupId)
  const unassignedLines = map.lines.filter((line) => line.lineGroupId === groupId).map((line) => line.id)
  const existingUnassigned = remainingGroups.find((group) => group.id === UNASSIGNED_GROUP_ID)
  const unassigned = existingUnassigned
    ? { ...existingUnassigned, ephemeral: true }
    : { id: UNASSIGNED_GROUP_ID, name: 'Unassigned', style: 'solid' as LineStyle, namingPattern: 'simple' as LineNamingPattern, ephemeral: true }
  const groups = [unassigned, ...remainingGroups.filter((group) => group.id !== UNASSIGNED_GROUP_ID)]
  return {
    ...map,
    lines: map.lines.map((line) => unassignedLines.includes(line.id) ? { ...line, lineGroupId: UNASSIGNED_GROUP_ID } : line),
    lineGroups: groups,
  }
}

export function removeEmptyUnassigned(map: MetroMap) {
  return map.lineGroups?.some((group) => group.id === UNASSIGNED_GROUP_ID && !map.lines.some((line) => line.lineGroupId === UNASSIGNED_GROUP_ID))
    ? { ...map, lineGroups: map.lineGroups.filter((group) => group.id !== UNASSIGNED_GROUP_ID) }
    : map
}

export function moveLineToGroup(map: MetroMap, lineId: string, groupId: string) {
  const targetGroup = (map.lineGroups ?? []).find((item) => item.id === groupId)
  const targetIndex = targetGroup ? map.lines.filter((line) => line.lineGroupId === groupId).length : 0
  return removeEmptyUnassigned({
    ...map,
    lines: map.lines.map((item) => (
      item.id === lineId
        ? {
            ...item,
            lineGroupId: groupId,
            order: targetIndex,
            name: item.name ?? (targetGroup?.namingPattern === 'simple' ? generatedLineName(targetGroup, targetIndex) : undefined),
          }
        : item
    )),
  })
}

export function reorderLine(map: MetroMap, groupId: string, lineId: string, targetLineId: string) {
  const groupLines = map.lines
    .filter((line) => line.lineGroupId === groupId)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
  const sourceIndex = groupLines.findIndex((line) => line.id === lineId)
  const targetIndex = groupLines.findIndex((line) => line.id === targetLineId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return map
  const [moved] = groupLines.splice(sourceIndex, 1)
  groupLines.splice(targetIndex, 0, moved)
  const orders = new Map(groupLines.map((line, index) => [line.id, index]))
  return {
    ...map,
    lines: map.lines.map((line) => {
      if (!orders.has(line.id)) return line
      const order = orders.get(line.id) ?? 0
      return {
        ...line,
        order,
      }
    }),
  }
}

export function connectionKey(startId: string, endId: string) {
  return [startId, endId].sort().join('|')
}

export function isConnectionDeleted(line: MetroLine, startId: string, endId: string) {
  return line.deletedConnections?.includes(connectionKey(startId, endId)) ?? false
}

export function lineConnectionPairs(line: MetroLine) {
  const pairs = line.stationIds.slice(0, -1).map((startId, index) => ({ startId, endId: line.stationIds[index + 1] }))
  if (line.loop && line.stationIds.length > 2) pairs.push({ startId: line.stationIds[line.stationIds.length - 1], endId: line.stationIds[0] })
  return pairs
}

export function lineComponents(line: MetroLine) {
  const components: [number, number][] = []
  if (line.stationIds.length < 2) return components
  let start = 0
  line.stationIds.slice(0, -1).forEach((id, index) => {
    if (!isConnectionDeleted(line, id, line.stationIds[index + 1])) return
    if (index > start) components.push([start, index])
    start = index + 1
  })
  if (start < line.stationIds.length - 1) components.push([start, line.stationIds.length - 1])
  return components
}

export function connectedStationIds(line: MetroLine) {
  const ids = new Set<string>()
  lineComponents(line).forEach(([start, end]) => line.stationIds.slice(start, end + 1).forEach((id) => ids.add(id)))
  return ids
}

export function lineConnects(line: MetroLine, startId: string, endId: string) {
  return lineConnectionPairs(line).some((pair) => (
    ((pair.startId === startId && pair.endId === endId) || (pair.startId === endId && pair.endId === startId))
    && !isConnectionDeleted(line, pair.startId, pair.endId)
  ))
}

export function insertStationByProximity(line: MetroLine, stationId: string, stationsById: Map<string, Station>) {
  if (line.stationIds.length < 2) return [...line.stationIds, stationId]
  const station = stationsById.get(stationId)
  if (!station) return [...line.stationIds, stationId]
  let closestSegment = 0
  let closestDistance = Number.POSITIVE_INFINITY
  let closestProjection = 0
  let nearestStationIndex = 0
  let nearestStationDistance = Number.POSITIVE_INFINITY
  line.stationIds.forEach((id, index) => {
    const candidate = stationsById.get(id)
    if (!candidate) return
    const distance = Math.hypot(station.x - candidate.x, station.y - candidate.y)
    if (distance < nearestStationDistance) {
      nearestStationDistance = distance
      nearestStationIndex = index
    }
  })
  line.stationIds.slice(0, -1).forEach((startId, index) => {
    const start = stationsById.get(startId)
    const end = stationsById.get(line.stationIds[index + 1])
    if (!start || !end) return
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy || 1
    const projection = ((station.x - start.x) * dx + (station.y - start.y) * dy) / lengthSquared
    const clampedProjection = Math.max(0, Math.min(1, projection))
    const distance = Math.hypot(station.x - (start.x + clampedProjection * dx), station.y - (start.y + clampedProjection * dy))
    if (distance < closestDistance) {
      closestDistance = distance
      closestSegment = index
      closestProjection = projection
    }
  })
  if (nearestStationDistance <= closestDistance + GRID_SIZE && nearestStationIndex === 0) return [stationId, ...line.stationIds]
  if (nearestStationDistance <= closestDistance + GRID_SIZE && nearestStationIndex === line.stationIds.length - 1) return [...line.stationIds, stationId]
  if (closestSegment === 0 && closestProjection <= 0) return [stationId, ...line.stationIds]
  if (closestSegment === line.stationIds.length - 2 && closestProjection >= 1) return [...line.stationIds, stationId]
  return [...line.stationIds.slice(0, closestSegment + 1), stationId, ...line.stationIds.slice(closestSegment + 1)]
}

export function fallbackStationName(map: MetroMap, station: Station) {
  if (station.kind === 'waypoint') return ''
  const count = map.stations
    .filter((item) => item.kind === station.kind)
    .findIndex((item) => item.id === station.id) + 1
  return `Station ${count}`
}

export function mergeManualInterchange(groups: Interchange[], firstId: string, secondId: string) {
  const merged = groups.filter((group) => group.stations.some((station) => station.id === firstId || station.id === secondId))
  const remaining = groups.filter((group) => !merged.includes(group))
  const stations = merged.flatMap((group) => group.stations)
  const existing = new Map(stations.map((station) => [station.id, station.showName]))
  existing.set(firstId, existing.get(firstId) ?? true)
  existing.set(secondId, existing.get(secondId) ?? true)
  return [...remaining, { id: nextId('i'), stations: [...existing].map(([id, showName]) => ({ id, showName })) }]
}
