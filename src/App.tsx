import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import { canonicalColor, drawMap, getLineEndpointLabels, lineOutlineStyle, readableText } from './canvas/drawing'
import { distanceToSegment, labelOffsetForAngle, nearestLabelAngle, pointKey, snapPoint, stationLabelOffset, zoomViewport, moveStation } from './canvas/geometry'
import { Inspector } from './components/Inspector'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { MapCanvas } from './components/MapCanvas'
import { COLORS, UNASSIGNED_GROUP_ID, WORKSPACE } from './domain/constants'
import { cloneMap, connectionKey, deleteLineGroup, emptyMap, generatedLineName, initialMap, insertStationByProximity, isConnectionDeleted, lineConnectionPairs, lineNameOrder, mergeManualInterchange, nextId, removeEmptyUnassigned } from './domain/map'
import { analyzeRoutes, getInterchangeIds, shortestRoute } from './domain/routing'
import type { DragState, FrameSelection, LineNamingPattern, LineStyle, MetroLine, Point, RouteAnalysis, SelectedConnection, Station, StationDragState, StationIcon, Tool, Viewport } from './domain/types'
import { downloadMapYaml, exportMapPng, parseMapFile } from './io/mapFiles'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMapHistory } from './hooks/useMapHistory'

export default function App() {
  const { map, mapRef, undoCount, updateMap, beginDragHistory, finishDragHistory, undo } = useMapHistory(() => cloneMap(initialMap))
  const [tool, setTool] = useState<Tool>('select')
  const [selectedStationId, setSelectedStationId] = useState<string | null>('s1')
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>(['s1'])
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>('g-metro')
  const [selectedConnection, setSelectedConnection] = useState<SelectedConnection | null>(null)
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
  const [shimmerPhase, setShimmerPhase] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [drag, setDrag] = useState<DragState>(null)
  const pendingDragPointRef = useRef<Point | null>(null)
  const dragUpdateFrameRef = useRef<number | null>(null)
  const drawFrameRef = useRef<number | null>(null)
  const [frameSelection, setFrameSelection] = useState<FrameSelection | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stationNameInputRef = useRef<HTMLTextAreaElement>(null)
  const lineNameInputRef = useRef<HTMLTextAreaElement>(null)
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
  const interchangeIds = useMemo(() => getInterchangeIds(map), [map])
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

  const rotateSelectedStationLabels = () => {
    if (!selectedStationId) return
    updateMap((current) => ({
      ...current,
      stations: current.stations.map((station) => {
        if (!selectedStationIds.includes(station.id)) return station
        const currentAngle = station.labelAngle ?? nearestLabelAngle(station.labelOffset)
        const nextAngle = (currentAngle + 45) % 360
        return { ...station, labelAngle: nextAngle, labelOffset: labelOffsetForAngle(nextAngle) }
      }),
    }))
  }

  useKeyboardShortcuts({
    selectedStationId,
    selectedLineId,
    tool,
    showHelp,
    statsOpen: Boolean(statsReport),
    stationNameInputRef,
    lineNameInputRef,
    stationLineSelectRef,
    lineGroupSelectRef,
    onHideHelp: () => setShowHelp(false),
    onHideStats: () => setStatsReport(null),
    onSelectToolShortcut: (nextTool) => {
      setTool(nextTool)
      setStatus(`${nextTool[0].toUpperCase()}${nextTool.slice(1)} tool selected`)
    },
    onExitTextEditing: () => setTool('select'),
    onExitFrameSelection: () => {
      setTool('select')
      setFrameSelection(null)
    },
    onUndo: undo,
    onDeleteSelected: deleteSelected,
    onZoomShortcut: (factor) => setViewport((current) => zoomViewport(current, factor)),
    onAddLine: addLine,
    onAddLineGroup: addLineGroup,
    onRotateSelectedStationLabels: rotateSelectedStationLabels,
    onMoveSelectedStation: moveSelectedStation,
    onPanViewport: (code) => {
      const step = 80
      setViewport((current) => ({
        ...current,
        x: current.x + (code === 'KeyA' ? step : code === 'KeyD' ? -step : 0),
        y: current.y + (code === 'KeyW' ? step : code === 'KeyS' ? -step : 0),
      }))
    },
  })

  const saveMap = () => {
    downloadMapYaml(map)
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
    const normalized = await parseMapFile(file)
    updateMap(() => normalized)
    setSelectedStationId(normalized.stations[0]?.id ?? null)
    setSelectedStationIds(normalized.stations[0] ? [normalized.stations[0].id] : [])
    setSelectedLineId(null)
    setSelectedGroupId(normalized.lineGroups?.[0]?.id ?? null)
    setSelectedConnection(null)
    setStationNavigationLineId(normalized.lines[0]?.id ?? null)
    setActiveLineId(normalized.lines[0]?.id ?? null)
    setPlacementLineId(null)
    setInterchangeAnchorId(null)
    setStatus('Map opened')
  }

  const exportPng = () => {
    exportMapPng({ map, interchangeIds, route, selectedStationIds, selectedLineId, selectedConnection, snapToGrid, shimmerPhase })
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
      <KeyboardShortcuts open={showHelp} onClose={() => setShowHelp(false)} />
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
          <MapCanvas
            canvasRef={canvasRef}
            status={status}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          />
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

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>
}
