import yaml from 'js-yaml'

import { drawMap, getLineEndpointLabels } from '../canvas/drawing'
import { stationLabelOffset } from '../canvas/geometry'
import { WORKSPACE } from '../domain/constants'
import { normalizeMap } from '../domain/map'
import type { MetroMap, SelectedConnection, Station } from '../domain/types'

export async function parseMapFile(file: File): Promise<MetroMap> {
  const parsed = yaml.load(await file.text()) as MetroMap
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.stations) || !Array.isArray(parsed.lines)) {
    throw new Error('Unsupported map file')
  }
  return normalizeMap({
    ...parsed,
    stations: parsed.stations.map((station) => ({ ...station, ghost: station.ghost ?? station.id.startsWith('w-') })),
  })
}

export function downloadMapYaml(map: MetroMap) {
  const blob = new Blob([yaml.dump(map, { noRefs: true })], { type: 'text/yaml' })
  downloadBlob(blob, `${slug(map.title)}.yaml`)
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

function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
