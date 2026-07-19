import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { usePorts, type PortMaster } from '../../hooks/use-ports'

interface PortPickerProps {
  /** Current raw value (a UN/LOCODE like "CNYTN", or free text for a port not in the master). */
  value: string
  onChange: (value: string) => void
  id?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

const MAX_OPTIONS = 8

/**
 * Searchable POL/POD picker over the seeded ports master, with a free-text fallback.
 *
 * Ports are a complete, seeded master (not the ~2-month-lagged Mesh mirror), so operators should pick
 * from the list rather than retype UN/LOCODEs. But the input stays free text: a port genuinely not in
 * the catalog can still be typed (stored raw), so nothing is ever un-enterable. Picking a match stores
 * its UN/LOCODE; the resolved name is shown as a hint so the code isn't opaque.
 */
export function PortPicker({ value, onChange, id, ariaLabel, placeholder, className, autoFocus }: PortPickerProps) {
  const { data: ports } = usePorts()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const text = value ?? ''

  const matches = useMemo(() => {
    if (!ports || ports.length === 0) return []
    const q = text.trim().toLowerCase()
    const list = q
      ? ports.filter(
          (p) =>
            p.unlocode.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.iata ?? '').toLowerCase().includes(q),
        )
      : ports
    return list.slice(0, MAX_OPTIONS)
  }, [ports, text])

  // Friendly name for the current value when it is an exact known UN/LOCODE — so the stored code isn't opaque.
  const resolved = useMemo(
    () => (text ? ports?.find((p) => p.unlocode.toLowerCase() === text.trim().toLowerCase()) : undefined),
    [ports, text],
  )

  useEffect(() => setActive(0), [text])

  // Close on outside click (blur alone races with the option's mousedown).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (p: PortMaster) => {
    onChange(p.unlocode)
    setOpen(false)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault()
      pick(matches[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        type="text"
        value={text}
        aria-label={ariaLabel}
        placeholder={placeholder ?? 'Search ports…'}
        autoFocus={autoFocus}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {resolved && !open && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-text-muted">
          {resolved.name}
        </span>
      )}
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-surface-800 py-1 shadow-lg"
        >
          {matches.map((p, i) => (
            <li
              key={p.unlocode}
              role="option"
              aria-selected={i === active}
              // mousedown (not click) so the pick fires before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(p)
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm ${
                i === active ? 'bg-surface-700 text-text-primary' : 'text-text-secondary'
              }`}
            >
              <span className="font-mono text-xs text-cobalt-primary-light">{p.unlocode}</span>
              <span className="truncate">{p.name}</span>
              {p.country ? <span className="ml-auto shrink-0 text-xs text-text-muted">{p.country}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
