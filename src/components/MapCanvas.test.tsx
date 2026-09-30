import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE } from '../domain/constants'
import { MapCanvas } from './MapCanvas'

describe('MapCanvas', () => {
  it('renders the workspace and forwards canvas interactions', () => {
    const handlers = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onWheel: vi.fn(),
    }
    render(<MapCanvas canvasRef={createRef<HTMLCanvasElement>()} status="Select a tool" {...handlers} />)
    const canvas = document.querySelector('canvas')!

    expect(canvas).toHaveAttribute('width', String(WORKSPACE.width))
    expect(canvas).toHaveAttribute('height', String(WORKSPACE.height))
    expect(screen.getByText('Select a tool')).toBeInTheDocument()

    fireEvent.pointerDown(canvas)
    fireEvent.pointerMove(canvas)
    fireEvent.pointerUp(canvas)
    fireEvent.pointerLeave(canvas)
    fireEvent.wheel(canvas)

    expect(handlers.onPointerDown).toHaveBeenCalledOnce()
    expect(handlers.onPointerMove).toHaveBeenCalledOnce()
    expect(handlers.onPointerUp).toHaveBeenCalledTimes(2)
    expect(handlers.onWheel).toHaveBeenCalledOnce()
  })
})
