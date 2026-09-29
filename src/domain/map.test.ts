import { describe, expect, it } from 'vitest'
import {
  alphabetName,
  deleteLineGroup,
  generatedLineName,
  initialMap,
  moveLineToGroup,
  normalizeMap,
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
})
