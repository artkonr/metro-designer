import { describe, expect, it } from 'vitest'
import {
  alphabetName,
  applyGroupNaming,
  connectedStationIds,
  deleteLineGroup,
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
      lineIds: [],
    }
    expect(generatedLineName(group, 2)).toBe('M3')
  })

  it('normalizes legacy waypoints and assigns ungrouped lines', () => {
    const source: MetroMap = {
      ...initialMap,
      stations: [{ ...initialMap.stations[0], id: 'w-legacy', name: 'Old waypoint' }],
      lines: [{ ...initialMap.lines[0], groupId: undefined }],
      lineGroups: undefined,
    }
    const normalized = normalizeMap(source)

    expect(normalized.stations[0]).toMatchObject({ ghost: true, name: '', hideLabel: true })
    expect(normalized.lines[0].groupId).toBe('g-metro')
    expect(normalized.lineGroups?.[0].lineIds).toContain(normalized.lines[0].id)
  })

  it('moves deleted-group lines to the ephemeral Unassigned group', () => {
    const map = structuredClone(initialMap)
    const next = deleteLineGroup(map, 'g-metro')

    expect(next.lines.every((line) => line.groupId === 'g-unassigned')).toBe(true)
    expect(next.lineGroups?.[0]).toMatchObject({ id: 'g-unassigned', ephemeral: true })
    expect(next.lines.map((line) => line.name)).toEqual(map.lines.map((line) => line.name))
  })

  it('preserves auto-generated simple names when moving between groups', () => {
    const map = structuredClone(initialMap)
    map.lines[0] = { ...map.lines[0], name: 'Line 4', nameOverridden: false }
    map.lineGroups = [
      ...map.lineGroups!,
      { id: 'g-1', name: 'Group 1', style: 'solid', namingPattern: 'simple', lineIds: [] },
    ]

    const next = moveLineToGroup(map, 'l1', 'g-1')

    expect(next.lines.find((line) => line.id === 'l1')?.name).toBe('Line 4')
  })

  it('regenerates only non-overridden names when group naming changes', () => {
    const map = structuredClone(initialMap)
    map.lines = [
      { ...map.lines[0], name: 'Line 1', nameOverridden: false },
      { ...map.lines[1], name: 'Custom route', nameOverridden: true },
    ]

    const next = applyGroupNaming(map, 'g-metro', { namingPattern: 'numbered', namingPrefix: 'M' })

    expect(next.lines[0].name).toBe('M1')
    expect(next.lines[1].name).toBe('Custom route')
  })

  it('regenerates non-overridden names when moving to numbered groups', () => {
    const map = structuredClone(initialMap)
    map.lines[0] = { ...map.lines[0], name: 'Line 4', nameOverridden: false }
    map.lineGroups = [
      ...map.lineGroups!,
      { id: 'g-numbered', name: 'Numbered', style: 'solid', namingPattern: 'numbered', lineIds: [] },
    ]

    const next = moveLineToGroup(map, 'l1', 'g-numbered')

    expect(next.lines.find((line) => line.id === 'l1')?.name).toBe('1')
  })

  it('handles loops and deleted line components', () => {
    const line = { ...initialMap.lines[0], loop: true, deletedConnections: ['s1|s2'] }
    expect(lineConnectionPairs(line)).toHaveLength(3)
    expect(lineComponents(line)).toEqual([[1, 2]])
  })

  it('orders numbered and alphabetic line names naturally', () => {
    const numbered = { id: 'g', name: 'G', style: 'solid' as const, namingPattern: 'numbered' as const, lineIds: [] }
    const alphabetic = { ...numbered, namingPattern: 'alphabet' as const }
    expect(lineNameOrder({ ...initialMap.lines[0], name: 'M12' }, { ...numbered, namingPrefix: 'M' })).toBe(12)
    expect(lineNameOrder({ ...initialMap.lines[0], name: 'AB' }, alphabetic)).toBe(28)
  })

  it('inserts a station into the nearest segment and merges manual interchanges', () => {
    const stations = new Map(initialMap.stations.map((station) => [station.id, station]))
    stations.set('new', { ...initialMap.stations[0], id: 'new', x: 380, y: 260 })
    expect(insertStationByProximity(initialMap.lines[0], 'new', stations)).toEqual(['s1', 'new', 's2', 's3'])
    expect(mergeManualInterchange([['s1', 's2'], ['s3']], 's2', 's3')).toEqual([['s1', 's2', 's3']])
  })

  it('checks line connectivity and deleted connections', () => {
    const line = { ...initialMap.lines[0], deletedConnections: ['s1|s2'] }
    expect(isConnectionDeleted(line, 's2', 's1')).toBe(true)
    expect(lineConnects(line, 's1', 's2')).toBe(false)
    expect(lineConnects(line, 's2', 's3')).toBe(true)
    expect(connectedStationIds(line)).toEqual(new Set(['s2', 's3']))
  })

  it('handles waypoint and fallback station names', () => {
    const waypoint = { ...initialMap.stations[0], id: 'w-1', ghost: undefined }
    expect(isWaypoint(waypoint)).toBe(true)
    expect(fallbackStationName(initialMap, initialMap.stations[0])).toBe('Station 1')
    expect(fallbackStationName({ ...initialMap, stations: [waypoint] }, { ...waypoint, ghost: true })).toBe('')
  })

  it('removes empty ephemeral groups and handles missing insertion stations', () => {
    const map = { ...initialMap, lineGroups: [{ id: 'g-unassigned', name: 'Unassigned', style: 'solid' as const, namingPattern: 'simple' as const, lineIds: [], ephemeral: true }] }
    expect(removeEmptyUnassigned(map).lineGroups).toEqual([])
    expect(insertStationByProximity(initialMap.lines[0], 'missing', new Map())).toEqual(['s1', 's2', 's3', 'missing'])
  })
})
