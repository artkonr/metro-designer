import { describe, expect, it } from 'vitest'
import { analyzeRoutes, getInterchangeIds, shortestRoute } from './routing'
import { initialMap } from './map'
import type { MetroMap } from './types'

describe('routing helpers', () => {
  it('finds a shortest route through connected line stations', () => {
    expect(shortestRoute(initialMap, 's1', 's3')).toEqual(['s1', 's2', 's3'])
  })

  it('returns the start station for a zero-length route', () => {
    expect(shortestRoute(initialMap, 's1', 's1')).toEqual(['s1'])
  })

  it('returns no route for disconnected stations', () => {
    expect(shortestRoute(initialMap, 's1', 'missing')).toEqual([])
  })

  it('detects stations served by multiple lines', () => {
    expect(getInterchangeIds(initialMap)).toEqual(new Set(['s1', 's3']))
  })

  it('analyzes transfers between lines connected by a manual interchange', () => {
    const map: MetroMap = {
      version: 1,
      title: 'Routes',
      stations: ['a', 'b', 'c', 'd'].map((id, index) => ({
        id,
        name: id,
        kind: 'station' as const,
        x: index * 100,
        y: 0,
        labelOffset: { x: 0, y: -30 },
        icons: [],
      })),
      lines: [
        { id: 'l1', name: 'One', color: '#111', style: 'solid', stationIds: ['a', 'b'] },
        { id: 'l2', name: 'Two', color: '#222', style: 'solid', stationIds: ['c', 'd'] },
      ],
      lineGroups: [],
      manualInterchanges: [['b', 'c']],
    }

    expect(analyzeRoutes(map, new Set(['b']))).toEqual(expect.arrayContaining([
      {
        fromId: 'a',
        toId: 'd',
        changes: 1,
        lineIds: ['l1', 'l2'],
        transfers: [{ stationId: 'b', type: 'junction' }],
      },
    ]))
  })

  it('ignores deleted connections when finding routes', () => {
    const map = {
      ...initialMap,
      lines: initialMap.lines.map((line) => line.id === 'l1'
        ? { ...line, deletedConnections: ['s1|s2'] }
        : line),
    }

    expect(shortestRoute(map, 's1', 's2')).toEqual(['s1', 's4', 's3', 's2'])
  })
})
