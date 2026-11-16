import { describe, expect, it } from 'vitest'
import { analyzeRoutes, getInterchangeIds, shortestRoute } from './routing'
import { initialMap } from './map'
import type { MetroMap, Station } from './types'

describe('routing helpers', () => {
  it('finds a shortest route through connected line stations', () => {
    expect(shortestRoute(initialMap, 's1', 's3')).toEqual(['s1', 's2', 's3'])
  })

  it('uses manual interchanges in shortest routes', () => {
    const map: MetroMap = {
      ...initialMap,
      stations: initialMap.stations.map((station) => station.id === 's2'
        ? { ...station, name: 'Interchange' }
        : station),
      manualInterchanges: [{ id: 'i1', stations: [{ id: 's1', showName: true }, { id: 's3', showName: true }] }],
    }

    expect(shortestRoute(map, 's1', 's3')).toEqual(['s1', 's3'])
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

  it('handles shared segments, waypoints, and explicit interchange styles', () => {
    const stations: Station[] = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      name: id,
      kind: 'station' as const,
      x: 0,
      y: 0,
      labelOffset: { x: 0, y: -30 },
      icons: [],
    }))
    stations[0].interchangeStyle = 'regular'
    stations[3].interchangeStyle = 'converging'
    const map: MetroMap = {
      version: 1,
      title: 'Shared segments',
      stations,
      lines: [
        { id: 'l1', name: 'One', color: '#111', style: 'solid', stationIds: ['a', 'b', 'c'] },
        { id: 'l2', name: 'Two', color: '#222', style: 'solid', stationIds: ['a', 'b', 'c'] },
        { id: 'l3', name: 'Three', color: '#333', style: 'solid', stationIds: ['c', 'd'] },
      ],
      lineGroups: [],
    }

    expect(getInterchangeIds(map)).toEqual(new Set(['c', 'd']))
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
      manualInterchanges: [{ id: 'i1', stations: [{ id: 'b', showName: true }, { id: 'c', showName: true }] }],
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

  it('analyzes junction transfers and chooses the cheapest destination line', () => {
    const map: MetroMap = {
      version: 1,
      title: 'Junction routes',
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
        { id: 'l2', name: 'Two', color: '#222', style: 'solid', stationIds: ['b', 'c'] },
        { id: 'l3', name: 'Three', color: '#333', style: 'solid', stationIds: ['b', 'c', 'd'] },
      ],
      lineGroups: [],
    }

    expect(analyzeRoutes(map, new Set(['b']))).toEqual(expect.arrayContaining([
      {
        fromId: 'a',
        toId: 'd',
        changes: 1,
        lineIds: ['l1', 'l3'],
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
