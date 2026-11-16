import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('./canvas/drawing', () => ({
  canonicalColor: (value: string) => value.trim().toLowerCase(),
  drawMap: vi.fn(),
  getLineEndpointLabels: () => [],
  getTerminusLabelOffset: () => undefined,
  lineOutlineStyle: (style: string) => style === 'hollow' ? 'double' : style,
  readableText: () => '#fff',
  terminusLabelOffsetId: (stationId: string, lineId: string) => `${lineId}:${stationId}`,
}))

vi.mock('./io/mapFiles', () => ({
  downloadMapJson: vi.fn(),
  downloadMapYaml: vi.fn(),
  exportMapPng: vi.fn(),
  parseMapFile: vi.fn(),
}))

describe('App', () => {
  it('creates stations and waypoints through the drawing tools', () => {
    render(<App />)
    const canvas = document.querySelector('canvas')!
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 680, width: 1000, height: 680, toJSON: () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: 'New station' }))
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(screen.getByText('Station added')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New waypoint' }))
    fireEvent.pointerDown(canvas, { clientX: 140, clientY: 100, pointerId: 2 })
    expect(screen.getByText('Waypoint added')).toBeInTheDocument()
  })

  it('adds groups and lines, and supports keyboard tool actions', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add' })[0])
    expect(screen.getByText('Line group created')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add' })[1])
    expect(screen.getByText('Line created and selected')).toBeInTheDocument()

    fireEvent.keyDown(window, { code: 'Digit1' })
    fireEvent.keyDown(window, { code: 'Digit2' })
    expect(screen.getByText('Station tool selected')).toBeInTheDocument()
  })

  it('handles the application menu, new-map confirmation, and stats dialog', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(screen.getByRole('dialog', { name: 'Create a new map?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create new' }))
    expect(screen.getByText('New map created')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze map stats' }))
    expect(screen.getByRole('dialog', { name: 'Map stats' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Changes'), { target: { value: '3' } })
    expect(screen.getByText('No station pairs match this change count.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close map stats' }))
    expect(screen.queryByRole('dialog', { name: 'Map stats' })).not.toBeInTheDocument()
  })

  it('edits the title, undoes the edit, and deletes a selected line', () => {
    render(<App />)
    const title = screen.getByRole('textbox', { name: 'Map title' })

    fireEvent.change(title, { target: { value: 'City map' } })
    fireEvent.blur(title)
    expect(title).toHaveValue('City map')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(title).toHaveValue('New metro map')

    fireEvent.click(screen.getByRole('button', { name: 'Blue Line' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Delete line?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete line?' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete line' }))
    expect(screen.getByText('Line deleted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Blue Line' })).not.toBeInTheDocument()
  })

  it('opens export actions and the help popup', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export as' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'YAML' }))
    expect(screen.getByText('Map saved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export as' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    expect(screen.getByText('Map saved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export as' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'PNG' }))
    expect(screen.getByText('PNG exported')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    fireEvent.keyDown(window, { code: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
  })

  it('switches groups, toggles grid snapping, and deletes a created group', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Grid/ }))
    expect(screen.getByRole('checkbox', { name: /Grid/ })).not.toBeChecked()

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add' })[0])
    expect(screen.getByText('Group 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Line group deleted')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Metro/ }))
    expect(screen.getByText('Metro')).toBeInTheDocument()
  })
})
