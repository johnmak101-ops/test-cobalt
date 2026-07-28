import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

interface TextFieldProps {
  value: string
  onChange: (value: string) => void
  /** Caller's validation message. Rendered only AFTER the field has been left — see below. */
  error?: string | null
  /**
   * Render a wrapping, auto-growing `<textarea>` instead of a one-line input. For values that are
   * genuinely long prose rather than a code — see {@link EditableField.multiline}.
   */
  multiline?: boolean
  id?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
  testId?: string
}

/**
 * Grow a textarea to fit its content — no inner scrollbar, no fixed row count that is wrong for both
 * the short values and the long ones. Capped so one enormous paste cannot own the form.
 *
 * 320px ≈ 12 lines. Measured against the real worst case on the dev data: consignee addresses that
 * carry the consignee block AND the forwarder's block in one column run to 9 lines / 262px. A 200px
 * cap put a scrollbar inside the box for exactly the value that most needed to be read whole, which
 * is the defect this component was added to fix, one step smaller. `resize-y` stays as the escape
 * hatch for anything past the cap.
 */
const MAX_ROWS_PX = 320

/**
 * A plain text input that can carry an inline validation message, on the same terms as
 * {@link NumberField}: the caller gets the error immediately for its save gate, but the message is
 * only SHOWN once the field has been left.
 *
 * "MSBU" is a normal thing to have typed on the way to "MSBU7281200". A field that shouts mid-word
 * trains people to ignore it, which costs more than the typo it was catching.
 *
 * This exists because the format gates (`containerNo`, `scacCode`) had nowhere to render. Both the
 * create form and the detail edit form dropped every text column into a bare `<input>` with no error
 * slot, so a malformed container number could only be reported by the backend — as a single line at
 * the foot of a long scrolling form, naming a field the operator could no longer see.
 *
 * `multiline` was the second thing a bare `<input>` could not do. A consignee address is one field
 * holding four lines of an address block; in a one-line box the operator could see about a third of
 * it and had to arrow-key through the rest to read their own data. The read view has wrapped all
 * along (`.field-value`), so edit mode was the only place the value was unreadable.
 */
export function TextField({
  value,
  onChange,
  error,
  multiline = false,
  id,
  ariaLabel,
  placeholder,
  className,
  testId,
}: TextFieldProps) {
  const [touched, setTouched] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const showError = touched && !!error

  // Height follows the content. Reset to 'auto' first or the box can only ever grow — shortening the
  // value would leave the taller height behind.
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`
  }, [value, multiline])

  const shared = {
    id,
    'aria-label': ariaLabel,
    'aria-invalid': showError || undefined,
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onBlur: () => setTouched(true),
    className: cn(className, showError && 'border-status-critical focus:border-status-critical'),
    'data-testid': testId ?? 'text-field',
  }

  return (
    <div className="min-w-0">
      {multiline ? (
        <textarea
          {...shared}
          ref={areaRef}
          rows={2}
          /* h-8/h-9 comes from the shared control class and would pin a textarea to one line. */
          className={cn(shared.className, 'block h-auto min-h-8 resize-y overflow-y-auto py-1.5 leading-snug')}
        />
      ) : (
        <input {...shared} type="text" />
      )}
      {showError && (
        <p className="mt-1 text-xs text-status-critical" data-testid="text-field-error">
          {error}
        </p>
      )}
    </div>
  )
}
