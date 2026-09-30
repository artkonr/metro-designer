import { describe, expect, it } from 'vitest'
import { distanceToSegment, labelOffsetForAngle, moveStation, nearestLabelAngle, pointKey, snapPoint, stationLabelOffset, zoomViewport } from './geometry'
import { initialMap } from '../domain/map'

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
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 5, y: 5 }, { x: 5, y: 5 })).toBe(2)
  })

  it('converts label angles and offsets', () => {
    expect(labelOffsetForAngle(0).y).toBeLessThan(0)
    expect(nearestLabelAngle({ x: 1, y: -1 })).toBe(45)
    expect(stationLabelOffset({ ...initialMap.stations[0], labelAngle: undefined })).toEqual(initialMap.stations[0].labelOffset)
    expect(stationLabelOffset({ ...initialMap.stations[0], labelAngle: 90 }).x).toBeGreaterThan(0)
    expect(pointKey({ x: 1.04, y: 2.06 })).toBe('1,2.1')
  })

  it('moves stations with optional grid snapping', () => {
    const station = initialMap.stations[0]
    expect(moveStation(initialMap, station, { x: 101, y: 99 }, { x: 1, y: 2 }, true)).toMatchObject({ x: 120, y: 80 })
    expect(moveStation(initialMap, station, { x: 101, y: 99 }, { x: 1, y: 2 }, false)).toMatchObject({ x: 100, y: 97 })
  })
})
