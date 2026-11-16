import { describe, expect, it } from 'vitest'
import {
  alphabetName,
  applyGroupNaming,
  connectedStationIds,
  deleteLineGroup,
  effectiveLineName,
  fallbackStationName,
  generatedLineName,
  initialMap,
  insertStationByProximity,
  isConnectionDeleted,
  isWaypoint,
  lineConnects,
  lineComponents,
  lineConnectionPairs,
  lineNameOrder,
  mergeManualInterchange,
  moveLineToGroup,
  normalizeMap,
  removeEmptyUnassigned,
  resetLineName,
  reorderLine,
} from './map'
import type { LineGroup, MetroMap } from './types'

describe('map domain helpers', () => {
  it('generates alphabetic names beyond Z', () => {
    expect(alphabetName(0)).toBe('A')
    expect(alphabetName(25)).toBe('Z')
    expect(alphabetName(26)).toBe('AA')
  })

  it('generates names from group naming settings', () => {
    const group: LineGroup = {
      id: 'g',
      name: 'Metro',
      style: 'solid',
      namingPattern: 'numbered',
      namingPrefix: 'M',
    }
    expect(generatedLineName(group, 2)).toBe('M3')
  })

  it('derives missing names from order and rejects unnamed simple lines', () => {
    const numbered: LineGroup = { id: 'g', name: 'Metro', style: 'solid', namingPattern: 'numbered', namingPrefix: 'M' }
    const lines = [
      { ...initialMap.lines[0], id: 'a', name: undefined, lineGroupId: 'g', order: 0 },
      { ...initialMap.lines[1], id: 'b', name: 'Custom', lineGroupId: 'g', order: 1 },
    ]
    expect(effectiveLineName(lines[0], [numbered], lines)).toBe('M1')
    expect(effectiveLineName(lines[1], [numbered], lines)).toBe('Custom')

    expect(() => normalizeMap({
      ...initialMap,
      lineGroups: [{ ...numbered, namingPattern: 'simple' }],
      lines: [{ ...lines[0], lineGroupId: 'g', name: undefined }],
    })).toThrow('uses simple naming')
  })

  it('resets explicit names to group-derived naming', () => {
    const map: MetroMap = structuredClone(initialMap)
    map.lineGroups = [{ id: 'g', name: 'Metro', style: 'solid', namingPattern: 'numbered', namingPrefix: 'M' }]
    map.lines = [
      { ...map.lines[0], lineGroupId: 'g', order: 0, name: 'Custom' },
      { ...map.lines[1], lineGroupId: 'g', order: 1, name: 'Other' },
    ]

    const reset = resetLineName(map, 'l1')

    expect(reset.lines.find((line) => line.id === 'l1')?.name).toBeUndefined()
    expect(resetLineName({ ...map, lineGroups: [{ ...map.lineGroups[0], namingPattern: 'simple' }] }, 'l1').lines.find((line) => line.id === 'l1')?.name).toBe('Line 1')
  })

  it('normalizes waypoints and assigns ungrouped lines', () => {
    const source: MetroMap = {
      ...initialMap,
      stations: [{ ...initialMap.stations[0], id: 'w-1', kind: 'waypoint', name: 'Old waypoint' }],
      lines: [{ ...initialMap.lines[0], lineGroupId: undefined }],
      lineGroups: undefined,
    }
    const normalized = normalizeMap(source)

    expect(normalized.stations[0]).toMatchObject({ kind: 'waypoint', name: '' })
    expect(normalized.lines[0].lineGroupId).toBe('g-metro')
  })

  it('converts legacy style inheritance to optional line styles', () => {
    const source = structuredClone(initialMap) as MetroMap & { lines: (MetroMap['lines'][number] & { styleOverridden?: boolean })[] }
    source.lines[0] = { ...source.lines[0], style: 'dashed', styleOverridden: false }
    source.lines[1] = { ...source.lines[1], style: 'hollow', styleOverridden: true }

    const normalized = normalizeMap(source)

    expect(normalized.lines[0].style).toBeUndefined()
    expect(normalized.lines[1].style).toBe('hollow')
    expect('styleOverridden' in normalized.lines[0]).toBe(false)
    expect('styleOverridden' in normalized.lines[1]).toBe(false)
  })

  it('moves deleted-group lines to the ephemeral Unassigned group', () => {
    const map = structuredClone(initialMap)
    const next = deleteLineGroup(map, 'g-metro')

    expect(next.lines.every((line) => line.lineGroupId === 'g-unassigned')).toBe(true)
    expect(next.lineGroups?.[0]).toMatchObject({ id: 'g-unassigned', ephemeral: true })
    expect(next.lines.map((line) => line.name)).toEqual(map.lines.map((line) => line.name))
  })

  it('preserves auto-generated simple names when moving between groups', () => {
    const map = structuredClone(initialMap)
    map.lines[0] = { ...map.lines[0], name: 'Line 4' }
    map.lineGroups = [
      ...map.lineGroups!,
      { id: 'g-1', name: 'Group 1', style: 'solid', namingPattern: 'simple' },
    ]

    const next = moveLineToGroup(map, 'l1', 'g-1')

    expect(next.lines.find((line) => line.id === 'l1')?.name).toBe('Line 4')
  })

  it('regenerates only non-overridden names when group naming changes', () => {
    const map = structuredClone(initialMap)
    map.lines = [
      { ...map.lines[0], name: undefined },
      { ...map.lines[1], name: 'Custom route' },
    ]

    const next = applyGroupNaming(map, 'g-metro', { namingPattern: 'numbered', namingPrefix: 'M' })

    expect(next.lines[0].name).toBeUndefined()
    expect(next.lines[1].name).toBe('Custom route')
  })

  it('regenerates non-overridden names when moving to numbered groups', () => {
    const map = structuredClone(initialMap)
    map.lines[0] = { ...map.lines[0], name: undefined }
    map.lineGroups = [
      ...map.lineGroups!,
      { id: 'g-numbered', name: 'Numbered', style: 'solid', namingPattern: 'numbered' },
    ]

    const next = moveLineToGroup(map, 'l1', 'g-numbered')

    expect(next.lines.find((line) => line.id === 'l1')?.name).toBeUndefined()
  })

  it('handles loops and deleted line components', () => {
    const line = { ...initialMap.lines[0], loop: true, deletedConnections: ['s1|s2'] }
    expect(lineConnectionPairs(line)).toHaveLength(3)
    expect(lineComponents(line)).toEqual([[1, 2]])
  })

  it('orders numbered and alphabetic line names naturally', () => {
    const numbered = { id: 'g', name: 'G', style: 'solid' as const, namingPattern: 'numbered' as const }
    const alphabetic = { ...numbered, namingPattern: 'alphabet' as const }
    expect(lineNameOrder({ ...initialMap.lines[0], name: 'M12' }, { ...numbered, namingPrefix: 'M' })).toBe(12)
    expect(lineNameOrder({ ...initialMap.lines[0], name: 'AB' }, alphabetic)).toBe(28)
  })

  it('reorders lines explicitly and regenerates non-overridden names', () => {
    const map = structuredClone(initialMap)
    map.lines[0] = { ...map.lines[0], name: undefined, order: 0 }
    map.lines[1] = { ...map.lines[1], name: undefined, order: 1 }

    const next = reorderLine(map, 'g-metro', 'l2', 'l1')

    expect(next.lines.find((line) => line.id === 'l1')).toMatchObject({ order: 1 })
    expect(next.lines.find((line) => line.id === 'l2')).toMatchObject({ order: 0 })
  })

  it('inserts a station into the nearest segment and merges manual interchanges', () => {
    const stations = new Map(initialMap.stations.map((station) => [station.id, station]))
    stations.set('new', { ...initialMap.stations[0], id: 'new', x: 380, y: 260 })
    expect(insertStationByProximity(initialMap.lines[0], 'new', stations)).toEqual(['s1', 'new', 's2', 's3'])
    expect(mergeManualInterchange([
      { id: 'i1', stations: [{ id: 's1', showName: true }, { id: 's2', showName: false }] },
      { id: 'i2', stations: [{ id: 's3', showName: true }] },
    ], 's2', 's3')).toMatchObject([{ stations: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }])
  })

  it('checks line connectivity and deleted connections', () => {
    const line = { ...initialMap.lines[0], deletedConnections: ['s1|s2'] }
    expect(isConnectionDeleted(line, 's2', 's1')).toBe(true)
    expect(lineConnects(line, 's1', 's2')).toBe(false)
    expect(lineConnects(line, 's2', 's3')).toBe(true)
    expect(connectedStationIds(line)).toEqual(new Set(['s2', 's3']))
  })

  it('handles waypoint and fallback station names', () => {
    const waypoint = { ...initialMap.stations[0], id: 'w-1', kind: 'waypoint' as const }
    expect(isWaypoint(waypoint)).toBe(true)
    expect(fallbackStationName(initialMap, initialMap.stations[0])).toBe('Station 1')
    expect(fallbackStationName({ ...initialMap, stations: [waypoint] }, waypoint)).toBe('')
  })

  it('removes empty ephemeral groups and handles missing insertion stations', () => {
    const map = { ...initialMap, lineGroups: [{ id: 'g-unassigned', name: 'Unassigned', style: 'solid' as const, namingPattern: 'simple' as const, ephemeral: true }] }
    expect(removeEmptyUnassigned(map).lineGroups).toEqual([])
    expect(insertStationByProximity(initialMap.lines[0], 'missing', new Map())).toEqual(['s1', 's2', 's3', 'missing'])
  })
})
