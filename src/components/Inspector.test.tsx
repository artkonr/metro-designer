import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { initialMap } from '../domain/map'
import type { LineGroup, MetroLine, MetroMap, Station } from '../domain/types'
import { Inspector } from './Inspector'

vi.mock('../canvas/drawing', () => ({
  iconGlyph: () => 'icon',
  readableText: () => '#fff',
}))

function renderInspector(overrides: Partial<Parameters<typeof Inspector>[0]> = {}) {
  let currentMap: MetroMap = structuredClone(initialMap)
  const updateMap = (updater: (map: MetroMap) => MetroMap) => {
    currentMap = updater(currentMap)
  }
  const props: Parameters<typeof Inspector>[0] = {
    station: undefined,
    stations: currentMap.stations,
    manualInterchanges: [],
    selectedStationIds: [],
    interchangeAnchorId: null,
    onStartManualInterchange: vi.fn(),
    line: undefined,
    group: undefined,
    lineGroups: currentMap.lineGroups ?? [],
    lines: currentMap.lines,
    placementLineId: null,
    selectedConnection: null,
    isInterchange: false,
    updateMap,
    onDelete: vi.fn(),
    onDeleteGroup: vi.fn(),
    onDeleteConnection: vi.fn(),
    onSelectLine: vi.fn(),
    onSelectPlacementLine: vi.fn(),
    onLineNameEnter: vi.fn(),
    stationNameInputRef: createRef<HTMLInputElement>(),
    lineNameInputRef: createRef<HTMLInputElement>(),
    groupNameInputRef: createRef<HTMLInputElement>(),
    stationLineSelectRef: createRef<HTMLInputElement>(),
    lineGroupSelectRef: createRef<HTMLButtonElement>(),
    lineStyleSelectRef: createRef<HTMLButtonElement>(),
    ...overrides,
  }
  render(<Inspector {...props} />)
  return { getMap: () => currentMap, updateMap, props }
}

describe('Inspector', () => {
  it('renders the empty state when nothing is selected', () => {
    renderInspector()
    expect(screen.getByText('Select a station or line to edit its properties.')).toBeInTheDocument()
  })

  it('edits station details and station actions', () => {
    const station = initialMap.stations[0]
    const onStartManualInterchange = vi.fn()
    const onSelectLine = vi.fn()
    const { getMap } = renderInspector({
      station,
      selectedStationIds: ['s1'],
      manualInterchanges: [['s1', 's3']],
      onStartManualInterchange,
      onSelectLine,
    })

    const name = screen.getByRole('textbox')
    fireEvent.change(name, { target: { value: 'Central Park' } })
    expect(getMap().stations.find((item) => item.id === 's1')?.name).toBe('Central Park')

    fireEvent.click(screen.getByRole('button', { name: 'Airport' }))
    expect(getMap().stations.find((item) => item.id === 's1')?.icon).toBe('plane')
    fireEvent.click(screen.getByRole('button', { name: 'Junction' }))
    expect(getMap().stations.find((item) => item.id === 's1')?.interchangeStyle).toBe('converging')
    fireEvent.click(screen.getByRole('button', { name: 'Interchange' }))
    expect(onStartManualInterchange).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Blue Line' }))
    expect(onSelectLine).toHaveBeenCalledWith('l1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Blue Line connection' }))
    expect(getMap().lines.find((line) => line.id === 'l1')?.stationIds).not.toContain('s1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove interchange connection' }))
    expect(getMap().manualInterchanges).toEqual([])
  })

  it('marks edited line names and styles as overridden', () => {
    const line = initialMap.lines[0]
    const { getMap } = renderInspector({ line })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Express' } })
    expect(getMap().lines.find((item) => item.id === line.id)).toMatchObject({ name: 'Express', nameOverridden: true })

    fireEvent.click(screen.getByRole('button', { name: /Solid/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Hollow' }))
    expect(getMap().lines.find((item) => item.id === line.id)).toMatchObject({ style: 'hollow', styleOverridden: true })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Loop line' }))
    expect(getMap().lines.find((item) => item.id === line.id)?.loop).toBe(true)
  })

  it('edits group naming and propagates the selected default style', () => {
    const group = initialMap.lineGroups![0]
    const lines: MetroLine[] = initialMap.lines.map((line) => ({ ...line, styleOverridden: false, nameOverridden: false }))
    const editableGroup: LineGroup = { ...group, namingPattern: 'simple', lineIds: lines.map((line) => line.id) }
    const { getMap, updateMap } = renderInspector({ group: editableGroup, lines, lineGroups: [editableGroup] })
    updateMap((map) => ({ ...map, lines: lines.map((line) => ({ ...line, styleOverridden: false, nameOverridden: false })) }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Regional' } })
    expect(getMap().lineGroups?.[0].name).toBe('Regional')
    fireEvent.click(screen.getByRole('button', { name: /Solid/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Dashed' }))
    expect(getMap().lines.every((line) => line.style === 'dashed')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Simple/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Numbered' }))
    expect(getMap().lines[0].name).toBe('1')
    expect(getMap().lineGroups?.[0].namingPattern).toBe('numbered')
  })
})
