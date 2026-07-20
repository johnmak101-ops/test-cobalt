import { Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

type DaysStepperProps = {
  /** Absolute days, or null/undefined for “use default” (optional mode). */
  value: number | null
  onChange: (next: number | null) => void
  min?: number
  max?: number
  /** When true, null is allowed and shown as empty / “Default”. */
  optional?: boolean
  /** Shown when optional and value is null (e.g. "Default"). */
  emptyLabel?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  size?: 'md' | 'sm'
}

/**
 * Fixed-width day control — same footprint for Default and numeric values.
 * optional: null = no override; − from min clears to null; + from null starts at min (or 1).
 */
export function DaysStepper({
  value,
  onChange,
  min = 0,
  max = 30,
  optional = false,
  emptyLabel = 'Default',
  disabled = false,
  id: idProp,
  'aria-label': ariaLabel = 'Days',
  size = 'md',
}: DaysStepperProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const inputRef = useRef<HTMLInputElement>(null)
  const hasValue = value != null && Number.isFinite(value)
  const n = hasValue ? Math.round(value!) : null
  const [draft, setDraft] = useState<string>(n != null ? String(n) : '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(n != null ? String(n) : '')
  }, [n, editing])

  const isLg = size === 'md'
  // Identical outer size always (Default vs 1 day vs 12 days)
  const shell = isLg ? 'h-12 w-[11.5rem]' : 'h-11 w-[10.5rem]'
  const hit = isLg ? 'h-10 w-10' : 'h-9 w-9'
  const icon = isLg ? 18 : 16

  const dec = useCallback(() => {
    if (disabled) return
    if (n == null) return
    if (optional && n <= Math.max(min, 1)) {
      onChange(null)
      return
    }
    onChange(Math.max(min, n - 1))
  }, [disabled, n, optional, min, onChange])

  const inc = useCallback(() => {
    if (disabled) return
    if (n == null) {
      onChange(Math.max(min, optional ? 1 : min))
      return
    }
    onChange(Math.min(max, n + 1))
  }, [disabled, n, optional, min, max, onChange])

  const commitDraft = () => {
    setEditing(false)
    const raw = draft.trim()
    if (raw === '' && optional) {
      onChange(null)
      return
    }
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      setDraft(n != null ? String(n) : '')
      return
    }
    const clamped = Math.min(max, Math.max(min === 0 && optional ? 1 : min, parsed))
    if (optional && clamped <= 0) {
      onChange(null)
      return
    }
    onChange(clamped)
  }

  const canDec = !disabled && n != null && (optional ? true : n > min)
  const canInc = !disabled && (n == null || n < max)

  return (
    <div
      className={cn(
        shell,
        'inline-flex shrink-0 items-center justify-between gap-1 rounded-2xl border border-border',
        'bg-surface-800 px-1 shadow-sm',
        'ring-offset-bg focus-within:ring-2 focus-within:ring-cobalt-primary/40 focus-within:ring-offset-1',
        disabled && 'pointer-events-none opacity-50',
      )}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (disabled || editing) return
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault()
          inc()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault()
          dec()
        }
      }}
    >
      <button
        type="button"
        aria-label="Decrease days"
        disabled={!canDec}
        onClick={dec}
        className={cn(
          hit,
          'inline-flex shrink-0 items-center justify-center rounded-xl',
          'bg-surface-700 text-text-secondary',
          'transition-all duration-150',
          'hover:bg-surface-600 hover:text-text-primary',
          'active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-primary',
          'disabled:cursor-not-allowed disabled:bg-surface-700/40 disabled:text-text-muted/35 disabled:active:scale-100',
        )}
      >
        <Minus size={icon} strokeWidth={2.5} />
      </button>

      {/* Fixed center column — same height/width for Default and numbers */}
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-0.5">
        {n == null && !editing ? (
          <>
            <button
              type="button"
              id={id}
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                onChange(Math.max(min, optional ? 1 : min))
              }}
              className={cn(
                'w-full truncate text-center font-semibold leading-none text-text-muted',
                'rounded-md transition-colors hover:text-text-secondary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-primary',
                isLg ? 'text-sm' : 'text-xs',
              )}
              title="Click to set days"
            >
              {emptyLabel}
            </button>
            <span
              className={cn(
                'mt-0.5 font-medium uppercase tracking-wider text-text-muted/70',
                isLg ? 'text-[10px]' : 'text-[9px]',
              )}
            >
              days
            </span>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              id={id}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={disabled}
              aria-label={`${ariaLabel} value`}
              value={editing ? draft : n != null ? String(n) : draft}
              onFocus={() => {
                setEditing(true)
                setDraft(n != null ? String(n) : '')
              }}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, '')
                setDraft(v)
                setEditing(true)
                // Live-commit valid numbers so Save without blur still persists the typed value.
                if (v === '') return
                const parsed = Number.parseInt(v, 10)
                if (!Number.isFinite(parsed)) return
                const lo = min === 0 && optional ? 1 : min
                const clamped = Math.min(max, Math.max(lo, parsed))
                if (optional && clamped <= 0) return
                onChange(clamped)
              }}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  inputRef.current?.blur()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraft(n != null ? String(n) : '')
                  setEditing(false)
                  inputRef.current?.blur()
                }
              }}
              className={cn(
                'w-full border-0 bg-transparent text-center font-bold tabular-nums text-text-primary',
                'outline-none ring-0 selection:bg-cobalt-primary/30',
                isLg ? 'text-lg leading-none' : 'text-base leading-none',
              )}
            />
            <span
              className={cn(
                'mt-0.5 font-medium uppercase tracking-wider text-text-muted',
                isLg ? 'text-[10px]' : 'text-[9px]',
              )}
            >
              {n === 1 ? 'day' : 'days'}
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        aria-label="Increase days"
        disabled={!canInc}
        onClick={inc}
        className={cn(
          hit,
          'inline-flex shrink-0 items-center justify-center rounded-xl',
          'bg-cobalt-primary text-white shadow-sm shadow-cobalt-primary/25',
          'transition-all duration-150',
          'hover:bg-cobalt-primary-light',
          'active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface-800',
          'disabled:cursor-not-allowed disabled:bg-surface-700 disabled:text-text-muted/40 disabled:shadow-none disabled:active:scale-100',
        )}
      >
        <Plus size={icon} strokeWidth={2.5} />
      </button>
    </div>
  )
}
