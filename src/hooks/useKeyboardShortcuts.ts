import { useEffect, type RefObject } from 'react'

import type { Tool } from '../domain/types'

type KeyboardShortcutOptions = {
  selectedStationId: string | null
  selectedLineId: string | null
  tool: Tool
  showHelp: boolean
  statsOpen: boolean
  stationNameInputRef: RefObject<HTMLTextAreaElement | null>
  lineNameInputRef: RefObject<HTMLTextAreaElement | null>
  stationLineSelectRef: RefObject<HTMLInputElement | null>
  lineGroupSelectRef: RefObject<HTMLButtonElement | null>
  onHideHelp: () => void
  onHideStats: () => void
  onSelectToolShortcut: (tool: Tool) => void
  onExitTextEditing: () => void
  onExitFrameSelection: () => void
  onUndo: () => void
  onDeleteSelected: () => void
  onZoomShortcut: (factor: number) => void
  onAddLine: () => void
  onAddLineGroup: () => void
  onRotateSelectedStationLabels: () => void
  onMoveSelectedStation: (direction: 'forward' | 'backward') => void
  onPanViewport: (code: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD') => void
}

export function useKeyboardShortcuts({
  selectedStationId,
  selectedLineId,
  tool,
  showHelp,
  statsOpen,
  stationNameInputRef,
  lineNameInputRef,
  stationLineSelectRef,
  lineGroupSelectRef,
  onHideHelp,
  onHideStats,
  onSelectToolShortcut,
  onExitTextEditing,
  onExitFrameSelection,
  onUndo,
  onDeleteSelected,
  onZoomShortcut,
  onAddLine,
  onAddLineGroup,
  onRotateSelectedStationLabels,
  onMoveSelectedStation,
  onPanViewport,
}: KeyboardShortcutOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        if (showHelp) {
          event.preventDefault()
          onHideHelp()
          return
        }
        if (statsOpen) {
          event.preventDefault()
          onHideStats()
          return
        }
        if (event.target instanceof HTMLElement && isTextEditingTarget(event.target)) {
          event.preventDefault()
          event.target.blur()
          onExitTextEditing()
          return
        }
        if (tool === 'frame') {
          event.preventDefault()
          onExitFrameSelection()
          return
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.altKey) {
        event.preventDefault()
        onUndo()
        return
      }
      if (isTextEditingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code === 'Delete') {
        event.preventDefault()
        onDeleteSelected()
        return
      }
      if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3' || event.code === 'Digit4') {
        event.preventDefault()
        onSelectToolShortcut(
          event.code === 'Digit1'
            ? 'select'
            : event.code === 'Digit2'
              ? 'station'
              : event.code === 'Digit3'
                ? 'waypoint'
                : 'frame',
        )
        return
      }
      if (event.code === 'KeyQ' || event.code === 'KeyE') {
        event.preventDefault()
        onZoomShortcut(event.code === 'KeyQ' ? 0.8 : 1.25)
        return
      }
      if (event.code === 'KeyN') {
        event.preventDefault()
        const nameField = selectedStationId ? stationNameInputRef.current : selectedLineId ? lineNameInputRef.current : null
        nameField?.focus()
        nameField?.select()
        return
      }
      if (event.code === 'KeyL') {
        event.preventDefault()
        onAddLine()
        return
      }
      if (event.code === 'KeyG') {
        event.preventDefault()
        onAddLineGroup()
        return
      }
      if (event.code === 'KeyC' && selectedLineId) {
        event.preventDefault()
        lineGroupSelectRef.current?.focus()
        return
      }
      if (event.code === 'KeyC' && selectedStationId) {
        event.preventDefault()
        stationLineSelectRef.current?.focus()
        return
      }
      if (event.code === 'KeyH' && selectedStationId) {
        event.preventDefault()
        onRotateSelectedStationLabels()
        return
      }
      if (event.code === 'KeyF' && selectedStationId) {
        event.preventDefault()
        onMoveSelectedStation('forward')
        return
      }
      if (event.code === 'KeyR' && selectedStationId) {
        event.preventDefault()
        onMoveSelectedStation('backward')
        return
      }
      if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD') {
        event.preventDefault()
        onPanViewport(event.code)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    lineGroupSelectRef,
    lineNameInputRef,
    onAddLine,
    onAddLineGroup,
    onDeleteSelected,
    onExitFrameSelection,
    onExitTextEditing,
    onHideHelp,
    onHideStats,
    onMoveSelectedStation,
    onPanViewport,
    onRotateSelectedStationLabels,
    onSelectToolShortcut,
    onUndo,
    onZoomShortcut,
    selectedLineId,
    selectedStationId,
    showHelp,
    stationLineSelectRef,
    stationNameInputRef,
    statsOpen,
    tool,
  ])
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}
