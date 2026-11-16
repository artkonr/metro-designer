import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LineSearchDropdown } from './LineSearchDropdown'

const lines = [
  { id: 'l2', name: 'Teal Line', color: '#0aa', style: 'dashed' as const, stationIds: [], lineGroupId: 'g2' },
  { id: 'l1', name: 'Blue Line', color: '#00f', style: 'solid' as const, stationIds: [], lineGroupId: 'g1' },
]

describe('LineSearchDropdown', () => {
  it('filters lines and selects the matching option', () => {
    const onSelect = vi.fn()
    render(<LineSearchDropdown lines={lines} lineGroups={[{ id: 'g1', name: 'Metro', style: 'solid', namingPattern: 'simple' }]} onSelect={onSelect} />)
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'teal' } })
    expect(screen.getByRole('option', { name: /Teal Line/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Blue Line/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Teal Line/ }))

    expect(onSelect).toHaveBeenCalledWith('l2')
    expect(input).toHaveValue('')
  })

  it('selects the active line with Enter and closes on Escape', () => {
    const onSelect = vi.fn()
    render(<LineSearchDropdown lines={lines} lineGroups={[]} onSelect={onSelect} />)
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.keyDown(input, { code: 'ArrowDown' })
    fireEvent.keyDown(input, { code: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('l2')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { code: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows inherited styles and closes when clicking outside', () => {
    const onSelect = vi.fn()
    render(<LineSearchDropdown lines={[{ ...lines[0], style: undefined }]} lineGroups={[{ id: 'g2', name: 'Regional', style: 'hollow', namingPattern: 'simple' }]} onSelect={onSelect} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getByRole('option').querySelector('.line-selector-swatch-hollow')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
