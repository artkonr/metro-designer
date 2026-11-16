import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Tool } from '../domain/types'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function createOptions(overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {}) {
  const stationNameInput = document.createElement('textarea')
  const lineNameInput = document.createElement('textarea')
  const stationLineSelect = document.createElement('input')
  const lineGroupSelect = document.createElement('button')
  document.body.append(stationNameInput, lineNameInput, stationLineSelect, lineGroupSelect)

  const options: Parameters<typeof useKeyboardShortcuts>[0] = {
    selectedStationId: null,
    selectedLineId: null,
    tool: 'select',
    showHelp: false,
    statsOpen: false,
    stationNameInputRef: { current: stationNameInput },
    lineNameInputRef: { current: lineNameInput },
    stationLineSelectRef: { current: stationLineSelect },
    lineGroupSelectRef: { current: lineGroupSelect },
    onHideHelp: vi.fn(),
    onHideStats: vi.fn(),
    onSelectToolShortcut: vi.fn(),
    onExitTextEditing: vi.fn(),
    onExitFrameSelection: vi.fn(),
    onUndo: vi.fn(),
    onDeleteSelected: vi.fn(),
    onZoomShortcut: vi.fn(),
    onAddLine: vi.fn(),
    onAddLineGroup: vi.fn(),
    onRotateSelectedStationLabels: vi.fn(),
    onMoveSelectedStation: vi.fn(),
    onPanViewport: vi.fn(),
  }

  return { ...options, ...overrides }
}

function press(code: string, options: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { code, ...options })
}

describe('useKeyboardShortcuts', () => {
  it('handles modal, editing, undo, and tool shortcuts', () => {
    const options = createOptions({ showHelp: true })
    renderHook(() => useKeyboardShortcuts(options))

    press('Escape')
    expect(options.onHideHelp).toHaveBeenCalledOnce()

    const statsOptions = createOptions({ statsOpen: true })
    const { unmount } = renderHook(() => useKeyboardShortcuts(statsOptions))
    press('Escape')
    expect(statsOptions.onHideStats).toHaveBeenCalledOnce()
    unmount()

    const textOptions = createOptions()
    renderHook(() => useKeyboardShortcuts(textOptions))
    const textTarget = textOptions.stationNameInputRef.current!
    textTarget.focus()
    fireEvent.keyDown(textTarget, { code: 'Escape' })
    expect(textOptions.onExitTextEditing).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(textTarget)

    const frameOptions = createOptions({ tool: 'frame' })
    renderHook(() => useKeyboardShortcuts(frameOptions))
    press('Escape')
    expect(frameOptions.onExitFrameSelection).toHaveBeenCalledOnce()

    const undoOptions = createOptions()
    renderHook(() => useKeyboardShortcuts(undoOptions))
    press('KeyZ', { ctrlKey: true })
    press('KeyZ', { metaKey: true, altKey: true })
    expect(undoOptions.onUndo).toHaveBeenCalledOnce()

    const toolOptions = createOptions()
    renderHook(() => useKeyboardShortcuts(toolOptions))
    for (const [code, tool] of [['Digit1', 'select'], ['Digit2', 'station'], ['Digit3', 'waypoint'], ['Digit4', 'frame']] as [string, Tool][]) {
      press(code)
      expect(toolOptions.onSelectToolShortcut).toHaveBeenCalledWith(tool)
    }
    press('Delete')
    expect(toolOptions.onDeleteSelected).toHaveBeenCalledOnce()
    press('KeyQ')
    press('KeyE')
    expect(toolOptions.onZoomShortcut).toHaveBeenNthCalledWith(1, 0.8)
    expect(toolOptions.onZoomShortcut).toHaveBeenNthCalledWith(2, 1.25)
  })

  it('handles focus, editing actions, movement, and modifier guards', () => {
    const options = createOptions({ selectedStationId: 'station-1' })
    renderHook(() => useKeyboardShortcuts(options))

    press('KeyN')
    expect(document.activeElement).toBe(options.stationNameInputRef.current)
    press('KeyL')
    press('KeyG')
    press('KeyH')
    press('KeyF')
    press('KeyR')
    expect(options.onAddLine).toHaveBeenCalledOnce()
    expect(options.onAddLineGroup).toHaveBeenCalledOnce()
    expect(options.onRotateSelectedStationLabels).toHaveBeenCalledOnce()
    expect(options.onMoveSelectedStation).toHaveBeenNthCalledWith(1, 'forward')
    expect(options.onMoveSelectedStation).toHaveBeenNthCalledWith(2, 'backward')

    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const) press(code)
    expect(options.onPanViewport).toHaveBeenCalledTimes(4)
    expect(options.onPanViewport).toHaveBeenNthCalledWith(1, 'KeyW')

    press('KeyC')
    expect(document.activeElement).toBe(options.stationLineSelectRef.current)

    const lineOptions = createOptions({ selectedLineId: 'line-1' })
    renderHook(() => useKeyboardShortcuts(lineOptions))
    press('KeyN')
    expect(document.activeElement).toBe(lineOptions.lineNameInputRef.current)
    press('KeyC')
    expect(document.activeElement).toBe(lineOptions.lineGroupSelectRef.current)

    const guardedOptions = createOptions()
    renderHook(() => useKeyboardShortcuts(guardedOptions))
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { code: 'KeyL' })
    press('KeyL', { altKey: true })
    expect(guardedOptions.onAddLine).not.toHaveBeenCalled()
  })

  it('ignores name focus without a selection and non-element event targets', () => {
    const options = createOptions()
    renderHook(() => useKeyboardShortcuts(options))

    press('KeyN')
    fireEvent.keyDown(window, { code: 'KeyW' })
    expect(options.onPanViewport).toHaveBeenCalledWith('KeyW')
  })
})
