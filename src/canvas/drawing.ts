import { GRID_SIZE, WORKSPACE } from '../domain/constants'
import { isConnectionDeleted, lineComponents, lineConnectionPairs } from '../domain/map'
import type { FrameSelection, LineEndpointLabel, LineStyle, MetroLine, MetroMap, Point, SelectedConnection, Station, StationIcon, Viewport } from '../domain/types'
import { pointKey, stationLabelOffset } from './geometry'

export function drawMap(
  canvas: HTMLCanvasElement | null,
  map: MetroMap,
  interchangeIds: Set<string>,
  route: string[],
  selectedStationIds: string[],
  selectedLineId: string | null,
  selectedConnection: SelectedConnection | null,
  snapToGrid: boolean,
  shimmerPhase: number,
  viewport: Viewport,
  frameSelection: FrameSelection | null,
  size = WORKSPACE,
) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== size.width * dpr) canvas.width = size.width * dpr
  if (canvas.height !== size.height * dpr) canvas.height = size.height * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillStyle = '#fbfcfe'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.save()
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)
  const stations = new Map(map.stations.map((station) => [station.id, station]))
  drawManualInterchanges(ctx, map.manualInterchanges ?? [], stations)
  ctx.strokeStyle = '#e7edf3'
  ctx.lineWidth = 1
  const gridStartX = Math.floor((-viewport.x / viewport.scale) / GRID_SIZE) * GRID_SIZE - GRID_SIZE
  const gridEndX = Math.ceil(((size.width - viewport.x) / viewport.scale) / GRID_SIZE) * GRID_SIZE + GRID_SIZE
  const gridStartY = Math.floor((-viewport.y / viewport.scale) / GRID_SIZE) * GRID_SIZE - GRID_SIZE
  const gridEndY = Math.ceil(((size.height - viewport.y) / viewport.scale) / GRID_SIZE) * GRID_SIZE + GRID_SIZE
  for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) {
    ctx.beginPath()
    ctx.moveTo(x, gridStartY)
    ctx.lineTo(x, gridEndY)
    ctx.stroke()
  }
  for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) {
    ctx.beginPath()
    ctx.moveTo(gridStartX, y)
    ctx.lineTo(gridEndX, y)
    ctx.stroke()
  }
  if (snapToGrid) {
    ctx.fillStyle = '#d8e1e9'
    for (let x = gridStartX; x <= gridEndX; x += GRID_SIZE) {
      for (let y = gridStartY; y <= gridEndY; y += GRID_SIZE) ctx.fillRect(x - 1, y - 1, 2, 2)
    }
  }
  drawSegments(ctx, map, stations, selectedLineId, selectedConnection, shimmerPhase)
  if (route.length > 1) {
    ctx.save()
    ctx.strokeStyle = '#111827'
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 4
    ctx.setLineDash([2, 7])
    ctx.beginPath()
    route
      .map((id) => stations.get(id))
      .filter(Boolean)
      .forEach((point, index) => index ? ctx.lineTo(point!.x, point!.y) : ctx.moveTo(point!.x, point!.y))
    ctx.stroke()
    ctx.restore()
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
    ctx.save()
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = selected ? '#111827' : '#263442'
    ctx.lineWidth = selected ? 4 : 3
    if (station.ghost) {
      const lineColor = map.lines.find((line) => line.stationIds.includes(station.id))?.color ?? '#93a0ab'
      const converges = map.lines.filter((line) => line.stationIds.includes(station.id)).length > 1
      const radius = converges ? (selected ? 8 : 7) : (selected ? 5 : 4)
      ctx.fillStyle = lineColor
      ctx.strokeStyle = selected ? '#111827' : lineColor
      ctx.lineWidth = selected ? 2 : 1
      ctx.beginPath()
      ctx.arc(station.x, station.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else if (interchangeIds.has(station.id)) {
      ctx.translate(station.x, station.y)
      ctx.rotate(Math.PI / 4)
      ctx.beginPath()
      ctx.roundRect(-10, -10, 20, 20, 3)
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(station.x, station.y, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
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
      const nameLines = station.name.split('\n')
      const nameWidth = Math.max(...nameLines.map((name) => ctx.measureText(name).width))
      const hasCustomRailIcon = station.icon === 'train'
      const hasCustomBusIcon = station.icon === 'bus'
      if (!icon && !hasCustomRailIcon && !hasCustomBusIcon) {
        ctx.textAlign = labelAngle === 90 ? 'left' : labelAngle === 270 ? 'right' : 'center'
        nameLines.forEach((name, index) => {
          ctx.fillText(name, labelX, labelY + (index - (nameLines.length - 1) / 2) * 16)
        })
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
        nameLines.forEach((name, index) => {
          ctx.fillText(name, left + iconWidth + 4, labelY + (index - (nameLines.length - 1) / 2) * 16)
        })
      }
    }
  })
  ctx.restore()
}

export function getLineEndpointLabels(map: MetroMap, stations: Map<string, Station>): LineEndpointLabel[] {
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
      const dimensions = measureLabelDimensions(label)
      return { label, ...dimensions, color: line.color }
    })
    const gap = 4
    const totalHeight = dimensions.reduce((sum, item) => sum + item.height, 0) + Math.max(0, dimensions.length - 1) * gap
    let y = station.y + groupOffset.y - totalHeight / 2
    group.forEach((endpoint, index) => {
      const dimension = dimensions[index]
      labels.push({
        key: endpoint.key,
        groupKey: stationId,
        group: true,
        station,
        ...dimension,
        center: { x: station.x + groupOffset.x, y: y + dimension.height / 2 },
      })
      y += dimension.height + gap
    })
  })
  endpoints
    .filter(({ station }) => (endpointCounts.get(station.id) ?? 0) === 1)
    .forEach((endpoint) => {
      const dx = endpoint.station.x - endpoint.neighbor.x
      const dy = endpoint.station.y - endpoint.neighbor.y
      const length = Math.hypot(dx, dy) || 1
      const baseCenter = { x: endpoint.station.x + dx / length * 30, y: endpoint.station.y + dy / length * 30 }
      const offset = map.lineLabelOffsets?.[endpoint.key] ?? { x: 0, y: 0 }
      const label = endpoint.line.name || 'Unnamed line'
      const dimensions = measureLabelDimensions(label)
      labels.push({
        key: endpoint.key,
        groupKey: endpoint.station.id,
        group: false,
        station: endpoint.station,
        label,
        ...dimensions,
        color: endpoint.line.color,
        center: { x: baseCenter.x + offset.x, y: baseCenter.y + offset.y },
      })
    })
  return labels
}

export function iconGlyph(icon: StationIcon) {
  return icon === 'train' ? '🚈︎' : icon === 'plane' ? '✈︎' : icon === 'ship' ? '⛴︎' : ''
}

export function canonicalColor(color: string) {
  return color.trim().toLowerCase()
}

export function readableText(color: string) {
  const value = canonicalColor(color).replace('#', '')
  if (value.length !== 6) return '#fff'
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16))
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#17212b' : '#fff'
}

export function lineOutlineStyle(style: LineStyle) {
  return style === 'hollow' ? 'double' : style
}

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
    const lines = label.label.split('\n')
    lines.forEach((line, index) => {
      ctx.fillText(line, label.center.x, label.center.y + (index - (lines.length - 1) / 2) * 12)
    })
    ctx.restore()
  })
}

function measureLabelDimensions(label: string) {
  const lines = label.split('\n')
  return {
    width: Math.max(...lines.map((line) => line.length * 6.5 + 12)),
    height: lines.length * 17,
  }
}

function drawSegments(
  ctx: CanvasRenderingContext2D,
  map: MetroMap,
  stations: Map<string, Station>,
  selectedLineId: string | null,
  selectedConnection: SelectedConnection | null,
  shimmerPhase: number,
) {
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
    const laneOffsets = visible
      .map((_, index) => (index - (visible.length - 1) / 2) * laneWidth)
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
      const connectionSelected = selectedConnection?.lineId === segment.line.id
        && selectedConnection.startId === segment.originalStartId
        && selectedConnection.endId === segment.originalEndId
      ctx.save()
      ctx.globalAlpha = 1
      ctx.lineCap = 'butt'
      ctx.lineJoin = 'round'
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
          ctx.beginPath()
          ctx.moveTo(railStart.x, railStart.y)
          ctx.lineTo(railEnd.x, railEnd.y)
          ctx.stroke()
        })
        if (selected) drawShimmer(ctx, start, end, shimmerPhase, railDx, railDy)
      } else {
        ctx.lineWidth = connectionSelected ? laneWidth + 3 : laneWidth
        ctx.strokeStyle = segment.line.color
        ctx.setLineDash(segment.line.style === 'dashed' ? [24, 20] : segment.line.style === 'dotted' ? [2, 14] : [])
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
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
