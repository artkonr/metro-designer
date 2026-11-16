import { describe, expect, it, vi } from 'vitest'
import { initialMap } from '../domain/map'

const { drawMap, getLineEndpointLabels } = vi.hoisted(() => ({
  drawMap: vi.fn(),
  getLineEndpointLabels: vi.fn(() => []),
}))

vi.mock('../canvas/drawing', () => ({ drawMap, getLineEndpointLabels }))

import { downloadMapJson, downloadMapYaml, exportMapPng, parseMapFile } from './mapFiles'

describe('map file I/O', () => {
  it('parses and normalizes a YAML map file', async () => {
    const file = new File([`
version: 1
title: Imported map
stations:
  - id: w-1
    name: Legacy waypoint
    kind: waypoint
    x: 0
    y: 0
    labelOffset: { x: 0, y: -30 }
    icons: []
lines: []
`], 'map.yaml', { type: 'text/yaml' })

    const map = await parseMapFile(file)

    expect(map.title).toBe('Imported map')
    expect(map.stations[0]).toMatchObject({ kind: 'waypoint', name: '' })
  })

  it('parses a JSON map file', async () => {
    const file = new File([JSON.stringify({
      ...initialMap,
      stations: [{ ...initialMap.stations[0], kind: 'waypoint', name: 'Temporary' }],
    })], 'map.json', { type: 'application/json' })

    const map = await parseMapFile(file)

    expect(map.stations[0]).toMatchObject({ kind: 'waypoint', name: '' })
  })

  it('rejects unsupported map files', async () => {
    const file = new File(['title: invalid'], 'map.yaml', { type: 'text/yaml' })
    await expect(parseMapFile(file)).rejects.toThrow('Unsupported map file')
  })

  it('rejects maps with the wrong version or collection shapes', async () => {
    const file = new File(['version: 2\nstations: {}\nlines: []'], 'map.yaml', { type: 'text/yaml' })
    await expect(parseMapFile(file)).rejects.toThrow('Unsupported map file')
  })

  it('rejects malformed YAML', async () => {
    const file = new File([': invalid: yaml'], 'map.yaml', { type: 'text/yaml' })
    await expect(parseMapFile(file)).rejects.toThrow()
  })

  it('rejects unnamed lines in simple naming groups', async () => {
    const map = {
      ...initialMap,
      lineGroups: [{ ...initialMap.lineGroups![0], namingPattern: 'simple' as const }],
      lines: [{ ...initialMap.lines[0], name: undefined }],
    }
    const file = new File([JSON.stringify(map)], 'map.json', { type: 'application/json' })

    await expect(parseMapFile(file)).rejects.toThrow('uses simple naming')
  })

  it('normalizes legacy line overrides while importing', async () => {
    const map = {
      ...initialMap,
      lineGroups: [{ ...initialMap.lineGroups![0], namingPattern: 'numbered' as const, namingPrefix: 'M' }],
      lines: [{
        ...initialMap.lines[0],
        name: 'M1',
        style: 'dashed' as const,
        nameOverridden: false,
        styleOverridden: false,
      }],
    }
    const file = new File([JSON.stringify(map)], 'map.json', { type: 'application/json' })

    const imported = await parseMapFile(file)

    expect(imported.lines[0]).not.toHaveProperty('name')
    expect(imported.lines[0]).not.toHaveProperty('style')
    expect(imported.lines[0]).not.toHaveProperty('nameOverridden')
    expect(imported.lines[0]).not.toHaveProperty('styleOverridden')
  })

  it('downloads YAML using a slugified map title', () => {
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMapYaml({ ...initialMap, title: 'Central / North!' })

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('central-north.yaml')
    click.mockRestore()
  })

  it('downloads JSON using a slugified map title', () => {
    const createObjectURL = vi.fn(() => 'blob:test-json')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMapJson({ ...initialMap, title: 'Central / North!' })

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-json')
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('central-north.json')
    click.mockRestore()
  })

  it('exports optional generated line names without legacy override fields', async () => {
    let exportedBlob: Blob | undefined
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => {
      exportedBlob = blob
      return 'blob:test-json'
    }) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMapJson({
      ...initialMap,
      lineGroups: [{ ...initialMap.lineGroups![0], namingPattern: 'numbered' as const, namingPrefix: 'M' }],
      lines: [{ ...initialMap.lines[0], name: undefined }],
    })

    const exported = JSON.parse(await exportedBlob!.text())
    expect(exported.lines[0]).not.toHaveProperty('name')
    expect(exported.lines[0]).not.toHaveProperty('nameOverridden')
    expect(exported.lines[0]).not.toHaveProperty('styleOverridden')
    vi.restoreAllMocks()
  })

  it('exports a bounded PNG and falls back to workspace dimensions for empty maps', () => {
    const context = { measureText: vi.fn(() => ({ width: 40 })) }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
    const createObjectURL = vi.fn(() => 'blob:png')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    exportMapPng({
      map: { ...initialMap, stations: [], lines: [] },
      interchangeIds: new Set(),
      route: [],
      selectedStationIds: [],
      selectedLineId: null,
      selectedConnection: null,
      snapToGrid: false,
      shimmerPhase: 0,
    })

    expect(drawMap).toHaveBeenCalledOnce()
    expect(drawMap.mock.calls[0]?.[11]).toEqual({ width: 1000, height: 680 })
    expect(createObjectURL).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })
})
