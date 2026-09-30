import { describe, expect, it, vi } from 'vitest'
import { initialMap } from '../domain/map'
import type { MetroMap } from '../domain/types'
import { drawMap, getLineEndpointLabels, iconGlyph, canonicalColor, lineOutlineStyle, readableText } from './drawing'

describe('drawing helpers', () => {
  it('maps station icons and line styles to rendering values', () => {
    expect(iconGlyph('train')).toContain('🚈')
    expect(iconGlyph('plane')).toContain('✈')
    expect(iconGlyph('ship')).toContain('⛴')
    expect(iconGlyph('bus')).toBe('')
    expect(canonicalColor('  #ABCDEF ')).toBe('#abcdef')
    expect(readableText('#ffffff')).toBe('#17212b')
    expect(readableText('#000000')).toBe('#fff')
    expect(readableText('invalid')).toBe('#fff')
    expect(lineOutlineStyle('hollow')).toBe('double')
    expect(lineOutlineStyle('dashed')).toBe('dashed')
  })

  it('creates grouped endpoint labels at shared termini', () => {
    const stations = new Map(initialMap.stations.map((station) => [station.id, station]))
    const labels = getLineEndpointLabels(initialMap, stations)

    expect(labels).toHaveLength(4)
    expect(labels.every((label) => label.group)).toBe(true)
    expect(labels.filter((label) => label.groupKey === 's1')).toHaveLength(2)
    expect(labels.map((label) => label.label)).toEqual(expect.arrayContaining(['Blue Line', 'Teal Line']))
  })

  it('creates individual endpoint labels and respects offsets', () => {
    const map: MetroMap = {
      version: 1,
      title: 'Single line',
      stations: [
        { id: 'a', name: 'A', x: 100, y: 100, labelOffset: { x: 0, y: -30 }, icon: 'none' },
        { id: 'b', name: 'B', x: 200, y: 100, labelOffset: { x: 0, y: -30 }, icon: 'none' },
      ],
      lines: [{ id: 'l', name: 'Line', color: '#123456', style: 'solid', stationIds: ['a', 'b'] }],
      lineGroups: [],
      lineLabelOffsets: { 'l:a': { x: 5, y: 6 } },
    }
    const stations = new Map(map.stations.map((station) => [station.id, station]))
    const labels = getLineEndpointLabels(map, stations)

    expect(labels).toHaveLength(2)
    expect(labels.every((label) => !label.group)).toBe(true)
    expect(labels.find((label) => label.key === 'l:a')?.center).toEqual({ x: 75, y: 106 })
  })

  it('sizes multiline endpoint labels to their widest line and total height', () => {
    const map: MetroMap = {
      ...initialMap,
      stations: initialMap.stations.slice(0, 2),
      lines: [{ ...initialMap.lines[0], name: 'A\nLonger name', stationIds: ['s1', 's2'] }],
    }
    const stations = new Map(map.stations.map((station) => [station.id, station]))
    const label = getLineEndpointLabels(map, stations).find((item) => item.key === 'l1:s1')

    expect(label).toMatchObject({ width: 'Longer name'.length * 6.5 + 12, height: 34 })
  })

  it('handles loop endpoints and deleted line components', () => {
    const map = {
      ...initialMap,
      lines: [{ ...initialMap.lines[0], loop: true }, {
        ...initialMap.lines[1],
        deletedConnections: ['s1|s4'],
      }],
    }
    const stations = new Map(map.stations.map((station) => [station.id, station]))

    expect(getLineEndpointLabels(map, stations).some((label) => label.key === 'l1:s1')).toBe(true)
    expect(getLineEndpointLabels(map, stations).some((label) => label.key === 'l2:s4')).toBe(true)
  })

  it('returns early when no canvas is available', () => {
    expect(() => drawMap(null, initialMap, new Set(), [], [], null, null, false, 0, { x: 0, y: 0, scale: 1 }, null)).not.toThrow()
  })

  it('draws grid, routes, selections, labels, and line styles', () => {
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), translate: vi.fn(),
      scale: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(), roundRect: vi.fn(), rotate: vi.fn(),
      setLineDash: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 30 })),
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    const map = {
      ...initialMap,
      stations: [...initialMap.stations, { id: 'w-1', name: '', x: 380, y: 260, labelOffset: { x: 0, y: -30 }, icon: 'none' as const, ghost: true }],
      lines: [
        ...initialMap.lines,
        { id: 'l3', name: 'Dotted', color: '#f00', style: 'dotted' as const, stationIds: ['s2', 's4'] },
        { id: 'l4', name: 'Rail', color: '#00f', style: 'hollow' as const, stationIds: ['s1', 'w-1', 's3'] },
      ],
      manualInterchanges: [['s1', 's3']],
    }

    drawMap(
      document.createElement('canvas'),
      map,
      new Set(['s1']),
      ['s1', 's2', 's3'],
      ['s2'],
      'l4',
      { lineId: 'l4', startId: 's1', endId: 'w-1' },
      true,
      2,
      { x: 10, y: 20, scale: 1.2 },
      { start: { x: 500, y: 500 }, end: { x: 300, y: 300 } },
    )

    expect(ctx.clearRect).toHaveBeenCalled()
    expect(ctx.setLineDash).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('renders newline-separated station labels as separate lines', () => {
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), translate: vi.fn(),
      scale: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(), roundRect: vi.fn(), rotate: vi.fn(),
      setLineDash: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 30 })),
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    const map = {
      ...initialMap,
      stations: [{ ...initialMap.stations[0], name: 'Central\nStation' }],
      lines: [],
    }

    drawMap(document.createElement('canvas'), map, new Set(), [], [], null, null, false, 0, { x: 0, y: 0, scale: 1 }, null)

    expect(ctx.fillText).toHaveBeenCalledWith('Central', expect.any(Number), expect.any(Number))
    expect(ctx.fillText).toHaveBeenCalledWith('Station', expect.any(Number), expect.any(Number))
  })
})
