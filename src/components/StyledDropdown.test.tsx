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
})
