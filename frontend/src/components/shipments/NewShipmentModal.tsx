import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, PlusCircle, Loader2 } from 'lucide-react'
import { useCreateShipment, type CreateShipmentInput } from '../../hooks/use-shipments'
import {
  EDITABLE_FIELDS,
  createFieldKey,
  fieldUnit,
  fieldWarn,
  dateOrderIssues,
  type EditableField,
} from '../../lib/review-fields'
import { isAirMode, isOffModeField, offModeHint, shippingFieldVisible } from '../../lib/mode-fields'
import { cn } from '../../lib/utils'
import { DateTimeField } from './DateTimeField'
import { NumberField } from './NumberField'
import { TextField } from './TextField'
import { PortPicker } from './PortPicker'
import { PartyPicker } from './PartyPicker'

/**
 * Manually create a shipment the pipeline never saw (e.g. the original booking email / attachment was
 * never ingested). The backend mints it through the committer, so a later agent email upserts into it by
 * booking/SO/… (no duplicate) and every field entered here is locked (human-wins). Lands in the Review
 * queue — on success we jump straight to it to finish the details.
 *
 * ONE FORM. Every field, label, editor, picker, enum and mode rule is generated from `EDITABLE_FIELDS`,
 * the same array the shipment detail page's edit form is generated from — so the two cannot drift, and
 * a field added there appears here without anyone remembering to add it.
 *
 * They HAD drifted, and it showed where it hurt most. This form rendered plain `<input>`s for POL, POD,
 * Customer and Forwarder while the detail page rendered master pickers, so `dsfsdf` was an acceptable
 * port of loading — a leg born with an unresolvable port and party, which then arrived in the review
 * queue as a port miss and a Mesh miss. That is review work manufactured at the one moment the operator
 * actually knew the answer. Meanwhile the form offered Gross Weight, Item/Style and Measurement, which
 * the detail page had deliberately removed, and omitted MAWB, SCAC, Vendor, Warehouse SO, Consignee
 * Address, Vessel, Voyage, Flight and six of the nine dates — including the CFS cut-off, on the one form
 * whose entire purpose is capturing a booking nobody else recorded.
 */

/** PO#(s) has no `EDITABLE_FIELDS` entry: POs are linked rows, not a leg column. It rides in Order Info
 *  because that is where the identity a person types lives. */
const PO_KEY = 'pos'

const SECTION_ORDER: EditableField['section'][] = ['Order Info', 'Cargo & Logistics', 'Shipping', 'Key Dates']

/** Backend gate (`createManual`): at least one strong identity OR a PO. Mirrors STRONG_DTO. */
const STRONG_COLUMNS = ['bookingNo', 'soNo', 'hblAwbFcrNo', 'mbl', 'containerNo']

const controlBase =
  'h-9 w-full rounded-lg border bg-surface-900 px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none'

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
  const mode = form.mode ?? ''

  const canSubmit = STRONG_COLUMNS.some((c) => has(c)) || has(PO_KEY)
  // Every gate, every field — not just the numeric ones. Asking only `numericFieldWarn`, and only for
  // `type === 'number'`, is what let a malformed container number reach the backend and come back as a
  // footer line naming a field that had scrolled off screen.
  const fieldErrors = EDITABLE_FIELDS.some((f) => fieldWarn(f.column, form[f.column]) != null)
  // Same cross-field date check the detail page runs, for the same reason: this form can equally
  // produce an ETA before its ETD, and catching it here beats catching it in the review queue.
  const dateIssues = useMemo(
    () => dateOrderIssues({ etd: form.etd, atd: form.atd, eta: form.eta, ata: form.ata }),
    [form.etd, form.atd, form.eta, form.ata],
  )
  const dateClashFields = useMemo(() => {
    const s = new Set<string>()
    for (const i of dateIssues) {
      s.add(i.arrival)
      for (const d of i.departures) s.add(d)
    }
    return s
  }, [dateIssues])

  const blocked = !canSubmit || create.isPending || fieldErrors || dateIssues.length > 0

  const submit = () => {
    if (blocked) return
    const body: Record<string, unknown> = { note: note.trim() || undefined }
    for (const f of EDITABLE_FIELDS) {
      const v = (form[f.column] ?? '').trim()
      if (v) body[createFieldKey(f)] = v
    }
    const pos = (form[PO_KEY] ?? '').split(/[,;]+/).map((p) => p.trim()).filter(Boolean)
    if (pos.length) body.pos = pos
    create.mutate(body as CreateShipmentInput, {
      onSuccess: (res) => {
        onClose()
        navigate(`/shipments/${res.id}`)
      },
    })
  }

  const renderField = (f: EditableField) => {
    const cur = form[f.column] ?? ''
    const err = fieldWarn(f.column, cur)
    const offMode = isOffModeField(f.column, mode)
    // Both ends of a date clash are ringed — either could be the wrong value, so ringing one would
    // read as a verdict about which to change. Same rule as the detail page.
    const inDateClash = dateClashFields.has(f.column)
    const controlClass = cn(
      controlBase,
      inDateClash
        ? 'border-status-critical focus:border-status-critical'
        : 'border-border focus:border-cobalt-primary',
    )
    const id = `create-${f.column}`
    const issue = dateIssues.find((i) => i.arrival === f.column)

    return (
      // A long value gets the whole row rather than half of it — the same reason the detail form
      // lets it wrap: half a two-column grid is not enough to read an address block in.
      <label key={f.column} className={cn('flex flex-col gap-1', f.multiline && 'sm:col-span-2')}>
        <span className="text-xs text-text-muted">
          {f.label}
          {/* An off-mode field only reaches here because it HOLDS a value (shippingFieldVisible) —
              the operator typed it, then changed Mode. Say so, and give the way to empty it. */}
          {offMode && (
            <button
              type="button"
              onClick={() => set(f.column, '')}
              title={offModeHint(mode)}
              data-testid={`create-off-mode-clear-${f.column}`}
              className="mt-0.5 block text-left text-[11px] font-medium text-status-warning hover:text-status-critical hover:underline"
            >
              {isAirMode(mode) ? 'SEA field' : 'AIR field'} · clear
            </button>
          )}
        </span>
        {f.picker === 'port' ? (
          <PortPicker
            id={id}
            value={cur}
            onChange={(v) => set(f.column, v)}
            placeholder="Search ports — UN/LOCODE or name"
            className={controlClass}
          />
        ) : f.picker ? (
          <PartyPicker
            kind={f.picker}
            id={id}
            value={cur}
            onChange={(v) => set(f.column, v)}
            placeholder={`Search ${f.picker}s — code or name`}
            className={controlClass}
          />
        ) : f.options ? (
          <select
            id={id}
            data-testid={`create-select-${f.column}`}
            value={cur}
            onChange={(e) => set(f.column, e.target.value)}
            className={controlClass}
          >
            <option value="">—</option>
            {f.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : f.type === 'date' ? (
          <DateTimeField
            value={cur}
            onChange={(v) => set(f.column, v)}
            showTime={f.withTime === true}
            label={f.label}
            className={controlClass}
          />
        ) : f.type === 'number' ? (
          <NumberField
            ariaLabel={f.label}
            value={cur}
            onChange={(v) => set(f.column, v)}
            decimals={f.column !== 'qty'}
            unit={f.column === 'qty' ? form.qtyUnit || null : (f.unit ?? fieldUnit(f.column))}
            error={err}
            className={controlClass}
          />
        ) : (
          <TextField
            id={id}
            ariaLabel={f.label}
            value={cur}
            onChange={(v) => set(f.column, v)}
            error={err}
            multiline={f.multiline}
            className={controlClass}
          />
        )}
        {issue && <span className="text-[11px] text-status-critical">{issue.message}</span>}
      </label>
    )
  }

  const renderPos = () => (
    <label key={PO_KEY} className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-xs text-text-muted">PO#(s)</span>
      <input
        id={`create-${PO_KEY}`}
        value={form[PO_KEY] ?? ''}
        onChange={(e) => set(PO_KEY, e.target.value)}
        placeholder="comma-separated"
        className={cn(controlBase, 'border-border focus:border-cobalt-primary')}
      />
    </label>
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
          <p className="rounded-lg border border-border bg-surface-900 px-3 py-2 text-xs text-text-muted">
            Needs at least one of <span className="text-text-secondary">Booking No., SO#, HBL/HAWB/FCR, MBL, Container No.</span> or a PO#.
          </p>
          {SECTION_ORDER.map((section) => {
            const fields = EDITABLE_FIELDS.filter(
              (f) => f.section === section && shippingFieldVisible(f.column, mode, form[f.column]),
            )
            if (!fields.length && section !== 'Order Info') return null
            return (
              <div key={section} className="space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">{section}</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fields.map(renderField)}
                  {section === 'Order Info' && renderPos()}
                </div>
              </div>
            )
          })}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Note (why you're adding this)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. original NEW BOOKING email + attachment was never ingested"
              className={cn(controlBase, 'border-border focus:border-cobalt-primary')}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-xs text-status-critical">
            {create.isError
              ? `Failed to create — ${(create.error instanceof Error ? create.error.message : '').replace(/^API error \d+:\s*/, '') || 'please try again.'}`
              : !canSubmit
                ? 'Enter a booking/SO/HBL/MBL/container number or a PO.'
                : dateIssues.length > 0
                  ? 'Fix the dates flagged above.'
                  : fieldErrors
                    ? 'Fix the highlighted field above.'
                    : ''}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={blocked}
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
