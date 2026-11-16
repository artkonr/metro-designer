import yaml from 'js-yaml'

import { drawMap, getLineEndpointLabels, stationIconLayout } from '../canvas/drawing'
import { stationLabelOffset } from '../canvas/geometry'
import { WORKSPACE } from '../domain/constants'
import { normalizeMap, stationIcons } from '../domain/map'
import type { Interchange, MetroMap, SelectedConnection, Station } from '../domain/types'

type ExportedMap = Omit<MetroMap, 'manualInterchanges'> & { interchanges: Interchange[] }

export async function parseMapFile(file: File): Promise<MetroMap> {
  const text = await file.text()
  const parsed = (file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : yaml.load(text)) as MetroMap & { interchanges?: Interchange[] }
  if (
    !parsed
    || parsed.version !== 1
    || !Array.isArray(parsed.stations)
    || !parsed.stations.every((station) => station.kind === 'station' || station.kind === 'waypoint')
    || !parsed.stations.every((station) => Array.isArray(station.icons))
    || !Array.isArray(parsed.lines)
    || (parsed.termini !== undefined && !isTerminusLabelOffsets(parsed.termini))
  ) {
    throw new Error('Unsupported map file')
  }
  const { interchanges, ...source } = parsed
  return normalizeMap({
    ...source,
    manualInterchanges: source.manualInterchanges ?? interchanges,
  })
}

export function downloadMapYaml(map: MetroMap) {
  const blob = new Blob([yaml.dump(exportableMap(map), { noRefs: true })], { type: 'text/yaml' })
  downloadBlob(blob, `${slug(map.title)}.yaml`)
}

export function downloadMapJson(map: MetroMap) {
  const blob = new Blob([JSON.stringify(exportableMap(map))], { type: 'application/json' })
  downloadBlob(blob, `${slug(map.title)}.json`)
}

export function exportMapPng({
  map,
  interchangeIds,
  route,
  selectedStationIds,
  selectedLineId,
  selectedConnection,
  snapToGrid,
  shimmerPhase,
}: {
  map: MetroMap
  interchangeIds: Set<string>
  route: string[]
  selectedStationIds: string[]
  selectedLineId: string | null
  selectedConnection: SelectedConnection | null
  snapToGrid: boolean
  shimmerPhase: number
}) {
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
    const hiddenByInterchange = (map.manualInterchanges ?? []).some((group) => group.stations.some((item) => item.id === station.id && !item.showName))
    if (station.kind === 'waypoint' || !station.name.trim() || hiddenByInterchange) return
    const offset = stationLabelOffset(station)
    const labelX = station.x + offset.x
    const labelY = station.y + offset.y
    const measureContext = exportCanvas.getContext('2d')
    if (!measureContext) return
    measureContext.font = '600 14px Inter, system-ui, sans-serif'
    const icons = stationIcons(station)
    const iconLayout = icons.length ? stationIconLayout(icons.length) : null
    const nameLines = station.name.split('\n')
    const nameWidth = Math.max(...nameLines.map((name) => measureContext.measureText(name).width))
    const nameHeight = nameLines.length * 16
    const width = nameWidth + (iconLayout ? iconLayout.width + 4 : 0)
    const height = Math.max(nameHeight, iconLayout?.height ?? 0)
    const left = station.labelAngle === 90 ? labelX : station.labelAngle === 270 ? labelX - width : labelX - width / 2
    includeRect(left, labelY - height / 2, left + width, labelY + height / 2)
  })
  ;(map.manualInterchanges ?? []).forEach((group) => {
    const groupStations = group.stations.map(({ id }) => stations.get(id)).filter((station): station is Station => Boolean(station))
    if (!groupStations.length) return
    includeRect(
      Math.min(...groupStations.map((station) => station.x)) - 22,
      Math.min(...groupStations.map((station) => station.y)) - 22,
      Math.max(...groupStations.map((station) => station.x)) + 22,
      Math.max(...groupStations.map((station) => station.y)) + 22,
    )
  })
  getLineEndpointLabels(map, stations).forEach((label) => includeRect(
    label.center.x - label.width / 2,
    label.center.y - label.height / 2,
    label.center.x + label.width / 2,
    label.center.y + label.height / 2,
  ))
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
  drawMap(
    exportCanvas,
    map,
    interchangeIds,
    route,
    selectedStationIds,
    selectedLineId,
    selectedConnection,
    snapToGrid,
    shimmerPhase,
    exportViewport,
    null,
    exportSize,
  )
  exportCanvas.toBlob((blob) => blob && downloadBlob(blob, `${slug(map.title)}.png`), 'image/png')
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'metro-map'
}

function exportableMap(map: MetroMap): ExportedMap {
  const { manualInterchanges, ...source } = map
  return {
    ...source,
    interchanges: manualInterchanges ?? [],
    termini: map.termini ?? [],
  }
}

function isTerminusLabelOffsets(value: unknown): boolean {
  return Array.isArray(value) && value.every((offset) => {
    if (!offset || typeof offset !== 'object') return false
    const candidate = offset as Record<string, unknown>
    const lines = candidate.lines
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.stationId !== 'string'
      || typeof candidate.x !== 'number'
      || !Number.isFinite(candidate.x)
      || typeof candidate.y !== 'number'
      || !Number.isFinite(candidate.y)
      || !Array.isArray(lines)
      || lines.length === 0
      || !lines.every((line) => Boolean(line) && typeof line === 'object' && typeof (line as Record<string, unknown>).lineId === 'string')
    ) return false
    const firstLineId = (lines[0] as Record<string, string>).lineId
    return candidate.id === `${firstLineId}:${candidate.stationId}`
  })
}

function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
