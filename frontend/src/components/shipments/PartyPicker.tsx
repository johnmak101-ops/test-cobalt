import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useParties, type PartyMaster, type PartyKind } from '../../hooks/use-parties'

interface PartyPickerProps {
  kind: PartyKind
  /** Current raw value — a master CODE like "WYSE", or free text for a party not in the mirror. */
  value: string
  onChange: (value: string) => void
  id?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

const MAX_OPTIONS = 8

/** Fold case + strip punctuation, mirroring the backend's exactPartyId name tier. */
const norm = (s: string) => s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * What a pick writes back, per kind — the two field classes genuinely differ.
 *
 * Customer/Vendor: the read view rows are literally "Customer Code" / "Vendor Code"
 * (`shipment.customer?.code`), and their codes are meaningful short tokens (WYSE, ROKNFT). Store the
 * code so both surfaces show the same thing.
 *
 * Forwarder: its read row is `forwarder?.name ?? forwarderRaw`, i.e. always a NAME, and forwarder
 * codes are numeric ERP ids ("002", "003"). Storing a code there would put an opaque number in the
 * raw column and in the row an operator reads. Both resolve on the backend either way —
 * forwarderIdExact tries code then name — so the readable one wins.
 */
const STORES: Record<PartyKind, 'code' | 'name'> = {
  customer: 'code',
  vendor: 'code',
  forwarder: 'name',
}

/**
 * Searchable Customer/Vendor picker over the Mesh party mirror, with a free-text fallback.
 *
 * Picking stores the master CODE, not the name. That is what the write path wants: the backend's
 * exactPartyId resolves code first and normalised name second, so a code is the value most likely to
 * link the booking FK — and it is what the shipment read view ("Customer Code" / "Vendor Code")
 * displays, so picking here makes the two surfaces agree.
 *
 * The input stays free text on purpose. The Mesh mirror lags the ERP by ~2 months, so a real party
 * may genuinely be missing; typing it is preserved and stored raw. It simply will not resolve the FK,
 * which the review queue then surfaces as a "not in Mesh" master miss rather than silently losing it.
 *
 * The hint to the right of the input reads both directions: a code shows the name it resolves to, and
 * a legacy NAME value shows the code it would resolve to — so an operator can see what a stored name
 * is about to become before saving.
 */
export function PartyPicker({
  kind,
  value,
  onChange,
  id,
  ariaLabel,
  placeholder,
  className,
  autoFocus,
}: PartyPickerProps) {
  const { data: parties } = useParties(kind)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const text = value ?? ''

  const matches = useMemo(() => {
    if (!parties || parties.length === 0) return []
    const q = text.trim().toLowerCase()
    const list = q
      ? parties.filter(
          (p) =>
            (p.code ?? '').toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.nameCh ?? '').toLowerCase().includes(q),
        )
      : parties
    return list.slice(0, MAX_OPTIONS)
  }, [parties, text])

  /**
   * What the current text resolves to. Code match first (the same order the backend uses), then the
   * normalised name — so a legacy raw name still gets a hint instead of looking unrecognised.
   */
  const resolved = useMemo(() => {
    const t = text.trim()
    if (!t || !parties) return undefined
    const byCode = parties.find((p) => (p.code ?? '').trim().toUpperCase() === t.toUpperCase())
    if (byCode) return { party: byCode, via: 'code' as const }
    const key = norm(t)
    if (key.length < 3) return undefined
    const named = parties.filter((p) => norm(p.name) === key || (p.nameCh != null && norm(p.nameCh) === key))
    // Ambiguous names resolve to nothing on the backend too — do not imply a link that will not happen.
    return named.length === 1 ? { party: named[0]!, via: 'name' as const } : undefined
  }, [parties, text])

  // Reset highlight when the query text changes (render-time adjust — no effect lag).
  const [prevText, setPrevText] = useState(text)
  if (text !== prevText) {
    setPrevText(text)
    setActive(0)
  }

  // Close on outside click (blur alone races with the option's mousedown).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (p: PartyMaster) => {
    // Code-storing kinds fall back to the name when a master has no code at all.
    const next = STORES[kind] === 'code' ? (p.code ?? p.name) : p.name
    onChange(next.trim())
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

  const secondary = (p: PartyMaster) => p.country ?? p.location ?? p.type ?? null

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        type="text"
        value={text}
        aria-label={ariaLabel}
        placeholder={placeholder ?? `Search ${kind}s — code or name`}
        autoFocus={autoFocus}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        data-testid={`party-picker-${kind}`}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {resolved && !open && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-text-muted">
          {resolved.via === 'code' ? (
            // A code is opaque on its own — say who it is.
            <span className="truncate">{resolved.party.name}</span>
          ) : STORES[kind] === 'code' ? (
            // A legacy NAME on a code-storing field — show the code it resolves to, so the operator
            // sees what it becomes. Forwarder stores names, so there is nothing to nudge toward.
            <span className="font-mono text-cobalt-primary-light">{resolved.party.code}</span>
          ) : null}
        </span>
      )}
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-surface-800 py-1 shadow-lg"
        >
          {matches.map((p, i) => (
            <li
              key={p.id}
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
              <span className="font-mono text-xs text-cobalt-primary-light">{p.code ?? '—'}</span>
              <span className="truncate">{p.name}</span>
              {secondary(p) ? (
                <span className="ml-auto shrink-0 text-xs text-text-muted">{secondary(p)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
