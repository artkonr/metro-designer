import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KeyboardShortcuts } from './KeyboardShortcuts'

describe('KeyboardShortcuts', () => {
  it('renders grouped shortcuts and closes through the callback', () => {
    const onClose = vi.fn()
    render(<KeyboardShortcuts open onClose={onClose} />)

    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument()
    expect(screen.getByText('New line group')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
