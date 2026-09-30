import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMapHistory } from './useMapHistory'
import { emptyMap } from '../domain/map'

describe('useMapHistory', () => {
  it('records updates and restores the previous map', () => {
    const { result } = renderHook(() => useMapHistory(emptyMap))
    const initialTitle = result.current.map.title

    act(() => result.current.updateMap((map) => ({ ...map, title: 'Edited' })))
    expect(result.current.map.title).toBe('Edited')
    expect(result.current.undoCount).toBe(1)

    act(() => result.current.undo())
    expect(result.current.map.title).toBe(initialTitle)
    expect(result.current.undoCount).toBe(0)
  })

  it('does not record unchanged or non-history updates', () => {
    const { result } = renderHook(() => useMapHistory(emptyMap))
    const current = result.current.map

    act(() => result.current.updateMap((map) => map))
    act(() => result.current.updateMap((map) => ({ ...map, title: 'Transient' }), false))

    expect(result.current.map.title).toBe('Transient')
    expect(result.current.undoCount).toBe(0)
    expect(current).not.toBe(result.current.map)
  })

  it('coalesces a drag into one undo snapshot', () => {
    const { result } = renderHook(() => useMapHistory(emptyMap))

    act(() => result.current.beginDragHistory())
    act(() => result.current.updateMap((map) => ({ ...map, title: 'Dragged once' }), false))
    act(() => result.current.updateMap((map) => ({ ...map, title: 'Dragged twice' }), false))
    act(() => result.current.finishDragHistory())

    expect(result.current.undoCount).toBe(1)
    act(() => result.current.undo())
    expect(result.current.map.title).toBe('New metro map')
  })
})
