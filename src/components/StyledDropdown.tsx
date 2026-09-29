import { forwardRef, useEffect, useRef, useState } from 'react'

export type DropdownOption = {
  value: string
  label: string
}

export const StyledDropdown = forwardRef<HTMLButtonElement, {
  value: string
  placeholder?: string
  options: DropdownOption[]
  onChange: (value: string) => void
}>(function StyledDropdown({ value, placeholder, options, onChange }, ref) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, options.findIndex((option) => option.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const choose = (option: DropdownOption) => {
    onChange(option.value)
    setActiveIndex(options.indexOf(option))
    setOpen(false)
  }

  const move = (delta: number) => {
    if (!options.length) return
    setOpen(true)
    setActiveIndex((index) => (index + delta + options.length) % options.length)
  }

  return (
    <div ref={rootRef} className="styled-dropdown">
      <button
        ref={ref}
        type="button"
        className="styled-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.code === 'ArrowDown') {
            event.preventDefault()
            move(1)
          } else if (event.code === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          } else if (event.code === 'Enter' && open && options[activeIndex]) {
            event.preventDefault()
            choose(options[activeIndex])
          } else if (event.code === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }}
      >
        {selected?.label ?? placeholder ?? 'Select...'}
        <span className="styled-dropdown-chevron">▾</span>
      </button>
      {open && (
        <div className="styled-dropdown-menu" role="listbox">
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={index === activeIndex ? 'styled-dropdown-option active' : 'styled-dropdown-option'}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
