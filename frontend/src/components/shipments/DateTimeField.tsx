import { cn } from '../../lib/utils'

interface DateTimeFieldProps {
  /** One string, "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". Empty means no value. */
  value: string
  onChange: (value: string) => void
  id?: string
  /** Names the time box for screen readers: "<label> time". */
  label: string
  className?: string
  disabled?: boolean
  /**
   * Show the time box. Only the cut-off family (warehouse window, CFS) states a clock time; ETD /
   * ATD / ETA / ATA / CRD / In-DC are day-level, where a time box is noise and an incidental 08:00
   * reads as if someone meant it. Default true so an unflagged caller keeps the full control.
   */
  showTime?: boolean
}

/**
 * Date + optional time over ONE string ("YYYY-MM-DDTHH:mm").
 *
 * NOT a `datetime-local` input: that control reports "" until BOTH parts are typed, so picking a day
 * into an empty field never reached the draft and the edit silently vanished on Save. A bare day
 * defaults to 00:00 (reads back as date-only); a stored cut-off time sits in the time box and
 * survives day-only edits. Clearing the day clears the whole value.
 *
 * Nothing here constructs a Date. The value is sliced and re-joined as text, because the system's
 * convention is naive HK wall-clock strings that the backend turns into an instant — parsing to a
 * Date and formatting back would move a value across midnight in the wrong timezone.
 *
 * Extracted from the Order Details edit form so the review conflict row and the New Shipment modal
 * get the same control, rather than each surface growing its own date input (the review row had
 * none at all — dates fell through to free text).
 */
export function DateTimeField({
  value,
  onChange,
  id,
  label,
  className,
  disabled = false,
  showTime = true,
}: DateTimeFieldProps) {
  const dateVal = value.slice(0, 10)
  const timeVal = value.slice(11, 16)
  const put = (d: string, t: string) => onChange(d ? `${d}T${t || '00:00'}` : '')

  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <input
          id={id}
          type="date"
          aria-label={label}
          value={dateVal}
          disabled={disabled}
          onChange={(e) => put(e.target.value, timeVal)}
          className={cn(className, 'disabled:opacity-40')}
          data-testid="datetime-date"
        />
      </div>
      {showTime && (
      <div className="w-24 flex-none">
        <input
          type="time"
          aria-label={`${label} time`}
          value={timeVal}
          /* No day means no instant to attach a time to — the box stays inert until one is picked. */
          disabled={disabled || !dateVal}
          onChange={(e) => put(dateVal, e.target.value)}
          className={cn(className, 'disabled:opacity-40')}
          data-testid="datetime-time"
        />
      </div>
      )}
    </div>
  )
}
