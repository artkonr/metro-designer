import { CARDINAL_LABEL_DISTANCE, GRID_SIZE, LABEL_DISTANCE, WORKSPACE } from '../domain/constants'
import type { MetroMap, Point, Station, Viewport } from '../domain/types'

export function labelOffsetForAngle(angle: number): Point {
  const radians = angle * Math.PI / 180
  const distance = angle % 90 === 0 ? CARDINAL_LABEL_DISTANCE : LABEL_DISTANCE
  return { x: Math.sin(radians) * distance, y: -Math.cos(radians) * distance }
}

export function nearestLabelAngle(offset: Point): number {
  const radians = Math.atan2(offset.x, -offset.y)
  const angle = (radians * 180 / Math.PI + 360) % 360
  return Math.round(angle / 45) * 45 % 360
}

export function stationLabelOffset(station: Station): Point {
  return station.labelAngle === undefined ? station.labelOffset : labelOffsetForAngle(station.labelAngle)
}

export function pointKey(point: Point) {
  return `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`
}

export function snapPoint(point: Point): Point {
  return { x: Math.round(point.x / GRID_SIZE) * GRID_SIZE, y: Math.round(point.y / GRID_SIZE) * GRID_SIZE }
}

export function zoomViewport(
  viewport: Viewport,
  factor: number,
  anchor: Point = { x: WORKSPACE.width / 2, y: WORKSPACE.height / 2 },
): Viewport {
  const scale = Math.max(0.5, Math.min(3, viewport.scale * factor))
  const worldAnchor = { x: (anchor.x - viewport.x) / viewport.scale, y: (anchor.y - viewport.y) / viewport.scale }
  return { scale, x: anchor.x - worldAnchor.x * scale, y: anchor.y - worldAnchor.y * scale }
}

export function moveStation(
  _map: MetroMap,
  station: Station,
  point: Point,
  offset: Point,
  snapToGrid: boolean,
): Station {
  let target = { x: point.x - offset.x, y: point.y - offset.y }
  if (snapToGrid) target = snapPoint(target)
  return { ...station, x: target.x, y: target.y }
}

export function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}
