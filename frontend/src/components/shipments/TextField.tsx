import { useState } from 'react'
import { cn } from '../../lib/utils'

interface TextFieldProps {
  value: string
  onChange: (value: string) => void
  /** Caller's validation message. Rendered only AFTER the field has been left — see below. */
  error?: string | null
  id?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
  testId?: string
}

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
 */
export function TextField({
  value,
  onChange,
  error,
  id,
  ariaLabel,
  placeholder,
  className,
  testId,
}: TextFieldProps) {
  const [touched, setTouched] = useState(false)
  const showError = touched && !!error

  return (
    <div className="min-w-0">
      <input
        id={id}
        type="text"
        aria-label={ariaLabel}
        aria-invalid={showError || undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        className={cn(className, showError && 'border-status-critical focus:border-status-critical')}
        data-testid={testId ?? 'text-field'}
      />
      {showError && (
        <p className="mt-1 text-xs text-status-critical" data-testid="text-field-error">
          {error}
        </p>
      )}
    </div>
  )
}
