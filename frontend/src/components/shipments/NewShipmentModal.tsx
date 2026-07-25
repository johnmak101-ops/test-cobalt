import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, PlusCircle, Loader2 } from 'lucide-react'
import { useCreateShipment, type CreateShipmentInput } from '../../hooks/use-shipments'
import { fieldLabel, fieldUnit, numericFieldWarn, isNumericColumn, isDateColumn, dateColumnHasTime } from '../../lib/review-fields'
import { MODE_EDIT_OPTIONS, UOM_OPTIONS } from '../../lib/enums'
import { DateTimeField } from './DateTimeField'
import { NumberField } from './NumberField'

/**
 * Manually create a shipment the pipeline never saw (e.g. the original booking email / attachment was
 * never ingested). The backend mints it through the committer, so a later agent email upserts into it by
 * booking/SO/… (no duplicate) and every field entered here is locked (human-wins). Lands in the Review
 * queue — on success we jump straight to it to finish the details.
 */
/** `label` defaults to the ONE vocabulary (fieldLabel). Spell one out ONLY for a key that is not an
 *  editable leg column — PO#(s), customer/forwarder and the ports have no EDITABLE_FIELDS entry. */
type Field = {
  key: keyof CreateShipmentInput
  label?: string
  placeholder?: string
  wide?: boolean
  options?: readonly string[]
}

const IDENTITY: Field[] = [
  { key: 'bookingNo' },
  { key: 'soNo' },
  { key: 'hblAwbFcrNo' },
  { key: 'mbl' },
  { key: 'containerNo' },
  { key: 'pos', label: 'PO#(s)', placeholder: 'comma-separated', wide: true },
]
const ROUTE: Field[] = [
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'forwarderName', label: 'Forwarder' },
  { key: 'mode', options: MODE_EDIT_OPTIONS },
  { key: 'pol', label: 'POL', placeholder: 'e.g. HKG' },
  { key: 'pod', label: 'POD', placeholder: 'e.g. FRA' },
]
const CARGO: Field[] = [
  { key: 'qty' },
  { key: 'qtyUnit', options: UOM_OPTIONS },
  { key: 'grossWeight' },
  // Measurement (CBM) removed from create form — same as Order Details / review flags
  { key: 'itemStyleNo', wide: true },
  { key: 'consigneeName', wide: true },
]
const DATES: Field[] = [
  { key: 'cargoReadyDate' },
  { key: 'etd' },
]

const STRONG: (keyof CreateShipmentInput)[] = ['bookingNo', 'soNo', 'hblAwbFcrNo', 'mbl', 'containerNo']
/**
 * Rendered as number inputs with min=0 (the backend rejects negatives / bad counts regardless).
 * Derived from isNumericColumn rather than hand-listed: a hand-list silently misses a field the
 * moment one is added above, and a numeric field that falls through to free text reaches
 * coerceLegField, which turns anything Number() cannot read into NULL.
 */
const NUMERIC: (keyof CreateShipmentInput)[] = [...IDENTITY, ...ROUTE, ...CARGO, ...DATES]
  .map((f) => f.key)
  .filter((k) => isNumericColumn(String(k)))

const controlClass =
  'h-9 rounded-lg border border-border bg-surface-900 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

export function NewShipmentModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreateShipment()
  const [form, setForm] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const has = (k: string) => (form[k] ?? '').trim() !== ''
  const canSubmit = STRONG.some((k) => has(k)) || has('pos')
  const hasNumericErrors = NUMERIC.some((k) => numericFieldWarn(String(k), form[k]) != null)

  const submit = () => {
    if (!canSubmit || create.isPending || hasNumericErrors) return
    const body: CreateShipmentInput = { note: note.trim() || undefined }
    for (const [k, raw] of Object.entries(form)) {
      const v = raw.trim()
      if (!v) continue
      if (k === 'pos') body.pos = v.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)
      else (body as Record<string, unknown>)[k] = v
    }
    create.mutate(body, { onSuccess: (res) => { onClose(); navigate(`/shipments/${res.id}`) } })
  }

  const renderField = (fld: Field) => {
    const cur = form[fld.key] ?? ''
    const numErr = NUMERIC.includes(fld.key) ? numericFieldWarn(String(fld.key), cur) : null
    return (
      <label key={fld.key} className={fld.wide ? 'flex flex-col gap-1 sm:col-span-2' : 'flex flex-col gap-1'}>
        <span className="text-xs text-text-muted">{fld.label ?? fieldLabel(fld.key)}</span>
        {fld.options ? (
          <select
            data-testid={`create-select-${fld.key}`}
            value={cur}
            onChange={(e) => set(fld.key, e.target.value)}
            className={controlClass}
          >
            <option value="">—</option>
            {fld.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : isDateColumn(String(fld.key)) ? (
          <DateTimeField
            value={cur}
            onChange={(v) => set(fld.key, v)}
            showTime={dateColumnHasTime(String(fld.key))}
            label={fld.label ?? fieldLabel(fld.key)}
            className={controlClass}
          />
        ) : NUMERIC.includes(fld.key) ? (
          <NumberField
            ariaLabel={fld.label ?? fieldLabel(fld.key)}
            value={cur}
            onChange={(v) => set(fld.key, v)}
            decimals={fld.key !== 'qty'}
            unit={fld.key === 'qty' ? form.qtyUnit || null : fieldUnit(String(fld.key))}
            error={numErr}
            className={controlClass}
          />
        ) : (
          <input
            value={cur}
            onChange={(e) => set(fld.key, e.target.value)}
            placeholder={fld.placeholder}
            className={controlClass}
          />
        )}
      </label>
    )
  }

  const section = (title: string, fields: Field[]) => (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-text-muted">{title}</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields.map(renderField)}</div>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex items-start gap-2.5">
            <PlusCircle size={16} className="mt-0.5 shrink-0 text-text-muted" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">New Shipment</h3>
              <p className="mt-0.5 text-xs text-text-muted">
                For a booking the system missed. Enter what you know — it saves as <em>provisional</em> and opens in the Review queue.
                A later email with the same booking/SO fills the gaps automatically.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {section('Identity — at least one of these (or a PO)', IDENTITY)}
          {section('Route & Parties', ROUTE)}
          {section('Cargo', CARGO)}
          {section('Key Dates', DATES)}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Note (why you're adding this)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. original NEW BOOKING email + attachment was never ingested"
              className={controlClass}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-xs text-status-critical">
            {create.isError
              ? `Failed to create — ${(create.error instanceof Error ? create.error.message : '').replace(/^API error \d+:\s*/, '') || 'please try again.'}`
              : !canSubmit ? 'Enter a booking/SO/HBL/MBL/container number or a PO.' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || create.isPending || hasNumericErrors}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
              Create shipment
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
