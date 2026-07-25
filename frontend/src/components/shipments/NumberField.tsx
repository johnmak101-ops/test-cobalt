import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { cn } from '../../lib/utils'

interface NumberFieldProps {
  /** Raw, ungrouped digits — what the form stores and posts ("13516"). */
  value: string
  onChange: (raw: string) => void
  /** Echoed read-only beside the number so it stops being unitless ("cartons"). */
  unit?: string | null
  /** Caller's validation message. Rendered only AFTER the field has been left — see below. */
  error?: string | null
  /** Counts (qty) are whole; measures (weight, CBM) take one decimal point. */
  decimals?: boolean
  id?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
  disabled?: boolean
  testId?: string
}

/** Group the INTEGER part only, character-wise — never through Number(). */
function groupForInput(raw: string): string {
  if (!raw) return ''
  const [int, ...rest] = raw.split('.')
  // A trailing "." and any leading zeros are preserved verbatim: Number('07') would silently
  // rewrite what the operator typed, and Number('12.') would eat the dot mid-keystroke.
  const frac = rest.length ? `.${rest.join('')}` : ''
  return `${(int ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac}`
}

/** Keep digits (and at most one dot when decimals are allowed); drop everything else. */
function sanitize(text: string, decimals: boolean): string {
  const kept = text.replace(decimals ? /[^\d.]/g : /[^\d]/g, '')
  if (!decimals) return kept
  const i = kept.indexOf('.')
  return i === -1 ? kept : `${kept.slice(0, i + 1)}${kept.slice(i + 1).replace(/\./g, '')}`
}

const countDigits = (s: string) => (s.match(/[\d.]/g) ?? []).length

/**
 * A numeric field that is a TEXT input, not `type="number"`.
 *
 * `type="number"` mutates its own value on scroll-wheel while focused. Order Details is a long
 * scrolling form, so tabbing into Total Quantity and scrolling on to Key Dates silently changed the
 * quantity — and it then saved as an ordinary human edit: locked, audited, indistinguishable from an
 * intentional one. It also rejects a pasted "1,240" to an empty box, which is the exact gesture an
 * operator makes off a packing list.
 *
 * So: no spinners, no wheel, `inputMode="numeric"` to keep the numeric keypad on touch, and our own
 * rules. Grouping is applied as you type (with the caret held in place); the caller only ever sees
 * raw digits. Paste is tolerant — "1,240", "1 240" and "1,240 CTNS" all land as 1240.
 *
 * The error renders only after the field has been LEFT. "0" is a normal thing to have typed on the
 * way to "10", and a field that shouts mid-word trains people to ignore it. The caller still gets
 * the error immediately for its save gate — this only governs when the message is shown.
 */
export function NumberField({
  value,
  onChange,
  unit,
  error,
  decimals = false,
  id,
  ariaLabel,
  placeholder,
  className,
  disabled = false,
  testId,
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  /** Digits before the caret at the moment of the edit — re-found after regrouping. */
  const caretDigits = useRef<number | null>(null)
  const [touched, setTouched] = useState(false)

  const display = groupForInput(value)

  useLayoutEffect(() => {
    const el = inputRef.current
    const want = caretDigits.current
    if (!el || want == null) return
    caretDigits.current = null
    let seen = 0
    let i = 0
    for (; i < el.value.length && seen < want; i++) {
      if (/[\d.]/.test(el.value[i]!)) seen++
    }
    el.setSelectionRange(i, i)
  })

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const pos = el.selectionStart ?? el.value.length
    // Count by DIGITS, not by string offset: regrouping shifts every comma after the caret.
    caretDigits.current = countDigits(el.value.slice(0, pos))
    onChange(sanitize(el.value, decimals))
  }

  const showError = touched && !!error

  return (
    <div className="min-w-0">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode={decimals ? 'decimal' : 'numeric'}
          aria-label={ariaLabel}
          aria-invalid={showError || undefined}
          autoComplete="off"
          value={display}
          disabled={disabled}
          placeholder={placeholder}
          onChange={handleChange}
          onBlur={() => setTouched(true)}
          className={cn(className, unit ? 'pr-16' : undefined, 'disabled:opacity-40')}
          data-testid={testId ?? 'number-field'}
        />
        {unit && (
          <span
            className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-text-muted"
            data-testid="number-field-unit"
          >
            {unit}
          </span>
        )}
      </div>
      {showError && (
        <p className="mt-1 text-xs text-status-critical" data-testid="number-field-error">
          {error}
        </p>
      )}
    </div>
  )
}
