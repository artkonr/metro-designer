import { forwardRef, useEffect, useRef, useState } from 'react'

import { effectiveLineName, effectiveLineStyle } from '../domain/map'
import type { LineGroup, MetroLine } from '../domain/types'

export const LineSearchDropdown = forwardRef<HTMLInputElement, {
  lines: MetroLine[]
  lineGroups: LineGroup[]
  onSelect: (lineId: string) => void
}>(function LineSearchDropdown({ lines, lineGroups, onSelect }, ref) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const options = [...lines]
    .sort((left, right) => effectiveLineName(left, lineGroups, lines).localeCompare(effectiveLineName(right, lineGroups, lines)))
    .filter((line) => effectiveLineName(line, lineGroups, lines).toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const choose = (line: MetroLine) => {
    onSelect(line.id)
    setQuery('')
    setOpen(false)
    setActiveIndex(0)
  }

  return (
    <div ref={rootRef} className="styled-dropdown line-search-dropdown">
      <input
        ref={ref}
        value={query}
        placeholder="Select line..."
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.code === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((index) => options.length ? (index + 1) % options.length : 0)
          } else if (event.code === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((index) => options.length ? (index - 1 + options.length) % options.length : 0)
          } else if (event.code === 'Enter' && open && options[activeIndex]) {
            event.preventDefault()
            choose(options[activeIndex])
          } else if (event.code === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }}
      />
      {open && (
        <div className="styled-dropdown-menu" role="listbox">
          {options.map((line, index) => {
            const style = effectiveLineStyle(line, lineGroups)
            return (
            <button
              key={line.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'styled-dropdown-option active line-selector-option' : 'styled-dropdown-option line-selector-option'}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(line)}
            >
              <i
                className={`line-selector-swatch line-selector-swatch-${style}`}
                style={{
                  background: style === 'solid' || style === 'dotted' ? line.color : 'transparent',
                  borderColor: style === 'hollow' || style === 'dashed' ? line.color : 'transparent',
                }}
              />
              <span>{effectiveLineName(line, lineGroups, lines) || 'Unnamed line'}</span>
              <em>({lineGroups.find((group) => group.id === line.lineGroupId)?.name || 'Unassigned'})</em>
            </button>
            )
          })}
          {!options.length && <div className="styled-dropdown-empty">No matching lines</div>}
        </div>
      )}
    </div>
  )
})
