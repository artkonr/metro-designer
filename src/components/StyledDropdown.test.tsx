import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StyledDropdown } from './StyledDropdown'

describe('StyledDropdown', () => {
  it('opens, selects an option, and reports the value', () => {
    const onChange = vi.fn()
    render(
      <StyledDropdown
        value="solid"
        options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Solid/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Dashed' }))

    expect(onChange).toHaveBeenCalledWith('dashed')
  })

  it('supports keyboard navigation and escape', () => {
    const onChange = vi.fn()
    render(
      <StyledDropdown
        value="solid"
        options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }]}
        onChange={onChange}
      />,
    )
    const trigger = screen.getByRole('button', { name: /Solid/ })

    fireEvent.keyDown(trigger, { code: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { code: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('dashed')
    fireEvent.keyDown(trigger, { code: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes when clicking outside and supports empty options', () => {
    const onChange = vi.fn()
    render(
      <StyledDropdown value="" placeholder="Choose" options={[]} onChange={onChange} />,
    )
    const trigger = screen.getByRole('button', { name: /Choose/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.keyDown(trigger, { code: 'ArrowDown' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
