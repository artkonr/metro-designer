import { useCallback, useRef, useState } from 'react'

import { cloneMap } from '../domain/map'
import type { MetroMap } from '../domain/types'

export function useMapHistory(createInitialMap: () => MetroMap, historyLimit = 5) {
  const [map, setMap] = useState<MetroMap>(() => createInitialMap())
  const [undoCount, setUndoCount] = useState(0)
  const mapRef = useRef(map)
  const undoStackRef = useRef<MetroMap[]>([])
  const dragHistoryRef = useRef<MetroMap | null>(null)

  const pushUndoSnapshot = useCallback((snapshot: MetroMap) => {
    undoStackRef.current = [...undoStackRef.current, cloneMap(snapshot)].slice(-historyLimit)
    setUndoCount(undoStackRef.current.length)
  }, [historyLimit])

  const updateMap = useCallback((updater: (current: MetroMap) => MetroMap, recordHistory = true) => {
    const current = mapRef.current
    const next = updater(current)
    if (next === current) return
    if (recordHistory) pushUndoSnapshot(current)
    mapRef.current = next
    setMap(next)
  }, [pushUndoSnapshot])

  const beginDragHistory = useCallback(() => {
    dragHistoryRef.current = cloneMap(mapRef.current)
  }, [])

  const finishDragHistory = useCallback(() => {
    const initialMap = dragHistoryRef.current
    dragHistoryRef.current = null
    if (initialMap && JSON.stringify(initialMap) !== JSON.stringify(mapRef.current)) pushUndoSnapshot(initialMap)
  }, [pushUndoSnapshot])

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    setUndoCount(undoStackRef.current.length)
    mapRef.current = previous
    setMap(previous)
  }, [])

  return {
    map,
    mapRef,
    undoCount,
    updateMap,
    beginDragHistory,
    finishDragHistory,
    undo,
  }
}
