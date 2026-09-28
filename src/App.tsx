import { forwardRef, startTransition, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import yaml from 'js-yaml'

type Point = { x: number; y: number }
type Viewport = { x: number; y: number; scale: number }
type Tool = 'select' | 'station' | 'waypoint' | 'frame'
type LineStyle = 'solid' | 'dashed' | 'dotted' | 'hollow'
type LineNamingPattern = 'simple' | 'alphabet' | 'numbered'
type StationIcon = 'none' | 'train' | 'bus' | 'plane' | 'ship'
type StationDragState = { type: 'station' | 'label'; id: string; offset: Point }
type DragEditState = StationDragState | { type: 'line-label'; id: string; offset: Point; group?: boolean }
type DragState = DragEditState | { type: 'pan'; start: Point; viewport: Viewport } | null

type Station = {
  id: string
  name: string
  ghost?: boolean
  interchangeStyle?: 'regular' | 'converging'
  x: number
  y: number
  labelOffset: Point
  labelAngle?: number
  hideLabel?: boolean
  icon: StationIcon
}

type MetroLine = {
  id: string
  name: string
  color: string
  style: LineStyle
  styleOverridden?: boolean
  nameOverridden?: boolean
  groupId?: string
  stationIds: string[]
  loop?: boolean
  deletedConnections?: string[]
}

type LineGroup = {
  id: string
  name: string
  style: LineStyle
  namingPattern: LineNamingPattern
  namingPrefix?: string
  lineIds: string[]
  ephemeral?: boolean
}

type MetroMap = {
  version: 1
  title: string
  stations: Station[]
  lines: MetroLine[]
  lineGroups?: LineGroup[]
  manualInterchanges?: string[][]
  lineLabelOffsets?: Record<string, Point>
  terminusLabelOffsets?: Record<string, Point>
}

type LineEndpointLabel = {
  key: string
  groupKey: string
  group: boolean
  station: Station
  label: string
  center: Point
  width: number
  height: number
  color: string
}

type RouteAnalysis = {
  fromId: string
  toId: string
  changes: number
  lineIds: string[]
  transfers: { stationId: string; type: 'junction' | 'interchange' }[]
}

const COLORS = ['#ef476f', '#118ab2', '#f59e0b', '#8b5cf6', '#0f766e']
const LABEL_ANGLES = Array.from({ length: 8 }, (_, index) => index * 45)
const LABEL_DISTANCE = 30
const CARDINAL_LABEL_DISTANCE = 26

function labelOffsetForAngle(angle: number): Point {
  const radians = angle * Math.PI / 180
  const distance = angle % 90 === 0 ? CARDINAL_LABEL_DISTANCE : LABEL_DISTANCE
  return { x: Math.sin(radians) * distance, y: -Math.cos(radians) * distance }
}

function nearestLabelAngle(offset: Point): number {
  const radians = Math.atan2(offset.x, -offset.y)
  const angle = (radians * 180 / Math.PI + 360) % 360
  return Math.round(angle / 45) * 45 % 360
}

function stationLabelOffset(station: Station): Point {
  return station.labelAngle === undefined ? station.labelOffset : labelOffsetForAngle(station.labelAngle)
}

const COLOR_PRESETS = [
  { color: COLORS[0], name: 'Red' },
  { color: COLORS[1], name: 'Blue' },
  { color: COLORS[2], name: 'Orange' },
  { color: COLORS[3], name: 'Purple' },
  { color: COLORS[4], name: 'Teal' },
  { color: '#facc15', name: 'Yellow' },
  { color: '#38bdf8', name: 'Light blue' },
  { color: '#92400e', name: 'Brown' },
  { color: '#9ca3af', name: 'Grey' },
  { color: '#111827', name: 'Black' },
]
const WORKSPACE = { width: 1000, height: 680 }
const GRID_SIZE = 40
const UNASSIGNED_GROUP_ID = 'g-unassigned'
const initialMap: MetroMap = {
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

const cloneMap = (map: MetroMap): MetroMap => JSON.parse(JSON.stringify(map)) as MetroMap
const emptyMap = (): MetroMap => ({ version: 1, title: 'New metro map', stations: [], lines: [], lineGroups: [{ id: nextId('g'), name: 'Metro', style: 'solid', namingPattern: 'simple', lineIds: [] }] })
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
function normalizeMap(source: MetroMap): MetroMap {
  const stations = source.stations.map((station) => isWaypoint(station) ? { ...station, ghost: true, name: '', hideLabel: true } : station)
  const lines = source.lines.map((line) => ({ ...line, styleOverridden: line.styleOverridden ?? true, nameOverridden: line.nameOverridden ?? true }))
  const sourceGroups = source.lineGroups?.length ? source.lineGroups : [{ id: 'g-metro', name: 'Metro', style: 'solid' as LineStyle, namingPattern: 'simple' as LineNamingPattern, lineIds: lines.map((line) => line.id) }]
  const groups = sourceGroups.map((group) => ({ ...group, style: group.style ?? 'solid' as LineStyle, namingPattern: group.namingPattern ?? 'simple' as LineNamingPattern, lineIds: group.lineIds.filter((lineId) => lines.some((line) => line.id === lineId)) }))
  const firstGroup = groups[0]
  lines.forEach((line) => {
    const group = groups.find((candidate) => candidate.id === line.groupId || candidate.lineIds.includes(line.id)) ?? firstGroup
    if (!group) return
    if (!group.lineIds.includes(line.id)) group.lineIds.push(line.id)
    line.groupId = group.id
  })
  const unassigned = groups.find((group) => group.id === UNASSIGNED_GROUP_ID)
  const orderedGroups = unassigned ? [unassigned, ...groups.filter((group) => group.id !== UNASSIGNED_GROUP_ID)] : groups
  return removeEmptyUnassigned({ ...source, stations, lines, lineGroups: orderedGroups.length ? orderedGroups : [{ id: 'g-metro', name: 'Metro', style: 'solid', namingPattern: 'simple', lineIds: lines.map((line) => line.id) }] })
}

function alphabetName(index: number) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

function generatedLineName(group: LineGroup, index: number) {
  if (group.namingPattern === 'alphabet') return `${group.namingPrefix ?? ''}${alphabetName(index)}`
  if (group.namingPattern === 'numbered') return `${group.namingPrefix ?? ''}${index + 1}`
  return `Line ${index + 1}`
}

function applyGroupNaming(map: MetroMap, groupId: string, patch: Partial<Pick<LineGroup, 'namingPattern' | 'namingPrefix'>>) {
  const groups = (map.lineGroups ?? []).map((group) => group.id === groupId ? { ...group, ...patch } : group)
  const group = groups.find((item) => item.id === groupId)
  if (!group) return { ...map, lineGroups: groups }
  const indexes = new Map(group.lineIds.map((lineId, index) => [lineId, index]))
  return { ...map, lineGroups: groups, lines: map.lines.map((line) => line.groupId === groupId && !line.nameOverridden ? { ...line, name: generatedLineName(group, indexes.get(line.id) ?? 0) } : line) }
}

function lineNameOrder(line: MetroLine, group: LineGroup) {
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

function deleteLineGroup(map: MetroMap, groupId: string) {
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
  return { ...map, lines: map.lines.map((line) => unassignedLines.includes(line.id) ? { ...line, groupId: UNASSIGNED_GROUP_ID } : line), lineGroups: groups }
}

function removeEmptyUnassigned(map: MetroMap) {
  return map.lineGroups?.some((group) => group.id === UNASSIGNED_GROUP_ID && group.lineIds.length === 0)
    ? { ...map, lineGroups: map.lineGroups.filter((group) => group.id !== UNASSIGNED_GROUP_ID) }
    : map
}

export default function App() {
  const [map, setMap] = useState<MetroMap>(cloneMap(initialMap))
  const [tool, setTool] = useState<Tool>('select')
  const [selectedStationId, setSelectedStationId] = useState<string | null>('s1')
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>(['s1'])
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>('g-metro')
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([])
  const [selectedConnection, setSelectedConnection] = useState<{ lineId: string; startId: string; endId: string } | null>(null)
  const [stationNavigationLineId, setStationNavigationLineId] = useState<string | null>('l1')
  const [activeLineId, setActiveLineId] = useState<string | null>(null)
  const [placementLineId, setPlacementLineId] = useState<string | null>(null)
  const [interchangeAnchorId, setInterchangeAnchorId] = useState<string | null>(null)
  const [routeFrom, setRouteFrom] = useState('s1')
  const [routeTo, setRouteTo] = useState('s3')
  const [route, setRoute] = useState<string[]>([])
  const [status, setStatus] = useState('Ready')
  const [showHelp, setShowHelp] = useState(false)
  const [showDeleteLineConfirm, setShowDeleteLineConfirm] = useState(false)
  const [statsReport, setStatsReport] = useState<{ lines: number; stations: number; interchanges: number; routes: RouteAnalysis[] } | null>(null)
  const [statsChangeFilter, setStatsChangeFilter] = useState<number | ''>('')
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [undoCount, setUndoCount] = useState(0)
  const [shimmerPhase, setShimmerPhase] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [drag, setDrag] = useState<DragState>(null)
  const mapRef = useRef(map)
  const undoStackRef = useRef<MetroMap[]>([])
  const dragHistoryRef = useRef<MetroMap | null>(null)
  const pendingDragPointRef = useRef<Point | null>(null)
  const dragUpdateFrameRef = useRef<number | null>(null)
  const drawFrameRef = useRef<number | null>(null)
  const [frameSelection, setFrameSelection] = useState<{ start: Point; end: Point } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stationNameInputRef = useRef<HTMLInputElement>(null)
  const lineNameInputRef = useRef<HTMLInputElement>(null)
  const groupNameInputRef = useRef<HTMLInputElement>(null)
  const stationLineSelectRef = useRef<HTMLInputElement>(null)
  const lineGroupSelectRef = useRef<HTMLButtonElement>(null)
  const lineStyleSelectRef = useRef<HTMLButtonElement>(null)
  const focusNewStationIdRef = useRef<string | null>(null)
  const focusNewLineIdRef = useRef<string | null>(null)
  const focusNewGroupIdRef = useRef<string | null>(null)

  const selectedStation = map.stations.find((station) => station.id === selectedStationId)
  const selectedLine = map.lines.find((line) => line.id === selectedLineId)
  const selectedGroup = map.lineGroups?.find((group) => group.id === selectedGroupId)
  const selectedGroupLines = useMemo(() => {
    if (!selectedGroup) return []
    return map.lines.filter((line) => line.groupId === selectedGroup.id).sort((left, right) => {
      const leftOrder = lineNameOrder(left, selectedGroup)
      const rightOrder = lineNameOrder(right, selectedGroup)
      return typeof leftOrder === 'number' && typeof rightOrder === 'number' ? leftOrder - rightOrder : String(leftOrder).localeCompare(String(rightOrder))
    })
  }, [map.lines, selectedGroup])
  const stationsById = useMemo(() => new Map(map.stations.map((station) => [station.id, station])), [map.stations])
  const interchangeIds = useMemo(() => {
    const sharedEdges = new Map<string, [string, string]>()
    const edgeLineIds = new Map<string, Set<string>>()
    const stationLineIds = new Map<string, Set<string>>()
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
      .filter(([stationId, lineIds]) => !stationsById.get(stationId)?.ghost && lineIds.size > 1)
      .map(([stationId]) => stationId))
    incidentSharedEdges.forEach((edgeKeys, stationId) => {
      if (!convergingIds.has(stationId) || edgeKeys.size !== 2) return
      const [firstKey, secondKey] = [...edgeKeys]
      const firstLines = edgeLineIds.get(firstKey) ?? new Set<string>()
      const secondLines = edgeLineIds.get(secondKey) ?? new Set<string>()
      const stationLines = stationLineIds.get(stationId) ?? new Set<string>()
      const sameSharedLines = firstLines.size === secondLines.size && [...firstLines].every((lineId) => secondLines.has(lineId))
      const onlySharedLines = stationLines.size === firstLines.size && [...stationLines].every((lineId) => firstLines.has(lineId))
      if (sameSharedLines && onlySharedLines) {
        convergingIds.delete(stationId)
      }
    })
    map.stations.forEach((station) => {
      if (station.interchangeStyle === 'converging') convergingIds.add(station.id)
      if (station.interchangeStyle === 'regular') convergingIds.delete(station.id)
    })
    return convergingIds
  }, [map.lines, stationsById])
  useEffect(() => {
    if (drawFrameRef.current !== null) cancelAnimationFrame(drawFrameRef.current)
    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = null
      drawMap(canvasRef.current, map, interchangeIds, route, selectedStationIds, selectedLineId, selectedConnection, snapToGrid, shimmerPhase, viewport, frameSelection)
    })
    return () => {
      if (drawFrameRef.current !== null) cancelAnimationFrame(drawFrameRef.current)
    }
  }, [map, interchangeIds, route, selectedStationIds, selectedLineId, selectedConnection, snapToGrid, shimmerPhase, viewport, frameSelection])

  useEffect(() => {
    if (!selectedLineId) return
    let frame = 0
    const startedAt = performance.now()
    const animate = (now: number) => {
      setShimmerPhase((now - startedAt) / 1000)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [selectedLineId])

  useEffect(() => {
    if (!focusNewStationIdRef.current || focusNewStationIdRef.current !== selectedStationId) return
    const frame = requestAnimationFrame(() => {
      const station = map.stations.find((item) => item.id === selectedStationId)
      if (station?.ghost) {
        stationLineSelectRef.current?.focus()
      } else {
        stationNameInputRef.current?.focus()
        stationNameInputRef.current?.select()
      }
      focusNewStationIdRef.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedStationId, map.stations])

  useEffect(() => {
    if (!focusNewLineIdRef.current || focusNewLineIdRef.current !== selectedLineId) return
    lineNameInputRef.current?.focus()
    lineNameInputRef.current?.select()
    focusNewLineIdRef.current = null
  }, [selectedLineId, map.lines])

  useEffect(() => {
    if (!focusNewGroupIdRef.current || focusNewGroupIdRef.current !== selectedGroupId || selectedLineId) return
    groupNameInputRef.current?.focus()
    groupNameInputRef.current?.select()
    focusNewGroupIdRef.current = null
  }, [selectedGroupId, selectedLineId, map.lineGroups])

  const pushUndoSnapshot = (snapshot: MetroMap) => {
    undoStackRef.current = [...undoStackRef.current, cloneMap(snapshot)].slice(-5)
    setUndoCount(undoStackRef.current.length)
  }
  const updateMap = (updater: (current: MetroMap) => MetroMap, recordHistory = true) => {
    const current = mapRef.current
    const next = updater(current)
    if (next === current) return
    if (recordHistory) pushUndoSnapshot(current)
    mapRef.current = next
    setMap(next)
  }
  const beginDragHistory = () => { dragHistoryRef.current = cloneMap(mapRef.current) }
  const finishDragHistory = () => {
    const initialMap = dragHistoryRef.current
    dragHistoryRef.current = null
    if (initialMap && JSON.stringify(initialMap) !== JSON.stringify(mapRef.current)) pushUndoSnapshot(initialMap)
  }
  const undo = () => {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    setUndoCount(undoStackRef.current.length)
    mapRef.current = previous
    setMap(previous)
  }
  const analyzeStats = () => {
    setStatsChangeFilter('')
    setStatsReport({
      lines: map.lines.length,
      stations: map.stations.filter((station) => !station.ghost).length,
      interchanges: interchangeIds.size + (map.manualInterchanges?.length ?? 0),
      routes: analyzeRoutes(map, interchangeIds),
    })
  }

  const applyStationDrag = (point: Point, activeDrag: StationDragState) => {
    updateMap((current) => ({
      ...current,
      stations: current.stations.map((station) => station.id !== activeDrag.id ? station : activeDrag.type === 'station'
        ? moveStation(current, station, point, activeDrag.offset, snapToGrid)
        : { ...station, labelOffset: { x: point.x - station.x - activeDrag.offset.x, y: point.y - station.y - activeDrag.offset.y }, labelAngle: undefined }),
    }), false)
  }

  const scheduleStationDrag = (point: Point, activeDrag: StationDragState) => {
    pendingDragPointRef.current = point
    if (dragUpdateFrameRef.current !== null) return
    dragUpdateFrameRef.current = requestAnimationFrame(() => {
      dragUpdateFrameRef.current = null
      const pendingPoint = pendingDragPointRef.current
      pendingDragPointRef.current = null
      if (pendingPoint) applyStationDrag(pendingPoint, activeDrag)
    })
  }

  const canvasPointFromEvent = (event: { currentTarget: HTMLCanvasElement; clientX: number; clientY: number }): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.max(rect.width / WORKSPACE.width, rect.height / WORKSPACE.height)
    const renderedWidth = WORKSPACE.width * scale
    const renderedHeight = WORKSPACE.height * scale
    const offsetX = (rect.width - renderedWidth) / 2
    const offsetY = (rect.height - renderedHeight) / 2
    return {
      x: (event.clientX - rect.left - offsetX) / scale,
      y: (event.clientY - rect.top - offsetY) / scale,
    }
  }
  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPointFromEvent(event)
    return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale }
  }

  const stationAt = (point: Point) => [...map.stations].reverse().find((station) => Math.hypot(station.x - point.x, station.y - point.y) < 18)
  const lineAt = (point: Point) => {
    const stations = new Map(map.stations.map((station) => [station.id, station]))
    const groups = new Map<string, { line: MetroLine; start: Station; end: Station; startId: string; endId: string }[]>()
    map.lines.forEach((line) => lineConnectionPairs(line).forEach(({ startId, endId }) => {
      if (isConnectionDeleted(line, startId, endId)) return
      const start = stations.get(startId)
      const end = stations.get(endId)
      if (!start || !end) return
      const forward = pointKey(start) <= pointKey(end)
      const geometryStart = forward ? start : end
      const geometryEnd = forward ? end : start
      const key = [pointKey(geometryStart), pointKey(geometryEnd)].join(':')
      const group = groups.get(key) ?? []
      group.push({ line, start: geometryStart, end: geometryEnd, startId, endId })
      groups.set(key, group)
    }))
    let closest: { line: MetroLine; startId: string; endId: string; distance: number } | undefined
    groups.forEach((segments) => {
      const unique = new Map<string, typeof segments[number]>()
      segments.slice().sort((left, right) => left.line.id.localeCompare(right.line.id)).forEach((segment) => {
        const key = `${canonicalColor(segment.line.color)}:${segment.line.style}`
        const previous = unique.get(key)
        if (!previous || segment.line.id === selectedLineId) unique.set(key, segment)
      })
      const visible = [...unique.values()]
      const laneWidth = 6
      const dx = visible[0] ? visible[0].end.x - visible[0].start.x : 0
      const dy = visible[0] ? visible[0].end.y - visible[0].start.y : 0
      const length = Math.hypot(dx, dy) || 1
      const normal = { x: -dy / length, y: dx / length }
      const offsets = visible.map((_, index) => (index - (visible.length - 1) / 2) * laneWidth)
        .sort((left, right) => normal.y * left - normal.y * right || normal.x * right - normal.x * left)
      visible.forEach((segment, index) => {
        const segmentDx = segment.end.x - segment.start.x
        const segmentDy = segment.end.y - segment.start.y
        const segmentLength = Math.hypot(segmentDx, segmentDy) || 1
        const offset = offsets[index]
        const offsetX = -segmentDy / segmentLength * offset
        const offsetY = segmentDx / segmentLength * offset
        const start = { x: segment.start.x + offsetX, y: segment.start.y + offsetY }
        const end = { x: segment.end.x + offsetX, y: segment.end.y + offsetY }
        const distance = distanceToSegment(point, start, end)
        if (distance < 12 && (!closest || distance < closest.distance)) closest = { line: segment.line, startId: segment.startId, endId: segment.endId, distance }
      })
    })
    return closest
  }
  const labelAt = (point: Point) => [...map.stations].reverse().find((station) => {
    if (station.ghost || !station.name.trim() || station.hideLabel) return false
    const offset = stationLabelOffset(station)
    const x = station.x + offset.x
    const y = station.y + offset.y
    return point.x > x - 50 && point.x < x + 50 && point.y > y - 12 && point.y < y + 12
  })
  const lineLabelAt = (point: Point) => getLineEndpointLabels(map, new Map(map.stations.map((station) => [station.id, station]))).find((label) => (
    point.x >= label.center.x - label.width / 2 &&
    point.x <= label.center.x + label.width / 2 &&
    point.y >= label.center.y - label.height / 2 &&
    point.y <= label.center.y + label.height / 2
  ))
  const selectStation = (station: Station, point: Point) => {
    setSelectedStationId(station.id)
    setSelectedStationIds([station.id])
    setSelectedLineId(null)
    setSelectedConnection(null)
    setStationNavigationLineId((currentLineId) => {
      if (currentLineId && map.lines.some((line) => line.id === currentLineId && line.stationIds.includes(station.id))) return currentLineId
      const preferred = map.lines.find((line) => line.id === activeLineId && line.stationIds.includes(station.id))
      return preferred?.id ?? map.lines.find((line) => line.stationIds.includes(station.id))?.id ?? null
    })
    setDrag({ type: 'station', id: station.id, offset: { x: point.x - station.x, y: point.y - station.y } })
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const canvasPoint = canvasPointFromEvent(event)
    const point = { x: (canvasPoint.x - viewport.x) / viewport.scale, y: (canvasPoint.y - viewport.y) / viewport.scale }
    const station = stationAt(point)
    if (interchangeAnchorId) {
      if (!station || station.id === interchangeAnchorId) {
        setStatus(station ? 'Choose a different station for the interchange' : 'Choose a station on a different line')
        return
      }
      const anchorLineIds = new Set(map.lines.filter((line) => line.stationIds.includes(interchangeAnchorId)).map((line) => line.id))
      const targetHasDifferentLine = map.lines.some((line) => line.stationIds.includes(station.id) && !anchorLineIds.has(line.id))
      if (!targetHasDifferentLine) {
        setStatus('Choose a station on a different line')
        return
      }
      updateMap((current) => ({
        ...current,
        manualInterchanges: mergeManualInterchange(current.manualInterchanges ?? [], interchangeAnchorId, station.id),
      }))
      setInterchangeAnchorId(null)
      setStatus('Interchange added')
      return
    }
    if (tool !== 'select' && station) {
      setTool('select')
      selectStation(station, point)
      return
    }
    if (tool === 'frame') {
      setFrameSelection({ start: point, end: point })
      return
    }
    if (tool === 'station' || tool === 'waypoint') {
      const location = snapToGrid ? snapPoint(point) : point
      if (snapToGrid && map.stations.some((item) => item.x === location.x && item.y === location.y)) {
        setStatus('That grid node is already occupied')
        return
      }
      const ghost = tool === 'waypoint'
      const created = { id: nextId(ghost ? 'w' : 's'), name: '', x: location.x, y: location.y, labelOffset: { x: 0, y: -30 }, labelAngle: 0, icon: 'none' as StationIcon, ghost }
      updateMap((current) => ({
        ...current,
        stations: [...current.stations, created],
      }))
      setSelectedStationId(created.id)
      setSelectedStationIds([created.id])
      setStationNavigationLineId(null)
      focusNewStationIdRef.current = created.id
      setPlacementLineId(null)
      setStatus(`${ghost ? 'Ghost waypoint' : 'Station'} added`)
      return
    }
    if (station) {
      beginDragHistory()
      selectStation(station, point)
      return
    }
    const lineLabel = lineLabelAt(point)
    if (lineLabel) {
      beginDragHistory()
      setDrag({ type: 'line-label', id: lineLabel.group ? lineLabel.groupKey : lineLabel.key, group: lineLabel.group, offset: { x: point.x - lineLabel.center.x, y: point.y - lineLabel.center.y } })
      return
    }
    const label = labelAt(point)
    if (label) {
      beginDragHistory()
      setSelectedStationId(label.id)
      setSelectedStationIds([label.id])
      setSelectedConnection(null)
      setStationNavigationLineId((currentLineId) => {
        if (currentLineId && map.lines.some((line) => line.id === currentLineId && line.stationIds.includes(label.id))) return currentLineId
        return map.lines.find((line) => line.stationIds.includes(label.id))?.id ?? null
      })
      const offset = stationLabelOffset(label)
      setDrag({ type: 'label', id: label.id, offset: { x: point.x - label.x - offset.x, y: point.y - label.y - offset.y } })
      return
    }
    const line = lineAt(point)
    if (line) {
      setSelectedLineId(line.line.id)
      setSelectedConnection({ lineId: line.line.id, startId: line.startId, endId: line.endId })
      setActiveLineId(line.line.id)
      setSelectedStationId(null)
      setSelectedStationIds([])
      return
    }
    setDrag({ type: 'pan', start: canvasPoint, viewport })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvasPoint = canvasPointFromEvent(event)
    if (frameSelection) {
      setFrameSelection({ ...frameSelection, end: pointFromEvent(event) })
      return
    }
    if (!drag) return
    if (drag.type === 'pan') {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + canvasPoint.x - drag.start.x,
        y: drag.viewport.y + canvasPoint.y - drag.start.y,
      })
      return
    }
    const point = pointFromEvent(event)
    if (drag.type === 'line-label') {
      const labels = getLineEndpointLabels(map, new Map(map.stations.map((station) => [station.id, station])))
      const label = labels.find((item) => (drag.group ? item.groupKey : item.key) === drag.id)
      if (!label) return
      const currentOffset = drag.group
        ? (map.terminusLabelOffsets?.[drag.id] ?? { x: 0, y: -32 })
        : (map.lineLabelOffsets?.[drag.id] ?? { x: 0, y: 0 })
      const offset = {
        x: (currentOffset?.x ?? 0) + point.x - drag.offset.x - label.center.x,
        y: (currentOffset?.y ?? 0) + point.y - drag.offset.y - label.center.y,
      }
      updateMap((current) => ({
        ...current,
        [drag.group ? 'terminusLabelOffsets' : 'lineLabelOffsets']: {
          ...(drag.group ? current.terminusLabelOffsets : current.lineLabelOffsets),
          [drag.id]: offset,
        },
      }), false)
      return
    }
    if (drag.type === 'station' || drag.type === 'label') scheduleStationDrag(point, drag)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    if (drag?.type === 'station' || drag?.type === 'label') {
      if (dragUpdateFrameRef.current !== null) cancelAnimationFrame(dragUpdateFrameRef.current)
      dragUpdateFrameRef.current = null
      pendingDragPointRef.current = null
      applyStationDrag(point, drag)
    }
    if (drag?.type === 'station' || drag?.type === 'label' || drag?.type === 'line-label') finishDragHistory()
    if (frameSelection) {
      const end = point
      const left = Math.min(frameSelection.start.x, end.x)
      const right = Math.max(frameSelection.start.x, end.x)
      const top = Math.min(frameSelection.start.y, end.y)
      const bottom = Math.max(frameSelection.start.y, end.y)
      const ids = map.stations.filter((station) => station.x >= left && station.x <= right && station.y >= top && station.y <= bottom).map((station) => station.id)
      setSelectedStationIds(ids)
      setSelectedStationId(ids[0] ?? null)
      setSelectedLineId(null)
      setSelectedConnection(null)
      setStationNavigationLineId(null)
      setFrameSelection(null)
      setStatus(ids.length ? `${ids.length} station${ids.length === 1 ? '' : 's'} selected` : 'No stations selected')
    }
    setDrag(null)
  }

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const anchor = canvasPointFromEvent(event)
    setViewport((current) => zoomViewport(current, Math.exp(-event.deltaY * 0.0025), anchor))
  }

  const addLine = () => {
    const groupId = selectedGroupId ?? map.lineGroups?.[0]?.id ?? 'g-metro'
    const group = map.lineGroups?.find((item) => item.id === groupId)
    const lineIndex = group?.lineIds.length ?? 0
    const line = { id: nextId('l'), name: group ? generatedLineName(group, lineIndex) : `Line ${map.lines.length + 1}`, color: COLORS[map.lines.length % COLORS.length], style: group?.style ?? 'solid', styleOverridden: false, nameOverridden: false, groupId, stationIds: [] }
    updateMap((current) => ({ ...current, lines: [...current.lines, line], lineGroups: (current.lineGroups ?? []).map((item) => item.id === groupId ? { ...item, lineIds: [...item.lineIds, line.id] } : item) }))
    focusNewLineIdRef.current = line.id
    setActiveLineId(line.id)
    setSelectedLineId(line.id)
    setSelectedGroupId(groupId)
    setSelectedStationId(null)
    setSelectedStationIds([])
    setSelectedConnection(null)
    setStatus('Line created and selected')
  }

  const selectPlacementLine = (lineId: string) => {
    const stationIds = selectedStationIds.length ? selectedStationIds : selectedStationId ? [selectedStationId] : []
    if (!stationIds.length) return
    startTransition(() => updateMap((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (line.id !== lineId) return line
        return stationIds.reduce((nextLine, stationId) => nextLine.stationIds.includes(stationId)
          ? nextLine
          : { ...nextLine, stationIds: insertStationByProximity(nextLine, stationId, stationsById) }, line)
      }),
    })))
    setPlacementLineId(null)
    setStatus('Station added to selected line')
  }

  const addLineGroup = () => {
    const group = { id: nextId('g'), name: `Group ${(map.lineGroups?.length ?? 0) + 1}`, style: 'solid' as LineStyle, namingPattern: 'simple' as LineNamingPattern, lineIds: [] }
    updateMap((current) => ({ ...current, lineGroups: [...(current.lineGroups ?? []), group] }))
    setSelectedGroupId(group.id)
    focusNewGroupIdRef.current = group.id
    setSelectedLineId(null)
    setSelectedStationId(null)
    setSelectedStationIds([])
    setSelectedConnection(null)
    setStatus('Line group created')
  }

  const deleteSelectedGroup = () => {
    if (!selectedGroup || selectedGroup.ephemeral) return
    updateMap((current) => deleteLineGroup(current, selectedGroup.id))
    const unassigned = map.lineGroups?.find((group) => group.id === UNASSIGNED_GROUP_ID)
    setSelectedGroupId(unassigned?.id ?? UNASSIGNED_GROUP_ID)
    setSelectedLineId(null)
    setStatus('Line group deleted')
  }

  const startManualInterchange = () => {
    if (!selectedStationId) return
    setInterchangeAnchorId((current) => current === selectedStationId ? null : selectedStationId)
    setStatus(interchangeAnchorId === selectedStationId ? 'Interchange cancelled' : 'Choose another station on a different line')
  }

  const deleteSelected = () => {
    if (selectedStationId) {
      const stationIds = selectedStationIds.length ? selectedStationIds : [selectedStationId]
      updateMap((current) => ({ ...current, stations: current.stations.filter((station) => !stationIds.includes(station.id)), lines: current.lines.map((line) => ({ ...line, stationIds: line.stationIds.filter((id) => !stationIds.includes(id)) })), manualInterchanges: (current.manualInterchanges ?? []).map((group) => group.filter((id) => !stationIds.includes(id))).filter((group) => group.length > 1) }))
      setSelectedStationId(null)
      setSelectedStationIds([])
      setSelectedConnection(null)
      setStationNavigationLineId(null)
      setStatus(stationIds.length > 1 ? 'Stations deleted' : 'Station deleted')
    } else if (selectedLineId) {
      setShowDeleteLineConfirm(true)
    }
  }

  const confirmDeleteLine = () => {
    if (!selectedLineId) {
      setShowDeleteLineConfirm(false)
      return
    }
    updateMap((current) => removeEmptyUnassigned({ ...current, lines: current.lines.filter((line) => line.id !== selectedLineId), lineGroups: (current.lineGroups ?? []).map((group) => ({ ...group, lineIds: group.lineIds.filter((lineId) => lineId !== selectedLineId) })) }))
    setShowDeleteLineConfirm(false)
    setSelectedLineId(null)
    setSelectedConnection(null)
    setActiveLineId((current) => current === selectedLineId ? null : current)
    setStatus('Line deleted')
  }

  const deleteSelectedConnection = () => {
    if (!selectedConnection) return
    const { lineId, startId, endId } = selectedConnection
    updateMap((current) => ({
      ...current,
      lines: current.lines.map((line) => line.id !== lineId ? line : {
        ...line,
        stationIds: line.stationIds.filter((id) => id !== endId),
        deletedConnections: line.deletedConnections?.filter((key) => key !== connectionKey(startId, endId)),
      }),
    }))
    setSelectedConnection(null)
    setStatus('Connection deleted')
  }

  const moveSelectedStation = (direction: 'forward' | 'backward') => {
    if (!selectedStationId) return
    const line = map.lines.find((item) => item.id === stationNavigationLineId && item.stationIds.includes(selectedStationId))
      ?? map.lines.find((item) => item.stationIds.includes(selectedStationId))
    if (!line) return
    const index = line.stationIds.indexOf(selectedStationId)
    if (index < 0 || line.stationIds.length < 2) return
    const delta = direction === 'forward' ? -1 : 1
    const nextIndex = line.loop
      ? (index + delta + line.stationIds.length) % line.stationIds.length
      : index + delta < 0
        ? line.stationIds.length - 1
        : index + delta >= line.stationIds.length
          ? 0
          : index + delta
    setSelectedStationId(line.stationIds[nextIndex])
    setSelectedStationIds([line.stationIds[nextIndex]])
    setSelectedLineId(null)
    setSelectedConnection(null)
    setStationNavigationLineId(line.id)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        if (showHelp) {
          event.preventDefault()
          setShowHelp(false)
          return
        }
        if (statsReport) {
          event.preventDefault()
          setStatsReport(null)
          return
        }
        if (event.target instanceof HTMLElement && isTextEditingTarget(event.target)) {
          event.preventDefault()
          event.target.blur()
          setTool('select')
          return
        }
        if (tool === 'frame') {
          event.preventDefault()
          setTool('select')
          setFrameSelection(null)
          return
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.altKey) {
        event.preventDefault()
        undo()
        return
      }
      if (isTextEditingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code === 'Delete') {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3' || event.code === 'Digit4') {
        const nextTool: Tool = event.code === 'Digit1' ? 'select' : event.code === 'Digit2' ? 'station' : event.code === 'Digit3' ? 'waypoint' : 'frame'
        event.preventDefault()
        setTool(nextTool)
        setStatus(`${nextTool[0].toUpperCase()}${nextTool.slice(1)} tool selected`)
        return
      }
      if (event.code === 'KeyQ' || event.code === 'KeyE') {
        event.preventDefault()
        const factor = event.code === 'KeyQ' ? 0.8 : 1.25
        setViewport((current) => zoomViewport(current, factor))
        return
      }
      if (event.code === 'KeyN') {
        event.preventDefault()
        const nameField = selectedStationId ? stationNameInputRef.current : selectedLineId ? lineNameInputRef.current : null
        nameField?.focus()
        nameField?.select()
        return
      }
      if (event.code === 'KeyL') {
        event.preventDefault()
        addLine()
        return
      }
      if (event.code === 'KeyG') {
        event.preventDefault()
        addLineGroup()
        return
      }
      if (event.code === 'KeyC' && selectedLineId) {
        event.preventDefault()
        lineGroupSelectRef.current?.focus()
        return
      }
      if (event.code === 'KeyC' && selectedStationId) {
        event.preventDefault()
        stationLineSelectRef.current?.focus()
        return
      }
      if (event.code === 'KeyH' && selectedStationId) {
        event.preventDefault()
        updateMap((current) => ({
          ...current,
          stations: current.stations.map((station) => {
            if (!selectedStationIds.includes(station.id)) return station
            const currentAngle = station.labelAngle ?? nearestLabelAngle(station.labelOffset)
            const nextAngle = (currentAngle + 45) % 360
            return { ...station, labelAngle: nextAngle, labelOffset: labelOffsetForAngle(nextAngle) }
          }),
        }))
        return
      }
      if (event.code === 'KeyF' && selectedStationId) {
        event.preventDefault()
        moveSelectedStation('forward')
        return
      }
      if (event.code === 'KeyR' && selectedStationId) {
        event.preventDefault()
        moveSelectedStation('backward')
        return
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        event.preventDefault()
        const step = 80
        const key = event.code
        setViewport((current) => ({
          ...current,
          x: current.x + (key === 'KeyA' ? step : key === 'KeyD' ? -step : 0),
          y: current.y + (key === 'KeyW' ? step : key === 'KeyS' ? -step : 0),
        }))
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedStationId, selectedStationIds, selectedLineId, tool, statsReport, showHelp, undo, deleteSelected])

  const saveMap = () => {
    const blob = new Blob([yaml.dump(map, { noRefs: true })], { type: 'text/yaml' })
    download(blob, `${slug(map.title)}.yaml`)
    setStatus('Map saved')
  }

  const newMap = () => {
    const freshMap = emptyMap()
    updateMap(() => freshMap)
    setTool('select')
    setSelectedStationId(null)
    setSelectedStationIds([])
    setSelectedLineId(null)
    setSelectedGroupId(freshMap.lineGroups?.[0]?.id ?? null)
    setSelectedConnection(null)
    setStationNavigationLineId(null)
    setActiveLineId(null)
    setPlacementLineId(null)
    setInterchangeAnchorId(null)
    setRouteFrom('s1')
    setRouteTo('s3')
    setRoute([])
    setViewport({ x: 0, y: 0, scale: 1 })
    setDrag(null)
    focusNewStationIdRef.current = null
    focusNewLineIdRef.current = null
    setStatus('New map created')
  }

  const loadMap = async (file: File) => {
    const parsed = yaml.load(await file.text()) as MetroMap
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.stations) || !Array.isArray(parsed.lines)) throw new Error('Unsupported map file')
    const normalized = normalizeMap({ ...parsed, stations: parsed.stations.map((station) => ({ ...station, ghost: station.ghost ?? station.id.startsWith('w-') })) })
    updateMap(() => normalized)
    setSelectedStationId(parsed.stations[0]?.id ?? null)
    setSelectedStationIds(parsed.stations[0] ? [parsed.stations[0].id] : [])
    setSelectedLineId(null)
    setSelectedGroupId(normalized.lineGroups?.[0]?.id ?? null)
    setSelectedConnection(null)
    setStationNavigationLineId(parsed.lines[0]?.id ?? null)
    setActiveLineId(parsed.lines[0]?.id ?? null)
    setPlacementLineId(null)
    setInterchangeAnchorId(null)
    setStatus('Map opened')
  }

  const exportPng = () => {
    const exportCanvas = document.createElement('canvas')
    const stations = new Map(map.stations.map((station) => [station.id, station]))
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    const includeRect = (left: number, top: number, right: number, bottom: number) => {
      bounds.minX = Math.min(bounds.minX, left)
      bounds.maxX = Math.max(bounds.maxX, right)
      bounds.minY = Math.min(bounds.minY, top)
      bounds.maxY = Math.max(bounds.maxY, bottom)
    }
    map.stations.forEach((station) => {
      includeRect(station.x - 12, station.y - 12, station.x + 12, station.y + 12)
      if (station.ghost || !station.name.trim() || station.hideLabel) return
      const offset = stationLabelOffset(station)
      const labelX = station.x + offset.x
      const labelY = station.y + offset.y
      const measureContext = exportCanvas.getContext('2d')
      if (!measureContext) return
      measureContext.font = '600 14px Inter, system-ui, sans-serif'
      const iconWidth = station.ghost || station.icon === 'none' ? 0 : 22
      const width = measureContext.measureText(station.name).width + iconWidth
      const left = station.labelAngle === 90 ? labelX : station.labelAngle === 270 ? labelX - width : labelX - width / 2
      includeRect(left, labelY - 10, left + width, labelY + 10)
    })
    ;(map.manualInterchanges ?? []).forEach((group) => {
      const groupStations = group.map((id) => stations.get(id)).filter((station): station is Station => Boolean(station))
      if (!groupStations.length) return
      includeRect(Math.min(...groupStations.map((station) => station.x)) - 22, Math.min(...groupStations.map((station) => station.y)) - 22, Math.max(...groupStations.map((station) => station.x)) + 22, Math.max(...groupStations.map((station) => station.y)) + 22)
    })
    getLineEndpointLabels(map, stations).forEach((label) => includeRect(label.center.x - label.width / 2, label.center.y - label.height / 2, label.center.x + label.width / 2, label.center.y + label.height / 2))
    const hasBounds = Number.isFinite(bounds.minX)
    const minX = hasBounds ? bounds.minX : 0
    const maxX = hasBounds ? bounds.maxX : WORKSPACE.width
    const minY = hasBounds ? bounds.minY : 0
    const maxY = hasBounds ? bounds.maxY : WORKSPACE.height
    const padding = 24
    const scale = 1
    const exportSize = hasBounds
      ? { width: Math.ceil(maxX - minX + padding * 2), height: Math.ceil(maxY - minY + padding * 2) }
      : WORKSPACE
    const exportViewport = { x: padding - minX * scale, y: padding - minY * scale, scale }
    drawMap(exportCanvas, map, interchangeIds, route, selectedStationIds, selectedLineId, selectedConnection, snapToGrid, shimmerPhase, exportViewport, null, exportSize)
    exportCanvas.toBlob((blob) => blob && download(blob, `${slug(map.title)}.png`), 'image/png')
    setStatus('PNG exported')
  }

  const calculateRoute = () => {
    const result = shortestRoute(map, routeFrom, routeTo)
    setRoute(result)
    setStatus(result.length ? 'Route calculated' : 'No route found')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">M</span><div><strong>Metro Designer</strong><small>schematic transit studio</small></div></div>
        <button className="help-button" aria-label="Show keyboard shortcuts" onClick={() => setShowHelp(true)}>?</button>
        <input className="title-input" value={map.title} onChange={(event) => updateMap((current) => ({ ...current, title: event.target.value }))} aria-label="Map title" />
        <div className="top-actions">
          <div className="top-action-group">
            <button className="primary" onClick={newMap}>New</button>
          </div>
          <div className="top-action-group">
            <button onClick={() => fileInputRef.current?.click()}>Open</button>
            <button onClick={saveMap}>Save</button>
            <button className="primary" onClick={exportPng}>Export PNG</button>
          </div>
          <input ref={fileInputRef} type="file" accept=".yaml,.yml" hidden onChange={(event) => event.target.files?.[0] && loadMap(event.target.files[0]).catch((error: Error) => setStatus(error.message))} />
        </div>
      </header>
      {showHelp && <div className="help-popup" role="dialog" aria-label="Keyboard shortcuts">
        <div className="help-popup-heading"><h2>Keyboard shortcuts</h2><button className="help-close" aria-label="Close keyboard shortcuts" onClick={() => setShowHelp(false)}>×</button></div>
        <div className="shortcut-list">
          <div className="shortcut-group">
            <h3>Navigation</h3>
            <span><kbd>Q</kbd><b>Zoom out</b></span>
            <span><kbd>E</kbd><b>Zoom in</b></span>
            <span><kbd>W A S D</kbd><b>Move map</b></span>
            <span><kbd>1</kbd><b>Select tool</b></span>
          </div>
          <div className="shortcut-group">
            <h3>Objects</h3>
            <span><kbd>2</kbd><b>Place station</b></span>
            <span><kbd>3</kbd><b>Place waypoint</b></span>
            <span><kbd>L</kbd><b>New line</b></span>
            <span><kbd>G</kbd><b>New line group</b></span>
          </div>
          <div className="shortcut-group">
            <h3>Inspector</h3>
            <span><kbd>N</kbd><b>Focus on name</b></span>
            <span><kbd>C</kbd><b>Focus on line selector</b></span>
            <span><kbd>Delete</kbd><b>Delete selected item</b></span>
            <span><kbd>H</kbd><b>Rotate station label</b></span>
          </div>
          <div className="shortcut-group">
            <h3>Bulk actions</h3>
            <span><kbd>4</kbd><b>Frame selector</b></span>
            <span><kbd>F</kbd><b>Move to next station</b></span>
            <span><kbd>R</kbd><b>Move to previous station</b></span>
          </div>
        </div>
      </div>}
      {showDeleteLineConfirm && <div className="modal-backdrop" role="presentation">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-line-title">
          <h2 id="delete-line-title">Delete line?</h2>
          <p>This line and its connections will be removed.</p>
          <div className="confirm-actions"><button className="secondary-button" onClick={() => setShowDeleteLineConfirm(false)}>Cancel</button><button className="delete-button" onClick={confirmDeleteLine}>Delete line</button></div>
        </div>
      </div>}
      {statsReport && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStatsReport(null) }}>
        <div className="stats-dialog" role="dialog" aria-modal="true" aria-labelledby="stats-title">
          <div className="help-popup-heading"><h2 id="stats-title">Map stats</h2><button className="help-close" aria-label="Close map stats" onClick={() => setStatsReport(null)}>×</button></div>
          <div className="stats-grid"><Stat label="Lines" value={statsReport.lines} /><Stat label="Stations" value={statsReport.stations} /><Stat label="Interchanges" value={statsReport.interchanges} /></div>
          <div className="stats-filter"><label htmlFor="stats-change-filter">Changes</label><input id="stats-change-filter" type="number" min="2" max={Math.max(2, statsReport.routes.reduce((maximum, route) => Math.max(maximum, route.changes), 0))} value={statsChangeFilter} placeholder="All" onChange={(event) => setStatsChangeFilter(event.target.value === '' ? '' : Math.max(2, Math.min(Number(event.target.value), statsReport.routes.reduce((maximum, route) => Math.max(maximum, route.changes), 0))))} /></div>
          <div className="route-analysis-list">{(() => {
            const filteredRoutes = statsReport.routes.filter((route) => route.changes >= 2 && (statsChangeFilter === '' || route.changes === statsChangeFilter))
            return filteredRoutes.length ? filteredRoutes.map((route) => <div className="route-analysis-entry connected-line-row" key={`${route.fromId}:${route.toId}`}><div className="route-analysis-main connected-line-main"><div className="route-analysis-summary"><strong>{route.changes} {route.changes === 1 ? 'change' : 'changes'}</strong><span>{stationsById.get(route.fromId)?.name.trim() || route.fromId} → {stationsById.get(route.toId)?.name.trim() || route.toId}</span></div><div className="route-analysis-sequence">{route.lineIds.map((lineId, index) => <span key={`${lineId}:${index}`}>{index > 0 && route.transfers[index - 1] && <> <em>→ {stationsById.get(route.transfers[index - 1].stationId)?.name.trim() || route.transfers[index - 1].stationId} →</em> </>}<b className="route-analysis-line" style={{ background: map.lines.find((line) => line.id === lineId)?.color ?? '#64748b', color: readableText(map.lines.find((line) => line.id === lineId)?.color ?? '#64748b') }}>{map.lines.find((line) => line.id === lineId)?.name || lineId}</b></span>)}</div></div></div>) : <div className="styled-dropdown-empty">No station pairs match this change count.</div>
          })()}</div>
        </div>
      </div>}
      <div className="workspace">
        <section className="map-column">
          <section className="canvas-wrap">
            <canvas ref={canvasRef} width={WORKSPACE.width} height={WORKSPACE.height} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onWheel={handleWheel} />
            <div className="canvas-status">{status}</div>
          </section>
          <div className="line-panels">
            <section className="panel group-toolbar"><div className="panel-heading"><h2>Groups</h2><button className="add-line-button" onClick={addLineGroup}>+ Add</button></div><div className="group-list">{(map.lineGroups ?? []).map((group) => <button key={group.id} className={selectedGroupId === group.id ? 'group-row active' : 'group-row'} style={{ borderLeft: `4px ${lineOutlineStyle(group.style)} #aeb8c2` }} onClick={() => { setSelectedGroupId(group.id); setSelectedLineId(null); setActiveLineId(null); setSelectedStationId(null); setSelectedStationIds([]); setSelectedConnection(null) }}><span>{group.name || 'Unnamed group'}</span><small>{group.lineIds.length}</small></button>)}</div></section>
            <section className="panel line-toolbar"><div className="panel-heading"><h2>Lines</h2><button className="add-line-button" onClick={addLine}>+ Add</button></div><div className="line-list">{selectedGroupLines.map((line) => <button key={line.id} className={activeLineId === line.id ? 'line-row active' : 'line-row'} style={activeLineId === line.id ? { border: `2px ${lineOutlineStyle(line.style)} ${line.color}` } : undefined} onClick={() => { setActiveLineId(line.id); setSelectedLineId(line.id); setSelectedStationId(null); setSelectedStationIds([]); setSelectedConnection(null) }}><i className="line-color-block" style={{ background: line.color }} /><span>{line.name || 'Unnamed line'}</span><small>{line.stationIds.length}</small></button>)}</div>{!selectedGroupLines.length && <div className="hint">Select a group to view its lines.</div>}<div className="hint">Select a station or waypoint to add it to lines.</div></section>
          </div>
        </section>
        <aside className="sidebar right-panel">
          <section className="draw-panel"><div className="draw-heading"><h2>Draw</h2><div className="tool-grid">
            {([['select', '↖', 'Select'], ['station', '●', 'Station']] as const).map(([value, icon, label]) => <button key={value} className={tool === value ? 'tool active tooltip-button' : 'tool tooltip-button'} aria-label={label} data-tooltip={value === 'select' ? 'Select / move' : 'New station'} onClick={() => setTool(value)}><b>{icon}</b></button>)}
            <button className={tool === 'waypoint' ? 'tool active tooltip-button' : 'tool tooltip-button'} aria-label="Waypoint" data-tooltip="New waypoint" onClick={() => setTool('waypoint')}><b>◇</b></button>
            <button className={tool === 'frame' ? 'tool active tooltip-button' : 'tool tooltip-button'} aria-label="Frame selector" data-tooltip="Frame select" onClick={() => setTool('frame')}><b>□</b></button>
            <div className="tool-divider"><button className="tool undo-snap-button tooltip-button" aria-label="Undo" data-tooltip="Undo" onMouseDown={(event) => event.preventDefault()} onClick={undo} disabled={!undoCount}>↺</button></div>
          </div></div>
          <div className="snap-row"><div className="snap-tool-group"><span>Snap to grid</span><label className="snap-tool" aria-label="Snap to grid"><input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} /><span className="toggle"></span></label></div></div>
          </section>
          <Inspector station={selectedStation} stations={map.stations} manualInterchanges={map.manualInterchanges ?? []} selectedStationIds={selectedStationIds} interchangeAnchorId={interchangeAnchorId} onStartManualInterchange={startManualInterchange} line={selectedLine} group={selectedLine ? undefined : selectedGroup} lineGroups={map.lineGroups ?? []} lines={map.lines} placementLineId={placementLineId} selectedConnection={selectedConnection} isInterchange={selectedStation ? interchangeIds.has(selectedStation.id) : false} updateMap={updateMap} onDelete={deleteSelected} onDeleteGroup={deleteSelectedGroup} onDeleteConnection={deleteSelectedConnection} onSelectLine={(id) => { setSelectedLineId(id); setActiveLineId(id); setSelectedStationId(null); setSelectedStationIds([]); setSelectedConnection(null) }} onSelectPlacementLine={selectPlacementLine} onLineNameEnter={() => setTool('select')} stationNameInputRef={stationNameInputRef} lineNameInputRef={lineNameInputRef} groupNameInputRef={groupNameInputRef} stationLineSelectRef={stationLineSelectRef} lineGroupSelectRef={lineGroupSelectRef} lineStyleSelectRef={lineStyleSelectRef} />
          <button className="stats-button primary" onClick={analyzeStats}>Analyze map stats</button>
        </aside>
      </div>
    </main>
  )
}

type DropdownOption = { value: string; label: string }

const StyledDropdown = forwardRef<HTMLButtonElement, { value: string; placeholder?: string; options: DropdownOption[]; onChange: (value: string) => void }>(function StyledDropdown({ value, placeholder, options, onChange }, ref) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, options.findIndex((option) => option.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const choose = (option: DropdownOption) => { onChange(option.value); setActiveIndex(options.indexOf(option)); setOpen(false) }
  const move = (delta: number) => {
    if (!options.length) return
    setOpen(true)
    setActiveIndex((index) => (index + delta + options.length) % options.length)
  }
  return <div ref={rootRef} className="styled-dropdown">
    <button ref={ref} type="button" className="styled-dropdown-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
      if (event.code === 'ArrowDown') { event.preventDefault(); move(1) }
      else if (event.code === 'ArrowUp') { event.preventDefault(); move(-1) }
      else if (event.code === 'Enter' && open && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]) }
      else if (event.code === 'Escape') { event.preventDefault(); setOpen(false) }
    }}>{selected?.label ?? placeholder ?? 'Select...' }<span className="styled-dropdown-chevron">▾</span></button>
    {open && <div className="styled-dropdown-menu" role="listbox">{options.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={index === activeIndex ? 'styled-dropdown-option active' : 'styled-dropdown-option'} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>{option.label}</button>)}</div>}
  </div>
})

const LineSearchDropdown = forwardRef<HTMLInputElement, { lines: MetroLine[]; lineGroups: LineGroup[]; onSelect: (lineId: string) => void }>(function LineSearchDropdown({ lines, lineGroups, onSelect }, ref) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const options = [...lines].sort((left, right) => left.name.localeCompare(right.name)).filter((line) => (line.name || 'Unnamed line').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const choose = (line: MetroLine) => { onSelect(line.id); setQuery(''); setOpen(false); setActiveIndex(0) }
  return <div ref={rootRef} className="styled-dropdown line-search-dropdown">
    <input ref={ref} value={query} placeholder="Select line..." role="combobox" aria-expanded={open} aria-autocomplete="list" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true) }} onKeyDown={(event) => {
      if (event.code === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => options.length ? (index + 1) % options.length : 0) }
      else if (event.code === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex((index) => options.length ? (index - 1 + options.length) % options.length : 0) }
      else if (event.code === 'Enter' && open && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]) }
      else if (event.code === 'Escape') { event.preventDefault(); setOpen(false) }
    }} />
    {open && <div className="styled-dropdown-menu" role="listbox">{options.map((line, index) => <button key={line.id} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'styled-dropdown-option active line-selector-option' : 'styled-dropdown-option line-selector-option'} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(line)}><i className={`line-selector-swatch line-selector-swatch-${line.style}`} style={{ background: line.style === 'solid' || line.style === 'dotted' ? line.color : 'transparent', borderColor: line.style === 'hollow' || line.style === 'dashed' ? line.color : 'transparent' }} /><span>{line.name || 'Unnamed line'}</span> <em>({lineGroups.find((group) => group.id === line.groupId)?.name || 'Unassigned'})</em></button>)}{!options.length && <div className="styled-dropdown-empty">No matching lines</div>}</div>}
  </div>
})

function Inspector({ station, stations, manualInterchanges, selectedStationIds, interchangeAnchorId, onStartManualInterchange, line, group, lineGroups, lines, placementLineId, selectedConnection, isInterchange, updateMap, onDelete, onDeleteGroup, onDeleteConnection, onSelectLine, onSelectPlacementLine, onLineNameEnter, stationNameInputRef, lineNameInputRef, groupNameInputRef, stationLineSelectRef, lineGroupSelectRef, lineStyleSelectRef }: { station?: Station; stations: Station[]; manualInterchanges: string[][]; selectedStationIds: string[]; interchangeAnchorId: string | null; onStartManualInterchange: () => void; line?: MetroLine; group?: LineGroup; lineGroups: LineGroup[]; lines: MetroLine[]; placementLineId: string | null; selectedConnection: { lineId: string; startId: string; endId: string } | null; isInterchange: boolean; updateMap: (updater: (map: MetroMap) => MetroMap) => void; onDelete: () => void; onDeleteGroup: () => void; onDeleteConnection: () => void; onSelectLine: (id: string | null) => void; onSelectPlacementLine: (id: string) => void; onLineNameEnter: () => void; stationNameInputRef: RefObject<HTMLInputElement | null>; lineNameInputRef: RefObject<HTMLInputElement | null>; groupNameInputRef: RefObject<HTMLInputElement | null>; stationLineSelectRef: RefObject<HTMLInputElement | null>; lineGroupSelectRef: RefObject<HTMLButtonElement | null>; lineStyleSelectRef: RefObject<HTMLButtonElement | null> }) {
  const waypoint = station ? isWaypoint(station) : false
  return (
    <section className="panel inspector">
      <div className="panel-heading"><h2>Inspector</h2>{(station || line || (group && !group.ephemeral)) && <button className="delete-button" onClick={group && !station && !line ? onDeleteGroup : onDelete}>Delete</button>}</div>
      {station ? (
        <>
          <div className="station-inspector-heading">
            <div className="selection-badge">{waypoint ? 'WAYPOINT' : 'STATION'}</div>
          </div>
          {!waypoint && <div className="field"><label>Name</label><input key={station.id} ref={stationNameInputRef} value={station.name} onChange={(event) => updateMap((map) => ({ ...map, stations: map.stations.map((item) => item.id === station.id ? { ...item, name: event.target.value } : item) }))} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); event.currentTarget.blur(); requestAnimationFrame(() => stationLineSelectRef.current?.focus()) }} onBlur={(event) => {
            const name = event.currentTarget.value
            updateMap((map) => ({ ...map, stations: map.stations.map((item) => item.id === station.id ? { ...item, name: name.trim() ? name : fallbackStationName(map, item) } : item) }))
          }} /></div>}
          {!waypoint && manualInterchanges.some((group) => group.includes(station.id)) && <label className="toggle-row station-label-toggle"><input type="checkbox" checked={station.hideLabel ?? false} onChange={(event) => updateMap((map) => ({ ...map, stations: map.stations.map((item) => item.id === station.id ? { ...item, hideLabel: event.target.checked } : item) }))} /><span className="toggle"></span><span>Hide station label</span></label>}
          <div className="field"><label>Line</label><LineSearchDropdown ref={stationLineSelectRef} lines={lines} lineGroups={lineGroups} onSelect={onSelectPlacementLine} /></div>
          <div className="field"><label>Label angle</label><StyledDropdown ref={lineStyleSelectRef} value={station.labelAngle === undefined ? 'manual' : String(station.labelAngle)} placeholder="Manual" options={[{ value: 'manual', label: 'Manual' }, ...LABEL_ANGLES.map((angle) => ({ value: String(angle), label: `${angle} deg` }))]} onChange={(value) => {
            if (value === 'manual') return
            const angle = Number(value)
            updateMap((map) => ({ ...map, stations: map.stations.map((item) => selectedStationIds.includes(item.id) ? { ...item, labelAngle: angle, labelOffset: labelOffsetForAngle(angle) } : item) }))
          }} /></div>
          <div className="coordinates"><span>X {Math.round(station.x)}</span><span>Y {Math.round(station.y)}</span></div>
          <div className="station-action-tools">
            {!waypoint && <div className="tool-grid station-style-tools" role="radiogroup" aria-label="Station style">
              <button type="button" className={!isInterchange ? 'tool active tooltip-button' : 'tool tooltip-button'} aria-label="Regular station" data-tooltip="Station" aria-pressed={!isInterchange} onClick={() => updateMap((map) => ({ ...map, stations: map.stations.map((item) => item.id === station.id ? { ...item, interchangeStyle: 'regular' } : item) }))}><span className="station-style-icon regular"></span></button>
              <button type="button" className={isInterchange ? 'tool active tooltip-button' : 'tool tooltip-button'} aria-label="Junction" data-tooltip="Junction" aria-pressed={isInterchange} onClick={() => updateMap((map) => ({ ...map, stations: map.stations.map((item) => item.id === station.id ? { ...item, interchangeStyle: 'converging' } : item) }))}><span className="station-style-icon interchange"></span></button>
            </div>}
            <button type="button" className={interchangeAnchorId === station.id ? 'tool active manual-interchange-tool tooltip-button' : 'tool manual-interchange-tool tooltip-button'} aria-label={interchangeAnchorId === station.id ? 'Cancel interchange' : 'Interchange'} data-tooltip={interchangeAnchorId === station.id ? 'Cancel interchange' : 'Interchange'} aria-pressed={interchangeAnchorId === station.id} onClick={onStartManualInterchange}><span>↔</span><span>Interchange</span></button>
          </div>
          <div className="field station-icon-field"><label>Modalities</label><div className="tool-grid station-icon-tools" role="radiogroup" aria-label="Station modalities">
            {([['plane', 'Airport'], ['train', 'Rail station'], ['bus', 'Intercity bus'], ['ship', 'Passenger port']] as const).map(([value, label]) => <button key={value} type="button" className={station.icon === value ? 'tool active tooltip-button' : 'tool tooltip-button'} aria-label={label} data-tooltip={label} aria-pressed={station.icon === value} onClick={() => updateMap((map) => ({ ...map, stations: map.stations.map((item) => item.id === station.id ? { ...item, icon: item.icon === value ? 'none' : value } : item) }))}><span className={`station-icon-glyph ${value}`}>{value === 'plane' || value === 'ship' ? iconGlyph(value) : null}</span></button>)}
          </div></div>
          <h3>Connected lines</h3>
          {lineListForStation(station.id, lines, onSelectLine, (lineId) => updateMap((map) => ({ ...map, lines: map.lines.map((item) => item.id === lineId ? { ...item, stationIds: item.stationIds.filter((id) => id !== station.id) } : item) })))}
          {manualInterchangeListForStation(station.id, manualInterchanges, stations, lines, (group) => updateMap((map) => ({ ...map, manualInterchanges: (map.manualInterchanges ?? []).filter((item) => item.some((id) => !group.includes(id))) })))}
        </>
      ) : group ? (
        <>
          <div className="selection-badge line-badge">LINE GROUP</div>
          {group.ephemeral ? <p className="muted">This group is managed automatically. Select a line to edit it.</p> : <>
            <div className="field"><label>Name</label><input ref={groupNameInputRef} value={group.name} onChange={(event) => updateMap((map) => ({ ...map, lineGroups: (map.lineGroups ?? []).map((item) => item.id === group.id ? { ...item, name: event.target.value } : item) }))} /></div>
            <div className="field"><label>Default line style</label><StyledDropdown value={group.style} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'hollow', label: 'Hollow' }]} onChange={(value) => updateMap((map) => ({ ...map, lineGroups: (map.lineGroups ?? []).map((item) => item.id === group.id ? { ...item, style: value as LineStyle } : item), lines: map.lines.map((item) => item.groupId === group.id && !item.styleOverridden ? { ...item, style: value as LineStyle } : item) }))} /></div>
            <div className="field"><label>Line naming</label><StyledDropdown value={group.namingPattern} options={[{ value: 'simple', label: 'Simple' }, { value: 'alphabet', label: 'Alphabetic' }, { value: 'numbered', label: 'Numbered' }]} onChange={(value) => updateMap((map) => applyGroupNaming(map, group.id, { namingPattern: value as LineNamingPattern }))} /></div>
            {group.namingPattern !== 'simple' && <div className="field"><label>Prefix</label><input value={group.namingPrefix ?? ''} onChange={(event) => updateMap((map) => applyGroupNaming(map, group.id, { namingPrefix: event.target.value }))} placeholder={group.namingPattern === 'numbered' ? 'e.g. MET' : 'Optional'} /></div>}
            <p className="muted">{group.lineIds.length} lines in this group</p>
          </>}
        </>
      ) : line ? (
        <>
          <div className="selection-badge line-badge" style={{ background: line.color }}>LINE</div>
          <div className="field"><label>Name</label><input ref={lineNameInputRef} value={line.name} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); event.currentTarget.blur(); onLineNameEnter() }} onChange={(event) => updateMap((map) => ({ ...map, lines: map.lines.map((item) => item.id === line.id ? { ...item, name: event.target.value, nameOverridden: true } : item) }))} /></div>
          <div className="field"><label>Color</label><input type="color" value={line.color} onChange={(event) => updateMap((map) => ({ ...map, lines: map.lines.map((item) => item.id === line.id ? { ...item, color: event.target.value } : item) }))} /><div className="color-presets">{COLOR_PRESETS.map((preset) => <button key={preset.color} className={line.color.toLowerCase() === preset.color ? 'color-swatch active' : 'color-swatch'} style={{ background: preset.color }} title={preset.name} aria-label={`Use ${preset.name}`} onClick={() => updateMap((map) => ({ ...map, lines: map.lines.map((item) => item.id === line.id ? { ...item, color: preset.color } : item) }))} />)}</div></div>
          <div className="field"><label>Group</label><StyledDropdown ref={lineGroupSelectRef} value={line.groupId ?? lineGroups[0]?.id ?? ''} options={lineGroups.map((item) => ({ value: item.id, label: item.name || 'Unnamed group' }))} onChange={(value) => updateMap((map) => {
            const targetGroup = (map.lineGroups ?? []).find((item) => item.id === value)
            const targetIndex = targetGroup?.lineIds.length ?? 0
            return removeEmptyUnassigned({ ...map, lines: map.lines.map((item) => item.id === line.id ? { ...item, groupId: value, name: item.nameOverridden || !targetGroup ? item.name : generatedLineName(targetGroup, targetIndex) } : item), lineGroups: (map.lineGroups ?? []).map((item) => item.id === value ? { ...item, lineIds: item.lineIds.includes(line.id) ? item.lineIds : [...item.lineIds, line.id] } : { ...item, lineIds: item.lineIds.filter((lineId) => lineId !== line.id) }) })
          })} /></div>
          <div className="field"><label>Style</label><StyledDropdown ref={lineStyleSelectRef} value={line.style} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'hollow', label: 'Hollow' }]} onChange={(value) => updateMap((map) => ({ ...map, lines: map.lines.map((item) => item.id === line.id ? { ...item, style: value as LineStyle, styleOverridden: true } : item) }))} /></div>
          <label className="toggle-row"><input type="checkbox" checked={line.loop ?? false} disabled={line.stationIds.length < 2} onChange={(event) => updateMap((map) => ({ ...map, lines: map.lines.map((item) => item.id === line.id ? { ...item, loop: event.target.checked } : item) }))} /><span className="toggle"></span><span>Loop line</span></label>
          {selectedConnection?.lineId === line.id && <button className="delete-button wide" onClick={onDeleteConnection}>Delete connection</button>}
          <p className="muted">{line.stationIds.length} stations on this line</p>
        </>
      ) : <p className="empty-state">Select a station or line to edit its properties.</p>}
    </section>
  )
}

function lineListForStation(stationId: string, lines: MetroLine[], onSelectLine: (id: string) => void, onRemoveLine: (id: string) => void) {
  return <div className="connected-lines">{lines.filter((line) => line.stationIds.includes(stationId)).map((line) => <div className="connected-line-row" key={line.id}><button className="connected-line-main" style={{ background: line.color, color: readableText(line.color) }} onClick={() => onSelectLine(line.id)}>{line.name}</button><button className="connected-line-remove" onClick={() => onRemoveLine(line.id)} aria-label={`Remove ${line.name} connection`}>×</button></div>)}</div>
}

function manualInterchangeListForStation(stationId: string, groups: string[][], stations: Station[], lines: MetroLine[], onRemove: (group: string[]) => void) {
  const stationNames = new Map(stations.map((station) => [station.id, station.name || 'Unnamed station']))
  const connections = groups.filter((group) => group.includes(stationId))
  if (!connections.length) return null
  return <div className="connected-lines manual-interchange-list">{connections.map((group) => {
    const otherIds = group.filter((id) => id !== stationId)
    const otherNames = otherIds.map((id) => stationNames.get(id) ?? 'Unnamed station').join(', ')
    const otherColor = lines.find((line) => otherIds.some((id) => line.stationIds.includes(id)))?.color ?? '#64748b'
    return <div className="connected-line-row" key={group.join('|')}><button type="button" className="connected-line-main" style={{ background: otherColor, color: readableText(otherColor) }}>↔ {otherNames}</button><button className="connected-line-remove" onClick={() => onRemove(group)} aria-label="Remove interchange connection">×</button></div>
  })}</div>
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><strong>{value}</strong><span>{label}</span></div> }

function drawManualInterchanges(ctx: CanvasRenderingContext2D, groups: string[][], stations: Map<string, Station>) {
  groups.forEach((group) => {
    const points = group.map((id) => stations.get(id)).filter((station): station is Station => Boolean(station))
    if (points.length < 2) return
    const padding = 22
    const left = Math.min(...points.map((point) => point.x)) - padding
    const top = Math.min(...points.map((point) => point.y)) - padding
    const right = Math.max(...points.map((point) => point.x)) + padding
    const bottom = Math.max(...points.map((point) => point.y)) + padding
    ctx.save()
    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)'
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(left, top, right - left, bottom - top, 12)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  })
}

function drawMap(canvas: HTMLCanvasElement | null, map: MetroMap, interchangeIds: Set<string>, route: string[], selectedStationIds: string[], selectedLineId: string | null, selectedConnection: { lineId: string; startId: string; endId: string } | null, snapToGrid: boolean, shimmerPhase: number, viewport: Viewport, frameSelection: { start: Point; end: Point } | null, size = WORKSPACE) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== size.width * dpr) canvas.width = size.width * dpr
  if (canvas.height !== size.height * dpr) canvas.height = size.height * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillStyle = '#fbfcfe'; ctx.fillRect(0, 0, size.width, size.height)
  ctx.save()
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)
  const stations = new Map(map.stations.map((station) => [station.id, station]))
  drawManualInterchanges(ctx, map.manualInterchanges ?? [], stations)
  ctx.strokeStyle = '#e7edf3'; ctx.lineWidth = 1
  const gridStartX = Math.floor((-viewport.x / viewport.scale) / GRID_SIZE) * GRID_SIZE - GRID_SIZE
  const gridEndX = Math.ceil(((size.width - viewport.x) / viewport.scale) / GRID_SIZE) * GRID_SIZE + GRID_SIZE
  const gridStartY = Math.floor((-viewport.y / viewport.scale) / GRID_SIZE) * GRID_SIZE - GRID_SIZE
  const gridEndY = Math.ceil(((size.height - viewport.y) / viewport.scale) / GRID_SIZE) * GRID_SIZE + GRID_SIZE
  for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(x, gridStartY); ctx.lineTo(x, gridEndY); ctx.stroke() }
  for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(gridStartX, y); ctx.lineTo(gridEndX, y); ctx.stroke() }
  if (snapToGrid) {
    ctx.fillStyle = '#d8e1e9'
    for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) ctx.fillRect(x - 1, y - 1, 2, 2)
  }
  drawSegments(ctx, map, stations, selectedLineId, selectedConnection, shimmerPhase)
  if (route.length > 1) {
    ctx.save(); ctx.strokeStyle = '#111827'; ctx.globalAlpha = .75; ctx.lineWidth = 4; ctx.setLineDash([2, 7])
    ctx.beginPath(); route.map((id) => stations.get(id)).filter(Boolean).forEach((point, index) => index ? ctx.lineTo(point!.x, point!.y) : ctx.moveTo(point!.x, point!.y)); ctx.stroke(); ctx.restore()
  }
  if (frameSelection) {
    const left = Math.min(frameSelection.start.x, frameSelection.end.x)
    const top = Math.min(frameSelection.start.y, frameSelection.end.y)
    const width = Math.abs(frameSelection.end.x - frameSelection.start.x)
    const height = Math.abs(frameSelection.end.y - frameSelection.start.y)
    ctx.save()
    ctx.fillStyle = 'rgba(232, 93, 101, 0.12)'
    ctx.strokeStyle = '#e85d65'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.fillRect(left, top, width, height)
    ctx.strokeRect(left, top, width, height)
    ctx.restore()
  }
  drawLineEndpointLabels(ctx, map, stations)
  map.stations.forEach((station) => {
    const selected = selectedStationIds.includes(station.id)
    ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = selected ? '#111827' : '#263442'; ctx.lineWidth = selected ? 4 : 3
    if (station.ghost) {
      const lineColor = map.lines.find((line) => line.stationIds.includes(station.id))?.color ?? '#93a0ab'
      const converges = map.lines.filter((line) => line.stationIds.includes(station.id)).length > 1
      const radius = converges ? (selected ? 8 : 7) : (selected ? 5 : 4)
      ctx.fillStyle = lineColor
      ctx.strokeStyle = selected ? '#111827' : lineColor
      ctx.lineWidth = selected ? 2 : 1
      ctx.beginPath(); ctx.arc(station.x, station.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else if (interchangeIds.has(station.id)) {
      ctx.translate(station.x, station.y); ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.roundRect(-10, -10, 20, 20, 3); ctx.fill(); ctx.stroke()
    } else { ctx.beginPath(); ctx.arc(station.x, station.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke() }
    ctx.restore()
    if (station.ghost || !station.name.trim() || station.hideLabel) return
    const labelOffset = stationLabelOffset(station)
    const labelX = station.x + labelOffset.x
    const labelY = station.y + labelOffset.y
    ctx.fillStyle = station.ghost ? '#86929f' : '#17212b'
    ctx.textBaseline = 'middle'
    ctx.font = '600 14px Inter, system-ui, sans-serif'
    const labelAngle = station.labelAngle
    if (station.ghost) {
      ctx.textAlign = labelAngle === 90 ? 'left' : labelAngle === 270 ? 'right' : 'center'
      ctx.fillText(`· ${station.name}`, labelX, labelY)
    } else {
      const icon = iconGlyph(station.icon)
      const nameWidth = ctx.measureText(station.name).width
      const hasCustomRailIcon = station.icon === 'train'
      const hasCustomBusIcon = station.icon === 'bus'
      if (!icon && !hasCustomRailIcon && !hasCustomBusIcon) {
        ctx.textAlign = labelAngle === 90 ? 'left' : labelAngle === 270 ? 'right' : 'center'
        ctx.fillText(station.name, labelX, labelY)
      } else {
        ctx.font = '18px Inter, system-ui, sans-serif'
        const iconWidth = hasCustomRailIcon || hasCustomBusIcon ? 18 : ctx.measureText(icon).width
        const totalWidth = iconWidth + 4 + nameWidth
        ctx.textAlign = 'left'
        const left = labelAngle === 90 ? labelX : labelAngle === 270 ? labelX - totalWidth : labelX - totalWidth / 2
        if (hasCustomRailIcon) drawRailIcon(ctx, left, labelY)
        else if (hasCustomBusIcon) drawBusIcon(ctx, left, labelY)
        else ctx.fillText(icon, left, labelY)
        ctx.font = '600 14px Inter, system-ui, sans-serif'
        ctx.fillText(station.name, left + iconWidth + 4, labelY)
      }
    }
  })
  ctx.restore()
}

function drawLineEndpointLabels(ctx: CanvasRenderingContext2D, map: MetroMap, stations: Map<string, Station>) {
  getLineEndpointLabels(map, stations).forEach((label) => {
    ctx.save()
    ctx.font = '700 10px Inter, system-ui, sans-serif'
    ctx.fillStyle = label.color
    ctx.beginPath()
    ctx.roundRect(label.center.x - label.width / 2, label.center.y - label.height / 2, label.width, label.height, 4)
    ctx.fill()
    ctx.fillStyle = readableText(label.color)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label.label, label.center.x, label.center.y)
    ctx.restore()
  })
}

function getLineEndpointLabels(map: MetroMap, stations: Map<string, Station>): LineEndpointLabel[] {
  const endpoints: { key: string; station: Station; neighbor: Station; line: MetroLine }[] = []
  map.lines.forEach((line) => {
    if (line.loop) {
      const first = stations.get(line.stationIds[0])
      const firstNeighbor = stations.get(line.stationIds[1])
      if (first && firstNeighbor) endpoints.push({ key: `${line.id}:${first.id}`, station: first, neighbor: firstNeighbor, line })
      return
    }
    lineComponents(line).forEach(([startIndex, endIndex]) => {
      const first = stations.get(line.stationIds[startIndex])
      const firstNeighbor = stations.get(line.stationIds[startIndex + 1])
      const last = stations.get(line.stationIds[endIndex])
      const lastNeighbor = stations.get(line.stationIds[endIndex - 1])
      if (first && firstNeighbor) endpoints.push({ key: `${line.id}:${first.id}`, station: first, neighbor: firstNeighbor, line })
      if (last && lastNeighbor) endpoints.push({ key: `${line.id}:${last.id}`, station: last, neighbor: lastNeighbor, line })
    })
  })
  const endpointCounts = new Map<string, number>()
  endpoints.forEach(({ station }) => endpointCounts.set(station.id, (endpointCounts.get(station.id) ?? 0) + 1))
  const labels: LineEndpointLabel[] = []
  const grouped = new Map<string, typeof endpoints>()
  endpoints.forEach((endpoint) => {
    if ((endpointCounts.get(endpoint.station.id) ?? 0) > 1) {
      const group = grouped.get(endpoint.station.id) ?? []
      group.push(endpoint)
      grouped.set(endpoint.station.id, group)
    }
  })
  grouped.forEach((group, stationId) => {
    const station = group[0].station
    const groupOffset = map.terminusLabelOffsets?.[stationId] ?? { x: 0, y: -32 }
    const dimensions = group.map(({ line }) => {
      const label = line.name || 'Unnamed line'
      return { label, width: measureLabelWidth(label), height: 17, color: line.color }
    })
    const gap = 4
    const totalHeight = dimensions.reduce((sum, item) => sum + item.height, 0) + Math.max(0, dimensions.length - 1) * gap
    let y = station.y + groupOffset.y - totalHeight / 2
    group.forEach((endpoint, index) => {
      const dimension = dimensions[index]
      labels.push({ key: endpoint.key, groupKey: stationId, group: true, station, ...dimension, center: { x: station.x + groupOffset.x, y: y + dimension.height / 2 } })
      y += dimension.height + gap
    })
  })
  endpoints.filter(({ station }) => (endpointCounts.get(station.id) ?? 0) === 1).forEach((endpoint) => {
    const dx = endpoint.station.x - endpoint.neighbor.x
    const dy = endpoint.station.y - endpoint.neighbor.y
    const length = Math.hypot(dx, dy) || 1
    const baseCenter = { x: endpoint.station.x + dx / length * 30, y: endpoint.station.y + dy / length * 30 }
    const offset = map.lineLabelOffsets?.[endpoint.key] ?? { x: 0, y: 0 }
    const label = endpoint.line.name || 'Unnamed line'
    labels.push({ key: endpoint.key, groupKey: endpoint.station.id, group: false, station: endpoint.station, label, width: measureLabelWidth(label), height: 17, color: endpoint.line.color, center: { x: baseCenter.x + offset.x, y: baseCenter.y + offset.y } })
  })
  return labels
}

function measureLabelWidth(label: string) {
  return label.length * 6.5 + 12
}

function drawSegments(ctx: CanvasRenderingContext2D, map: MetroMap, stations: Map<string, Station>, selectedLineId: string | null, selectedConnection: { lineId: string; startId: string; endId: string } | null, shimmerPhase: number) {
  const groups = new Map<string, { line: MetroLine; start: Station; end: Station; originalStartId: string; originalEndId: string }[]>()
  map.lines.forEach((line) => lineConnectionPairs(line).forEach(({ startId, endId }) => {
    if (isConnectionDeleted(line, startId, endId)) return
    const start = stations.get(startId)
    const end = stations.get(endId)
    if (!start || !end) return
    const forward = pointKey(start) <= pointKey(end)
    const geometryStart = forward ? start : end
    const geometryEnd = forward ? end : start
    const key = [pointKey(geometryStart), pointKey(geometryEnd)].join(':')
    const group = groups.get(key) ?? []
    group.push({ line, start: geometryStart, end: geometryEnd, originalStartId: startId, originalEndId: endId })
    groups.set(key, group)
  }))
  groups.forEach((segments) => {
    const unique = new Map<string, typeof segments[number]>()
    segments.slice().sort((left, right) => left.line.id.localeCompare(right.line.id)).forEach((segment) => {
      const key = `${canonicalColor(segment.line.color)}:${segment.line.style}`
      const previous = unique.get(key)
      if (!previous || segment.line.id === selectedLineId) unique.set(key, segment)
    })
    const visible = [...unique.values()]
    const laneWidth = 6
    const dx = visible[0] ? visible[0].end.x - visible[0].start.x : 0
    const dy = visible[0] ? visible[0].end.y - visible[0].start.y : 0
    const length = Math.hypot(dx, dy) || 1
    const normal = { x: -dy / length, y: dx / length }
    const laneOffsets = visible.map((_, index) => (index - (visible.length - 1) / 2) * laneWidth)
      .sort((left, right) => {
        const leftX = normal.x * left
        const leftY = normal.y * left
        const rightX = normal.x * right
        const rightY = normal.y * right
        return leftY - rightY || rightX - leftX
      })
    visible.forEach((segment, index) => {
      const dx = segment.end.x - segment.start.x
      const dy = segment.end.y - segment.start.y
      const length = Math.hypot(dx, dy) || 1
      const offset = laneOffsets[index]
      const segmentNormal = { x: -dy / length * offset, y: dx / length * offset }
      const start = { x: segment.start.x + segmentNormal.x, y: segment.start.y + segmentNormal.y }
      const end = { x: segment.end.x + segmentNormal.x, y: segment.end.y + segmentNormal.y }
      const selected = segment.line.id === selectedLineId
      const connectionSelected = selectedConnection?.lineId === segment.line.id && selectedConnection.startId === segment.originalStartId && selectedConnection.endId === segment.originalEndId
      ctx.save()
      ctx.globalAlpha = 1
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round'
      if (segment.line.style === 'hollow') {
        const railOffset = 2
        const railDx = -dy / length * railOffset
        const railDy = dx / length * railOffset
        ctx.lineWidth = connectionSelected ? 3 : 2
        ctx.strokeStyle = segment.line.color
        ctx.setLineDash([])
        ;[
          [{ x: start.x + railDx, y: start.y + railDy }, { x: end.x + railDx, y: end.y + railDy }],
          [{ x: start.x - railDx, y: start.y - railDy }, { x: end.x - railDx, y: end.y - railDy }],
        ].forEach(([railStart, railEnd]) => {
          ctx.beginPath(); ctx.moveTo(railStart.x, railStart.y); ctx.lineTo(railEnd.x, railEnd.y); ctx.stroke()
        })
        if (selected) drawShimmer(ctx, start, end, shimmerPhase, railDx, railDy)
      } else {
        ctx.lineWidth = connectionSelected ? laneWidth + 3 : laneWidth
        ctx.strokeStyle = segment.line.color
        ctx.setLineDash(segment.line.style === 'dashed' ? [24, 20] : segment.line.style === 'dotted' ? [2, 14] : [])
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke()
        if (selected) drawShimmer(ctx, start, end, shimmerPhase)
      }
      ctx.restore()
    })
  })
}

function drawShimmer(ctx: CanvasRenderingContext2D, start: Point, end: Point, phase: number, railDx = 0, railDy = 0) {
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.setLineDash([8, 72])
  ctx.lineDashOffset = -(phase * 18) % 80
  const rails = railDx || railDy
    ? [{ x: railDx, y: railDy }, { x: -railDx, y: -railDy }]
    : [{ x: 0, y: 0 }]
  rails.forEach((rail) => {
    ctx.beginPath()
    ctx.moveTo(start.x + rail.x, start.y + rail.y)
    ctx.lineTo(end.x + rail.x, end.y + rail.y)
    ctx.stroke()
  })
  ctx.restore()
}

function drawBusIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = '#17212b'
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.roundRect(x + 1, y - 8, 15, 12, 3)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + 1, y - 2)
  ctx.lineTo(x + 16, y - 2)
  ctx.moveTo(x + 5, y - 6)
  ctx.lineTo(x + 8, y - 6)
  ctx.moveTo(x + 10, y - 6)
  ctx.lineTo(x + 13, y - 6)
  ctx.stroke()
  ctx.fillStyle = '#17212b'
  ctx.beginPath()
  ctx.arc(x + 5, y + 5, 1.5, 0, Math.PI * 2)
  ctx.arc(x + 13, y + 5, 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
function drawRailIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = '#17212b'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x + 4, y - 8)
  ctx.lineTo(x + 4, y + 6)
  ctx.moveTo(x + 14, y - 8)
  ctx.lineTo(x + 14, y + 6)
  ctx.stroke()
  ctx.lineWidth = 1.2
  for (let sleeperY = y - 6; sleeperY <= y + 5; sleeperY += 4) {
    ctx.beginPath()
    ctx.moveTo(x + 1, sleeperY)
    ctx.lineTo(x + 17, sleeperY)
    ctx.stroke()
  }
  ctx.restore()
}
function iconGlyph(icon: StationIcon) { return icon === 'train' ? '🚈︎' : icon === 'plane' ? '✈︎' : icon === 'ship' ? '⛴︎' : '' }
function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}
function readableText(color: string) {
  const value = canonicalColor(color).replace('#', '')
  if (value.length !== 6) return '#fff'
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16))
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#17212b' : '#fff'
}
function canonicalColor(color: string) {
  return color.trim().toLowerCase()
}
function lineOutlineStyle(style: LineStyle) {
  return style === 'hollow' ? 'double' : style
}
function pointKey(point: Point) {
  return `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`
}
function connectionKey(startId: string, endId: string) {
  return [startId, endId].sort().join('|')
}
function isConnectionDeleted(line: MetroLine, startId: string, endId: string) {
  return line.deletedConnections?.includes(connectionKey(startId, endId)) ?? false
}
function lineConnectionPairs(line: MetroLine) {
  const pairs = line.stationIds.slice(0, -1).map((startId, index) => ({ startId, endId: line.stationIds[index + 1] }))
  if (line.loop && line.stationIds.length > 2) pairs.push({ startId: line.stationIds[line.stationIds.length - 1], endId: line.stationIds[0] })
  return pairs
}
function lineComponents(line: MetroLine) {
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
function connectedStationIds(line: MetroLine) {
  const ids = new Set<string>()
  lineComponents(line).forEach(([start, end]) => line.stationIds.slice(start, end + 1).forEach((id) => ids.add(id)))
  return ids
}
function lineConnects(line: MetroLine, startId: string, endId: string) {
  return lineConnectionPairs(line).some((pair) => ((pair.startId === startId && pair.endId === endId) || (pair.startId === endId && pair.endId === startId)) && !isConnectionDeleted(line, pair.startId, pair.endId))
}
function insertStationByProximity(line: MetroLine, stationId: string, stationsById: Map<string, Station>) {
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
function fallbackStationName(map: MetroMap, station: Station) {
  if (station.ghost) return ''
  const count = map.stations.filter((item) => Boolean(item.ghost) === Boolean(station.ghost)).findIndex((item) => item.id === station.id) + 1
  return station.ghost ? `Waypoint ${count}` : `Station ${count}`
}
function isWaypoint(station: Station) {
  return station.ghost === true || station.id.startsWith('w-')
}
function snapPoint(point: Point): Point {
  return { x: Math.round(point.x / GRID_SIZE) * GRID_SIZE, y: Math.round(point.y / GRID_SIZE) * GRID_SIZE }
}
function zoomViewport(viewport: Viewport, factor: number, anchor: Point = { x: WORKSPACE.width / 2, y: WORKSPACE.height / 2 }): Viewport {
  const scale = Math.max(0.5, Math.min(3, viewport.scale * factor))
  const worldAnchor = { x: (anchor.x - viewport.x) / viewport.scale, y: (anchor.y - viewport.y) / viewport.scale }
  return { scale, x: anchor.x - worldAnchor.x * scale, y: anchor.y - worldAnchor.y * scale }
}
function moveStation(map: MetroMap, station: Station, point: Point, offset: Point, snapToGrid: boolean): Station {
  let target = { x: point.x - offset.x, y: point.y - offset.y }
  if (snapToGrid) target = snapPoint(target)
  return { ...station, x: target.x, y: target.y }
}
function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}
function mergeManualInterchange(groups: string[][], firstId: string, secondId: string) {
  const merged = groups.filter((group) => group.includes(firstId) || group.includes(secondId)).flat()
  const remaining = groups.filter((group) => !group.includes(firstId) && !group.includes(secondId))
  return [...remaining, [...new Set([...merged, firstId, secondId])]]
}
function shortestRoute(map: MetroMap, from: string, to: string) {
  if (from === to) return [from]
  const graph = new Map<string, Set<string>>()
  map.lines.forEach((line) => {
    line.stationIds.forEach((id) => { if (!graph.has(id)) graph.set(id, new Set()) })
    lineConnectionPairs(line).forEach(({ startId, endId }) => {
      if (isConnectionDeleted(line, startId, endId)) return
      graph.get(startId)!.add(endId)
      graph.get(endId)!.add(startId)
    })
  })
  ;(map.manualInterchanges ?? []).forEach((group) => group.forEach((id) => {
    group.forEach((otherId) => {
      if (id !== otherId && graph.has(id) && graph.has(otherId)) graph.get(id)!.add(otherId)
    })
  }))
  const queue = [from]; const previous = new Map<string, string | null>([[from, null]])
  while (queue.length) { const current = queue.shift()!; for (const next of graph.get(current) ?? []) if (!previous.has(next)) { previous.set(next, current); queue.push(next); if (next === to) { const path = [to]; let cursor: string | null = to; while (previous.get(cursor) !== null) { cursor = previous.get(cursor)!; path.unshift(cursor) } return path } } }
  return []
}
function analyzeRoutes(map: MetroMap, junctionIds: Set<string>): RouteAnalysis[] {
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

  const stationIds = map.stations.filter((station) => !station.ghost).map((station) => station.id)
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
      const target = [...toLines].map((lineId) => nodeKey(toId, lineId)).filter((key) => distances.has(key)).sort((left, right) => distances.get(left)! - distances.get(right)!)[0]
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
          transfers.push({ stationId: previousNode.stationId, type: junctionIds.has(previousNode.stationId) ? 'junction' : 'interchange' })
        }
      })
      routes.push({ fromId, toId, changes: transfers.length, lineIds, transfers })
    })
  })
  return routes.sort((left, right) => right.changes - left.changes || left.fromId.localeCompare(right.fromId) || left.toId.localeCompare(right.toId))
}
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'metro-map' }
function download(blob: Blob, name: string) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href) }
