import { describe, expect, it } from 'vitest'
import { distanceToSegment, snapPoint, zoomViewport } from './geometry'

describe('canvas geometry helpers', () => {
  it('snaps points to the map grid', () => {
    expect(snapPoint({ x: 59, y: 81 })).toEqual({ x: 40, y: 80 })
  })

  it('keeps the zoom anchor fixed in world coordinates', () => {
    const next = zoomViewport({ x: 0, y: 0, scale: 1 }, 2, { x: 100, y: 100 })
    expect(next).toEqual({ x: -100, y: -100, scale: 2 })
  })

  it('measures distance to a segment', () => {
    expect(distanceToSegment({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4)
  })
})
