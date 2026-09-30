import { COLORS, GRID_SIZE, UNASSIGNED_GROUP_ID } from './constants'
import type { LineGroup, LineNamingPattern, LineStyle, MetroLine, MetroMap, Station } from './types'

export const initialMap: MetroMap = {
  version: 1,
  title: 'New metro map',
  stations: [
    { id: 's1', name: 'Central', x: 280, y: 360, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icon: 'none', ghost: false },
    { id: 's2', name: 'Museum', x: 480, y: 160, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icon: 'none', ghost: false },
    { id: 's3', name: 'Harbor', x: 680, y: 360, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icon: 'none', ghost: false },
    { id: 's4', name: 'University', x: 480, y: 560, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icon: 'none', ghost: false },
  ],
  lines: [
    { id: 'l1', name: 'Blue Line', color: COLORS[1], style: 'solid', styleOverridden: true, nameOverridden: true, groupId: 'g-metro', stationIds: ['s1', 's2', 's3'] },
    { id: 'l2', name: 'Teal Line', color: COLORS[4], style: 'dashed', styleOverridden: true, nameOverridden: true, groupId: 'g-metro', stationIds: ['s1', 's4', 's3'] },
  ],
  lineGroups: [{ id: 'g-metro', name: 'Metro', style: 'solid', namingPattern: 'simple', lineIds: ['l1', 'l2'] }],
}

export const cloneMap = (map: MetroMap): MetroMap => JSON.parse(JSON.stringify(map)) as MetroMap

export const nextId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const emptyMap = (): MetroMap => ({
  version: 1,
  title: 'New metro map',
  stations: [],
  lines: [],
  lineGroups: [{ id: nextId('g'), name: 'Metro', style: 'solid', namingPattern: 'simple', lineIds: [] }],
})

export function isWaypoint(station: Station) {
  return station.ghost === true || station.id.startsWith('w-')
}

export function stationIcons(station: Station) {
  return [...new Set([
    ...(station.icons ?? []),
    ...(station.icon === 'none' ? [] : [station.icon]),
  ])]
}

export function normalizeMap(source: MetroMap): MetroMap {
  const stations = source.stations.map((station) => {
    const icons = stationIcons(station)
    return isWaypoint(station)
      ? { ...station, icons, ghost: true, name: '', hideLabel: true }
      : { ...station, icons }
  })
  const lines = source.lines.map((line) => ({ ...line, styleOverridden: line.styleOverridden ?? true, nameOverridden: line.nameOverridden ?? true }))
  const sourceGroups = source.lineGroups?.length
    ? source.lineGroups
    : [{ id: 'g-metro', name: 'Metro', style: 'solid' as LineStyle, namingPattern: 'simple' as LineNamingPattern, lineIds: lines.map((line) => line.id) }]
  const groups = sourceGroups.map((group) => ({
    ...group,
    style: group.style ?? 'solid' as LineStyle,
    namingPattern: group.namingPattern ?? 'simple' as LineNamingPattern,
    lineIds: group.lineIds.filter((lineId) => lines.some((line) => line.id === lineId)),
  }))
  const firstGroup = groups[0]
  lines.forEach((line) => {
    const group = groups.find((candidate) => candidate.id === line.groupId || candidate.lineIds.includes(line.id)) ?? firstGroup
    if (!group) return
    if (!group.lineIds.includes(line.id)) group.lineIds.push(line.id)
    line.groupId = group.id
  })
  const unassigned = groups.find((group) => group.id === UNASSIGNED_GROUP_ID)
  const orderedGroups = unassigned ? [unassigned, ...groups.filter((group) => group.id !== UNASSIGNED_GROUP_ID)] : groups
  return removeEmptyUnassigned({
    ...source,
    stations,
    lines,
    lineGroups: orderedGroups.length
      ? orderedGroups
      : [{ id: 'g-metro', name: 'Metro', style: 'solid', namingPattern: 'simple', lineIds: lines.map((line) => line.id) }],
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

export function applyGroupNaming(
  map: MetroMap,
  groupId: string,
  patch: Partial<Pick<LineGroup, 'namingPattern' | 'namingPrefix'>>,
) {
  const groups = (map.lineGroups ?? []).map((group) => group.id === groupId ? { ...group, ...patch } : group)
  const group = groups.find((item) => item.id === groupId)
  if (!group) return { ...map, lineGroups: groups }
  const indexes = new Map(group.lineIds.map((lineId, index) => [lineId, index]))
  return {
    ...map,
    lineGroups: groups,
    lines: map.lines.map((line) => (
      line.groupId === groupId && !line.nameOverridden
        ? { ...line, name: generatedLineName(group, indexes.get(line.id) ?? 0) }
        : line
    )),
  }
}

export function lineNameOrder(line: MetroLine, group: LineGroup) {
  if (group.namingPattern === 'numbered') {
    const number = Number.parseInt(line.name.slice((group.namingPrefix ?? '').length), 10)
    return Number.isNaN(number) ? Number.MAX_SAFE_INTEGER : number
  }

  if (group.namingPattern === 'alphabet') {
    const value = line.name.slice((group.namingPrefix ?? '').length).toUpperCase()
    return value ? [...value].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) : Number.MAX_SAFE_INTEGER
  }

  return line.name.toLocaleLowerCase()
}

export function deleteLineGroup(map: MetroMap, groupId: string) {
  const deleted = map.lineGroups?.find((group) => group.id === groupId)
  if (!deleted || deleted.ephemeral) return map
  const danglingIds = new Set(deleted.lineIds)
  const remainingGroups = (map.lineGroups ?? []).filter((group) => group.id !== groupId)
  const unassignedLines = map.lines.filter((line) => danglingIds.has(line.id) || line.groupId === groupId).map((line) => line.id)
  const existingUnassigned = remainingGroups.find((group) => group.id === UNASSIGNED_GROUP_ID)
  const unassigned = existingUnassigned
    ? { ...existingUnassigned, ephemeral: true, lineIds: [...existingUnassigned.lineIds, ...unassignedLines.filter((lineId) => !existingUnassigned.lineIds.includes(lineId))] }
    : { id: UNASSIGNED_GROUP_ID, name: 'Unassigned', style: 'solid' as LineStyle, namingPattern: 'simple' as LineNamingPattern, lineIds: unassignedLines, ephemeral: true }
  const groups = [unassigned, ...remainingGroups.filter((group) => group.id !== UNASSIGNED_GROUP_ID)]
  return {
    ...map,
    lines: map.lines.map((line) => unassignedLines.includes(line.id) ? { ...line, groupId: UNASSIGNED_GROUP_ID } : line),
    lineGroups: groups,
  }
}

export function removeEmptyUnassigned(map: MetroMap) {
  return map.lineGroups?.some((group) => group.id === UNASSIGNED_GROUP_ID && group.lineIds.length === 0)
    ? { ...map, lineGroups: map.lineGroups.filter((group) => group.id !== UNASSIGNED_GROUP_ID) }
    : map
}

export function moveLineToGroup(map: MetroMap, lineId: string, groupId: string) {
  const targetGroup = (map.lineGroups ?? []).find((item) => item.id === groupId)
  const targetIndex = targetGroup?.lineIds.length ?? 0
  return removeEmptyUnassigned({
    ...map,
    lines: map.lines.map((item) => (
      item.id === lineId
        ? {
            ...item,
            groupId,
            name: item.nameOverridden || !targetGroup || targetGroup.namingPattern === 'simple'
              ? item.name
              : generatedLineName(targetGroup, targetIndex),
          }
        : item
    )),
    lineGroups: (map.lineGroups ?? []).map((item) => (
      item.id === groupId
        ? { ...item, lineIds: item.lineIds.includes(lineId) ? item.lineIds : [...item.lineIds, lineId] }
        : { ...item, lineIds: item.lineIds.filter((candidateLineId) => candidateLineId !== lineId) }
    )),
  })
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
  if (station.ghost) return ''
  const count = map.stations
    .filter((item) => Boolean(item.ghost) === Boolean(station.ghost))
    .findIndex((item) => item.id === station.id) + 1
  return station.ghost ? `Waypoint ${count}` : `Station ${count}`
}

export function mergeManualInterchange(groups: string[][], firstId: string, secondId: string) {
  const merged = groups.filter((group) => group.includes(firstId) || group.includes(secondId)).flat()
  const remaining = groups.filter((group) => !group.includes(firstId) && !group.includes(secondId))
  return [...remaining, [...new Set([...merged, firstId, secondId])]]
}
