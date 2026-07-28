import { createContext, useId, useMemo, useState, useContext } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useShipment, useUpdateShipment, type ShipmentDetail } from '../hooks/use-shipments'
import { useShipmentHistory } from '../hooks/use-shipment-history'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { MilestoneTimeline } from '../components/shipments/MilestoneTimeline'
import { CategorizedShipmentHistory } from '../components/shipments/CategorizedShipmentHistory'
import { ContestedLockCard } from '../components/shipments/ContestedLockCard'
import { PurchaseOrdersCard } from '../components/shipments/PurchaseOrdersCard'
import { PortPicker } from '../components/shipments/PortPicker'
import { PartyPicker } from '../components/shipments/PartyPicker'
import {
  FieldHistoryContext,
  FieldHistoryPopover,
  HOVER_CARD_CLASS,
  useHoverPopover,
} from '../components/shipments/FieldHistoryPopover'
import { createPortal } from 'react-dom'
import { indexHistoryByField, historyForField } from '../lib/history-grouping'
import { pendingReviewAnnotations, type PendingAnnotation } from '../lib/pending-review'
import { liveQtyFromShipment, poShipmentTotalFromLinked } from '../lib/qty-conflict-settle'
import { AlertCard } from '../components/alerts/AlertCard'
import { formatDate, formatDateTime, formatDateMaybeTime, formatShipmentId, cn } from '../lib/utils'
import { parseSender } from '../lib/email-sender'
import { EDITABLE_FIELDS, fieldLabel, fieldUnit, fieldWarn, dateOrderIssues, toInputValue, type EditableField, formatNumericDisplay, dateColumnHasTime } from '../lib/review-fields'
import { isAirMode, isOffModeField, offModeFieldsOn, shippingFieldVisible, offModeHint } from '../lib/mode-fields'
import { toast } from '../components/ui/Toast'
import { interactiveProps } from '../lib/interactive'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { ArrowLeft, Mail, Clock, ClipboardList, Package, Ship, Calendar, AlertTriangle, AlertCircle, Info, Pencil, Check, X, NotebookPen } from 'lucide-react'
import { DateTimeField } from '../components/shipments/DateTimeField'
import { NumberField } from '../components/shipments/NumberField'
import { TextField } from '../components/shipments/TextField'

// The human-editable leg fields, grouped like the read-only card. `db` = the backend column the PATCH writes
// (+ locks + audits); `get` reads the current value off the loaded shipment (whose UI names differ from db).
// Mode / POL / POD / forwarder / customer / vendor are all editable free-text raw columns (#183 + the
// Mesh-lag stand-in): masters are read-only ERP, so the raw twin holds the correct party/port until the
// master resolves. POL/POD pick from the seeded ports master. Item·Style is not on Order Details
// (per-PO on the Customer Purchase Orders card).
type EditType = 'text' | 'number' | 'date'
interface EditField {
  db: string
  label: string
  type: EditType
  options?: readonly string[]
  /** Full legal enum when options is a shorter offer list (Mode) — see EditableField.allValues. */
  allValues?: readonly string[]
  picker?: EditableField['picker']
  get: (s: ShipmentDetail) => unknown
}
/**
 * Derived from EDITABLE_FIELDS, never hand-listed: this modal used to keep its own copy of every
 * label and it drifted from both the read view below it and the review queue's conflict table.
 * Item·Style is not in EDITABLE_FIELDS — it lives on the Customer Purchase Orders card (per-PO).
 */
const EDIT_SECTIONS: { title: string; fields: EditField[] }[] = (() => {
  const order: EditableField['section'][] = ['Order Info', 'Cargo & Logistics', 'Shipping', 'Key Dates']
  return order.map((title) => ({
    title,
    fields: EDITABLE_FIELDS.reduce<EditField[]>((acc, f) => {
      if (f.section !== title) return acc
      acc.push({
        db: f.column,
        label: f.label,
        type: f.type,
        options: f.options,
        allValues: f.allValues,
        picker: f.picker,
        get: (s: ShipmentDetail) => {
          // Prefer free-text raw; fall back to resolved master name so edit is not blank when only FK is set.
          if (f.column === 'forwarderRaw') return s.forwarderRaw ?? s.forwarder?.name ?? null
          if (f.column === 'customerRaw') return s.customerRaw ?? s.customer?.name ?? null
          if (f.column === 'vendorRaw') return s.vendorRaw ?? s.vendor?.name ?? null
          return (s as unknown as Record<string, unknown>)[f.uiKey]
        },
      })
      return acc
    }, []),
  }))
})()
// Draft strings come from the shared lib/review-fields toInputValue: dates render as LOCAL
// datetime-local ("2026-03-02T18:00"), so a timed cut-off (截仓 18:00) survives an edit — the old
// page-local copy sliced toISOString() to date-only, which hid the time, saved it back as midnight,
// and could even shift the DAY (UTC slice of a local midnight).

/**
 * Leg columns with something open for review (provisional conflicts + contested locks) — DetailRows
 * read it by their own historyKey, same pattern as FieldHistoryContext, instead of threading a
 * boolean through ~30 call sites.
 */
const PendingReviewContext = createContext<ReadonlyMap<string, PendingAnnotation>>(new Map())

/**
 * Hide a sea-only or air-only field — but ONLY when it is empty.
 *
 * `shippingFieldVisible` / `offModeHint` moved to lib/mode-fields.ts when the New Shipment form
 * needed the same rule — see their doc comments there.
 */

/** House bill label: HAWB on air, HBL/FCR on sea. */
function houseBillLabel(mode: string | null | undefined): string {
  return isAirMode(mode) ? 'HAWB' : fieldLabel('hblAwbFcrNo')
}

export default function ShipmentDetailPage() {
  const fieldId = useId()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const fromAlerts = (location.state as { fromAlerts?: boolean })?.fromAlerts
  const { data: shipment, isLoading } = useShipment(id!)
  const { data: historyData } = useShipmentHistory(id!)
  // Index once; DetailRows read their field's history from context, the History tab groups it.
  const historyIndex = useMemo(() => indexHistoryByField(historyData?.history ?? []), [historyData])
  /**
   * Which columns get the amber "something open for review" word-highlight — computed with the SAME
   * cargo figures the review desk settles qty against, so a field the desk auto-passed cannot show a
   * conflict here. The two surfaces must agree on what is open.
   */
  const pendingReview = useMemo(
    () =>
      pendingReviewAnnotations(shipment, {
        liveQty: liveQtyFromShipment((shipment ?? {}) as { quantityShipped?: number | null }),
        poShipmentTotal: poShipmentTotalFromLinked(shipment?.linkedPOs ?? []),
      }),
    [shipment],
  )
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')
  const update = useUpdateShipment(id!)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  /** Carry-over exceptions: a column in here is one the operator chose to KEEP across a mode change. */
  const [keepOnSwitch, setKeepOnSwitch] = useState<Record<string, boolean>>({})
  /** Related Emails list pagination (client-side; threads can be 30–100+). */
  const [emailPage, setEmailPage] = useState(1)
  const [emailPerPage, setEmailPerPage] = useState(10)
  // Reset page when navigating to another shipment.
  const [emailPageShipId, setEmailPageShipId] = useState(id)
  if (id !== emailPageShipId) {
    setEmailPageShipId(id)
    setEmailPage(1)
  }
  const relatedEmails = shipment?.emails ?? []
  const {
    totalItems: emailTotal,
    totalPages: emailTotalPages,
    pageSize: emailPageSize,
    getPage: getEmailPage,
  } = usePagination(relatedEmails, emailPerPage)
  // Clamp when the list shrinks (e.g. after navigation / filter).
  const safeEmailPage = Math.min(emailPage, emailTotalPages)
  const pageEmails = getEmailPage(safeEmailPage)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Loading shipment...</span>
      </div>
    )
  }

  if (!shipment) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Shipment not found</span>
      </div>
    )
  }

  const linkedPOs = shipment.linkedPOs ?? []
  // Date of the most recent related email — the old "Email Date" showed the DB row's createdAt,
  // which is ingest time (e.g. a reparse date), not when any email actually arrived.
  const lastEmailAt =
    (shipment.emails ?? [])
      .flatMap((e) => (e.receivedAt ? [e.receivedAt] : []))
      .sort()
      .at(-1) ?? null
  // Title identity (#348/#350, trimmed 2026-07-24): ONLY the derived Shipment ID — always present,
  // one shape for every leg, anchored to the beginning email (fallback: creation). #151's
  // "· Leg n/N" ordinal rides it. Booking No. and the SO pair live in the Order Details rows.
  const shipmentIdValue =
    formatShipmentId(shipment.id, shipment.firstEmailAt ?? shipment.createdAt) +
    ((shipment.legCount ?? 1) > 1 ? ` · Leg ${shipment.legNo ?? 1}/${shipment.legCount}` : '')
  const titleIds = [{ label: 'Shipment ID', value: shipmentIdValue }]
  const activeAlerts = (shipment.alerts ?? []).filter((a) => a.status === 'ACTIVE')
  const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length
  const warningCount = activeAlerts.filter((a) => a.severity === 'WARNING').length
  const infoCount = activeAlerts.filter((a) => a.severity === 'INFO').length
  const topSeverity = criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'INFO'

  const startEdit = () => {
    const d: Record<string, string> = {}
    for (const sec of EDIT_SECTIONS) for (const f of sec.fields) d[f.db] = toInputValue(f.get(shipment), f.type)
    setDraft(d)
    setNote('')
    setKeepOnSwitch({})
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setNote('')
  }
  /**
   * Fields a PENDING mode change would strand — read off the draft, against the draft's new mode.
   *
   * A mode change is a reclassification, not a field edit: it invalidates one set of transport fields
   * and requires another. Nothing used to say so, so a leg switched AIR→SEA silently kept its flight
   * number for good. Computed from the draft (not the shipment) so that clearing a row by its own
   * `· clear` control drops it from this list too, instead of leaving a stale entry behind.
   */
  const modeCarryOver = editing
    ? offModeFieldsOn({
        mode: draft.mode,
        vesselName: draft.vesselName,
        voyageNumber: draft.voyageNo,
        mblNumber: draft.mbl,
        flightNo: draft.flightNo,
        mawb: draft.mawb,
      }).filter(() => (draft.mode ?? '') !== '' && (draft.mode ?? '') !== (shipment.mode ?? ''))
    : []
  /**
   * Ticked = clear (the default, and the operator's stated preference). Absent means ticked; this map
   * only records the exceptions, so a fresh mode change starts fully ticked without seeding state.
   *
   * Clearing is safe BECAUSE the values are preserved — every write goes through the shipment history
   * this page already renders. So this is filing, not deletion, and a sea shipment still reporting a
   * flight number is wrong in every downstream consumer.
   */
  const willClear = (column: string) => keepOnSwitch[column] !== true

  // draft vs the saved shipment — computed on every render so the Save gate reacts to edits live.
  const computeChanged = (): Record<string, unknown> => {
    const changed: Record<string, unknown> = {}
    for (const sec of EDIT_SECTIONS) for (const f of sec.fields) {
      const orig = toInputValue(f.get(shipment), f.type)
      const next = draft[f.db] ?? ''
      if (next !== orig) changed[f.db] = next === '' ? null : next
    }
    // The carry-over clears ride on the SAME save, so the reclassification lands as one act rather
    // than as a mode edit now and an orphaned field forever. The draft itself is untouched, so the
    // rows keep showing what is about to go — nothing disappears from under the operator.
    for (const f of modeCarryOver) if (willClear(f.column)) changed[f.column] = null
    return changed
  }
  const saveEdit = () => {
    const changed = computeChanged()
    if (Object.keys(changed).length === 0) { cancelEdit(); return } // nothing changed → no note needed
    if (!note.trim()) return // a note is required for real edits (the Save button is also disabled)
    update.mutate({ fields: changed, note: note.trim() }, {
      onSuccess: (r) => {
        setEditing(false)
        setNote('')
        const n = (r as { edited?: string[] } | undefined)?.edited?.length ?? Object.keys(changed).length
        toast(`Saved ${n} field(s)`)
      },
      onError: (e) => {
        // Surface the server's specific reason (e.g. "Total Quantity cannot be negative"); request()
        // prefixes it with "API error <status>:" — strip that for a clean inline message.
        const reason = (e instanceof Error ? e.message : '').replace(/^API error \d+:\s*/, '').trim()
        toast.error(reason ? `Save failed — ${reason}` : 'Save failed — please retry')
      },
    })
  }

  // A note is mandatory whenever there are real edits — Save stays blocked until it's written.
  // Hard numeric errors (negative qty, etc.) also block Save (inline error + no 400 round-trip).
  const editedCount = editing ? Object.keys(computeChanged()).length : 0
  // Every gate on every field, not just the numeric ones. Asking `numericFieldWarn` and only for
  // `type === 'number'` left the SCAC / container FORMAT gates with no inline mirror at all, so a
  // malformed container number could only be reported by the backend's 400 after a save round-trip.
  const hasFieldErrors = editing && EDIT_SECTIONS.some((sec) =>
    sec.fields.some((f) => fieldWarn(f.db, draft[f.db]) != null),
  )
  /**
   * Cross-field: an arrival earlier than a departure is impossible — blocks Save too.
   *
   * Structured, not just a message, so the line can sit UNDER the offending date. It used to render
   * once at the foot of a two-column form: "ETA is before ETD" with eight date inputs above it and
   * nothing saying which two. Per-field is also how numeric errors already work here.
   */
  const dateIssues = editing
    ? dateOrderIssues({ etd: draft.etd, atd: draft.atd, eta: draft.eta, ata: draft.ata })
    : []
  /** Every field taking part in a clash — each offending arrival and every departure it precedes. */
  const dateClashFields = new Set<string>(dateIssues.flatMap((i) => [i.arrival, ...i.departures]))
  const dateError = dateIssues[0]?.message ?? null
  const saveBlocked = (editedCount > 0 && !note.trim()) || hasFieldErrors || dateError != null

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate(fromAlerts ? '/alerts' : '/shipments')}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          {fromAlerts ? 'Back to Alerts' : 'Back to Shipments'}
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="field-value font-mono text-2xl font-semibold leading-snug text-text-primary">
              {titleIds.length > 0 ? (
                titleIds.map((x, i) => (
                  <span key={x.label + x.value}>
                    {i > 0 && <span className="mx-2 text-text-muted">·</span>}
                    <span className="text-base font-normal text-text-muted">{x.label} </span>
                    {x.value}
                  </span>
                ))
              ) : (
                <span className="text-text-muted">{shipment.id.slice(0, 8)}</span>
              )}
            </h1>
            <p className="mt-1.5 text-base text-text-secondary">
              {shipment.customer?.name ?? 'Unknown Customer'}
              {shipment.forwarder && ` · ${shipment.forwarder.name}`}
              {shipment.route && ` · ${shipment.route}`}
            </p>
            {/* Hybrid-C E6: multi-booking origin crumb */}
            {shipment.criticReview?.multiBookingOrigin &&
              shipment.criticReview.multiBookingOrigin.total > 1 && (
                <p
                  className="mt-1.5 text-sm text-text-muted"
                  data-testid="multi-booking-origin-crumb"
                >
                  Created from booking row{' '}
                  <span className="font-mono text-text-secondary">
                    {shipment.criticReview.multiBookingOrigin.index}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono text-text-secondary">
                    {shipment.criticReview.multiBookingOrigin.total}
                  </span>
                  {shipment.criticReview.multiBookingOrigin.bookingNo
                    ? (
                        <>
                          {' '}
                          · BK{' '}
                          <span className="font-mono">
                            {shipment.criticReview.multiBookingOrigin.bookingNo}
                          </span>
                        </>
                      )
                    : null}
                </p>
              )}
          </div>
          <Badge variant="status" value={shipment.status} />
        </div>
      </div>

      {/* Review banner — provisional = committed but unconfirmed; fix path is Review Queue */}
      {shipment.reviewStatus === 'provisional' && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-status-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-status-warning">Awaiting Review</p>
            <p className="mt-0.5 text-sm text-text-secondary">
              This shipment is committed but unconfirmed. Resolve issues below, then approve in the review queue.
            </p>
          </div>
          {/* self-center, not items-center on the row: the row must stay items-start so the
              AlertTriangle keeps its mt-0.5 alignment with the "Awaiting Review" title. Centring
              the whole row would drop the icon into the gap between the two text lines. This
              centres only the button against the two-line block — it was sitting ~20px high. */}
          <Link
            to={`/review-queue/${shipment.id}`}
            className="shrink-0 self-center rounded-lg bg-status-warning/20 px-3 py-1.5 text-sm font-medium text-status-warning hover:bg-status-warning/30"
          >
            Review & Approve →
          </Link>
        </div>
      )}

      {/* Needs attention lives ONLY on the Review Queue (ReviewCard) — it is a triage surface, and
          the shipment detail page is for reading and editing the shipment itself. The provisional
          banner above still links through to the focused review view. */}

      {/* Alert banner */}
      {activeAlerts.length > 0 && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-4 py-3',
            topSeverity === 'CRITICAL'
              ? 'border-status-critical/30 bg-status-critical/10 text-status-critical'
              : topSeverity === 'WARNING'
                ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                : 'border-status-info/30 bg-status-info/10 text-status-info'
          )}
        >
          {topSeverity === 'CRITICAL' ? (
            <AlertCircle size={18} className="shrink-0" />
          ) : topSeverity === 'WARNING' ? (
            <AlertTriangle size={18} className="shrink-0" />
          ) : (
            <Info size={18} className="shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {activeAlerts.length === 1
                ? activeAlerts[0].message
                : `${activeAlerts.length} active alerts on this shipment`}
            </p>
            {activeAlerts.length > 1 && (
              <p className="mt-0.5 text-xs opacity-75">
                {[
                  criticalCount > 0 && `${criticalCount} critical`,
                  warningCount > 0 && `${warningCount} warning`,
                  infoCount > 0 && `${infoCount} info`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Horizontal Milestone Timeline (full width) */}
      <Card>
        <h4 className="mb-4 text-base font-semibold text-text-primary">Milestone Timeline</h4>
        {/* No `horizontal` prop: it FORCED the horizontal tracker at every width, so a narrow card
            crushed six stages together no matter the screen. Left to itself the component picks the
            layout from its own container width. */}
        <MilestoneTimeline
          milestones={shipment.milestones ?? []}
          currentStatus={shipment.status}
          mode={shipment.mode}
          etd={shipment.etd}
          atd={shipment.actualDeparture}
          eta={shipment.eta}
          ata={shipment.actualArrival}
          inDcDate={shipment.inDcDate}
          warehouseStartDate={shipment.warehouseStartDate}
        />
      </Card>

      {/* Customer Purchase Orders — full CRUD (add / edit / unlink / delete). */}
      <PurchaseOrdersCard
        shipmentId={id!}
        customerId={shipment.customer?.id ?? null}
        linkedPOs={linkedPOs}
        shipmentQty={shipment.quantityShipped ?? null}
        shipmentQtyUnit={shipment.quantityUnit ?? null}
      />

      {/* A newer email overrode a human edit — prompt to keep the new value or restore the edit. */}
      {(shipment.contestedLocks?.length ?? 0) > 0 && (
        <ContestedLockCard shipmentId={id!} locks={shipment.contestedLocks!} />
      )}

      {/* Order Details (full width) — read-only by default; Edit opens an inline form. */}
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h4 className="text-base font-semibold text-text-primary">Order Details</h4>
          {editing ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={update.isPending}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-50"
              >
                <X size={13} /> Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={update.isPending || saveBlocked}
                title={
                  hasFieldErrors
                    ? 'Fix the highlighted field before saving'
                    : dateError
                      ? dateError
                      : editedCount > 0 && !note.trim()
                        ? 'Add a note for the agent before saving'
                        : undefined
                }
                className="inline-flex items-center gap-1 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={13} /> {update.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
            >
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
              {EDIT_SECTIONS.map((sec) => (
                <DetailSection key={sec.title} title={sec.title} icon={<ClipboardList size={14} className="text-text-muted" />}>
                  {sec.fields.flatMap((f) => {
                      if (!shippingFieldVisible(f.db, draft.mode || shipment.mode, draft[f.db])) return []
                      const offMode = isOffModeField(f.db, draft.mode || shipment.mode)
                      const cur = draft[f.db] ?? ''
                      const fieldErr = fieldWarn(f.db, cur)
                      // Every field in a clash is ringed — each offending arrival AND every departure
                      // it precedes. Any of them could be the wrong value, so ringing one would read
                      // as a verdict about which to change.
                      const inDateClash = dateClashFields.has(f.db)
                      const controlClass = cn(
                        'h-8 w-full rounded-md border bg-surface-700 px-2 text-sm text-text-primary placeholder:text-text-muted/70 focus:outline-none',
                        inDateClash
                          ? 'border-status-critical focus:border-status-critical'
                          : 'border-border focus:border-cobalt-primary',
                      )
                      return [(
                    <div key={f.db} className="grid grid-cols-[7rem_1fr] sm:grid-cols-[9rem_1fr] items-center gap-x-2">
                      {/* An off-mode field only reaches here because it HOLDS a value (see
                          shippingFieldVisible). Say why it is on a form that would otherwise hide
                          it, and give the one-click way to empty it — this is the only screen in
                          the app that can. */}
                      <label htmlFor={`${fieldId}-${f.db}`} className="truncate text-xs text-text-muted">
                        {f.label}
                        {offMode && (
                          <button
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, [f.db]: '' }))}
                            title={offModeHint(draft.mode || shipment.mode)}
                            data-testid={`off-mode-clear-${f.db}`}
                            className="mt-0.5 block text-left text-[11px] font-medium text-status-warning hover:text-status-critical hover:underline"
                          >
                            {isAirMode(draft.mode || shipment.mode) ? 'SEA field' : 'AIR field'} · clear
                          </button>
                        )}
                      </label>
                      {f.picker === 'port' ? (
                        <PortPicker
                          id={`${fieldId}-${f.db}`}
                          value={cur}
                          onChange={(v) => setDraft((d) => ({ ...d, [f.db]: v }))}
                          placeholder="Search ports — UN/LOCODE or name"
                          className={controlClass}
                        />
                      ) : f.picker === 'customer' || f.picker === 'vendor' || f.picker === 'forwarder' ? (
                        <PartyPicker
                          kind={f.picker}
                          id={`${fieldId}-${f.db}`}
                          value={cur}
                          onChange={(v) => setDraft((d) => ({ ...d, [f.db]: v }))}
                          placeholder={`Search ${f.picker}s — code or name`}
                          className={controlClass}
                        />
                      ) : f.options ? (
                        (() => {
                          const optionSet = new Set(f.options as readonly string[])
                          const allValueSet = new Set(
                            (f.allValues ?? f.options ?? []) as readonly string[],
                          )
                          return (
                        <select
                          id={`${fieldId}-${f.db}`}
                          data-testid={`edit-select-${f.db}`}
                          value={cur}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.db]: e.target.value }))}
                          className={controlClass}
                        >
                          <option value="">—</option>
                          {cur && !optionSet.has(cur) && (
                            <option value={cur}>
                              {/* A value outside the offered list but inside the full enum is valid —
                                  only truly unknown junk gets the suffix. (Mode no longer differs:
                                  MODE_EDIT_OPTIONS === MODE_OPTIONS since FCL/LCL was dropped. Other
                                  fields still rely on this narrower-offer-than-vocabulary path.) */}
                              {allValueSet.has(cur) ? cur : `${cur} (unrecognized)`}
                            </option>
                          )}
                          {f.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                          )
                        })()
                      ) : f.type === 'date' ? (
                        /* Shared with the review conflict row + New Shipment modal — see DateTimeField
                           for why this is a date+time PAIR and not a datetime-local input. */
                        <DateTimeField
                          id={`${fieldId}-${f.db}`}
                          showTime={dateColumnHasTime(f.db)}
                          label={f.label}
                          value={cur}
                          onChange={(v) => setDraft((prev) => ({ ...prev, [f.db]: v }))}
                          className={controlClass}
                        />
                      ) : f.type === 'number' ? (
                        <NumberField
                          id={`${fieldId}-${f.db}`}
                          ariaLabel={f.label}
                          value={cur}
                          onChange={(v) => setDraft((d) => ({ ...d, [f.db]: v }))}
                          decimals={f.db !== 'qty'}
                          /* qty's unit is the leg's own UOM (an editable field beside it); weight
                             and measurement carry a fixed one from EDITABLE_FIELDS. */
                          unit={f.db === 'qty' ? draft.qtyUnit || null : fieldUnit(f.db)}
                          error={fieldErr}
                          className={controlClass}
                        />
                      ) : (
                        <TextField
                          id={`${fieldId}-${f.db}`}
                          ariaLabel={f.label}
                          value={cur}
                          onChange={(v) => setDraft((d) => ({ ...d, [f.db]: v }))}
                          error={fieldErr}
                          placeholder={
                            f.db === 'polRaw' || f.db === 'podRaw'
                              ? 'UN/LOCODE or airport (e.g. CNSHA, HKG)'
                              : f.db === 'flightNo'
                                ? 'e.g. CA1398'
                                : undefined
                          }
                          className={controlClass}
                        />
                      )}
                      {/* field errors render inside NumberField / TextField (after blur) — see their docstrings */}
                    </div>
                      ),
                      /*
                        The consequence of the switch, stated where the switch is made — before Save,
                        not after. A mode change invalidates one set of transport fields and requires
                        another, and nothing on this form used to say so, so a leg switched AIR→SEA
                        kept its flight number for good.

                        Ticked by default. Deliberately the opposite of the review desk's default, and
                        the reason matters: on the desk un-taking is free because the email's value is
                        never lost, whereas these values ARE preserved — by the shipment history this
                        page already renders. Clearing is filing, not deletion, and a sea shipment
                        still reporting a flight number is wrong in every downstream consumer.
                      */
                      /* Under the offending date, not at the foot of the form. The operator was
                         being told "ETA is before ETD" with eight date inputs above the line and
                         nothing saying which two. Numeric errors already sit on their own field. */
                      ...dateIssues
                        .filter((i) => i.arrival === f.db)
                        .map((i) => (
                          <p
                            key={`date-order-${i.arrival}`}
                            data-testid="edit-date-error"
                            className="col-span-full flex items-center gap-1.5 pl-[7rem] text-xs text-status-critical sm:pl-[9rem]"
                          >
                            <AlertTriangle size={13} className="shrink-0" />
                            {i.message}
                          </p>
                        )),
                      ...(f.db === 'mode' && modeCarryOver.length > 0
                        ? [(
                            <div
                              key="mode-carry-over"
                              data-testid="mode-carry-over"
                              className="col-span-full rounded-lg border border-status-warning/35 bg-status-warning/[0.06] px-3 py-2.5"
                            >
                              <p className="text-sm font-semibold text-text-primary">
                                Switching <span className="font-mono">{shipment.mode}</span> →{' '}
                                <span className="font-mono">{draft.mode}</span>.{' '}
                                {modeCarryOver.length} stored{' '}
                                {modeCarryOver.length === 1 ? 'field belongs' : 'fields belong'} to the old mode.
                              </p>
                              <div className="mt-2 grid gap-1.5">
                                {modeCarryOver.map((cf) => (
                                  <label key={cf.column} className="flex cursor-pointer items-start gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={willClear(cf.column)}
                                      onChange={() =>
                                        setKeepOnSwitch((k) => ({ ...k, [cf.column]: willClear(cf.column) }))
                                      }
                                      data-testid={`mode-carry-over-${cf.column}`}
                                      aria-label={`Clear ${cf.label} when switching to ${draft.mode}`}
                                      className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-status-critical"
                                    />
                                    <span className="min-w-0 text-text-secondary">
                                      Clear <span className="font-medium text-text-primary">{cf.label}</span>{' '}
                                      <span
                                        className={cn(
                                          'field-value font-mono',
                                          willClear(cf.column) ? 'text-text-muted line-through' : 'text-text-primary',
                                        )}
                                      >
                                        {cf.value}
                                      </span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                              <p className="mt-2 text-xs text-text-muted">
                                Cleared values stay in History — this is filing, not deletion.
                              </p>
                            </div>
                          )]
                        : []),
                      ]
                  })}
                </DetailSection>
              ))}
            </div>
            {/* Required feedback for agent-soul iteration — a save with real edits is blocked without it. */}
            <div className="mt-6 border-t border-border pt-4">
              <label htmlFor={`${fieldId}-note`} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <NotebookPen size={13} className="text-text-muted" />
                Note for the Agent
                {editedCount > 0 && <span className="text-status-warning">· required</span>}
              </label>
              <p className="mb-2 text-xs text-text-muted">
                What did the AI get wrong, and how should it decide next time? Saved to Change History with
                your edit and used to improve extraction.
              </p>
              <textarea
                id={`${fieldId}-note`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Booking No. came off the SO line — use the CW# on the booking confirmation, not the invoice"
                className={cn(
                  'w-full rounded-md border bg-surface-700 p-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none',
                  editedCount > 0 && !note.trim()
                    ? 'border-status-warning/60 focus:border-status-warning'
                    : 'border-border focus:border-cobalt-primary',
                )}
              />
              {editedCount > 0 && !note.trim() && (
                <p className="mt-1 text-xs text-status-warning">
                  Add a note to save your {editedCount} edit{editedCount !== 1 ? 's' : ''}.
                </p>
              )}
            </div>
          </>
        ) : (
        <PendingReviewContext.Provider value={pendingReview}>
        <FieldHistoryContext.Provider value={historyIndex}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {/* Section 1: Order Info */}
          <DetailSection title="Order Info" icon={<ClipboardList size={14} className="text-text-muted" />}>
            {/* Codes only — full Customer/Vendor names live in the page header; Item/Style is on the PO table.
                historyKey = the raw twin: party conflicts and change history live on customerRaw/vendorRaw,
                so the code row is where a pending party question glows (and where its history pops). */}
            <DetailRow historyKey="customerRaw" label="Customer Code" value={shipment.customer?.code ?? null} />
            <DetailRow historyKey="vendorRaw" label="Vendor Code" value={shipment.vendor?.code ?? null} />
            <DetailRow
              historyKey="bookingNo"
              label={fieldLabel('bookingNo')}
              value={shipment.bookingNo}
              hint={
                shipment.bookingNo
                  ? undefined
                  : shipment.hblNumber || shipment.soNumber || shipment.warehouseSo
                    ? 'not stated in this shipment’s email(s)'
                    : 'awaiting the forwarder booking'
              }
            />
            <DetailRow historyKey="soNo" label={fieldLabel('soNo')} value={shipment.soNumber} />
            <DetailRow
              historyKey="warehouseSo"
              label={fieldLabel('warehouseSo')}
              value={shipment.warehouseSo ?? null}
            />
            <DetailRow
              label="Last Email"
              value={lastEmailAt ? formatDate(lastEmailAt) : null}
              hint={lastEmailAt ? undefined : 'no related emails'}
            />
          </DetailSection>

          {/* Section 2: Cargo & Logistics */}
          <DetailSection title="Cargo & Logistics" icon={<Package size={14} className="text-text-muted" />}>
            {/* Grouped for reading, same as the review conflict row. Display only — the edit form
                below seeds from the raw number, and search/CSV keep the ungrouped digits. */}
            <DetailRow
              historyKey="qty"
              label={fieldLabel('qty')}
              value={
                shipment.quantityShipped != null
                  ? formatNumericDisplay(String(shipment.quantityShipped))
                  : null
              }
            />
            <DetailRow historyKey="qtyUnit" label={fieldLabel('qtyUnit')} value={shipment.quantityUnit ?? null} />
            <DetailRow
              historyKey="containerNo"
              label={fieldLabel('containerNo')}
              value={shipment.containerNo}
            />
            <DetailRow historyKey="hblAwbFcrNo" label={houseBillLabel(shipment.mode)} value={shipment.hblNumber} />
            {shippingFieldVisible('mbl', shipment.mode, shipment.mblNumber) && (
              <DetailRow
                historyKey="mbl"
                label={fieldLabel('mbl')}
                value={shipment.mblNumber}
                hint={!shipment.mblNumber && shipment.hblNumber ? 'house B/L — carrier master B/L not shared' : undefined}
              />
            )}
            {shippingFieldVisible('mawb', shipment.mode, shipment.mawb) && (
              <DetailRow historyKey="mawb" label={fieldLabel('mawb')} value={shipment.mawb ?? null}
                offMode={isOffModeField('mawb', shipment.mode) ? offModeHint(shipment.mode) : undefined} />
            )}
            <DetailRow historyKey="scacCode" label={fieldLabel('scacCode')} value={shipment.scacCode} />
          </DetailSection>

          {/* Section 3: Shipping */}
          <DetailSection title="Shipping" icon={<Ship size={14} className="text-text-muted" />}>
            <DetailRow historyKey="mode" label={fieldLabel('mode')} value={shipment.mode} />
            <DetailRow
              historyKey="forwarderRaw"
              label={fieldLabel('forwarderRaw')}
              value={shipment.forwarder?.name ?? shipment.forwarderRaw ?? null}
            />
            <DetailRow historyKey="consigneeName" label={fieldLabel('consigneeName')} value={shipment.consigneeName} />
            <DetailRow historyKey="consigneeAddress" label={fieldLabel('consigneeAddress')} value={shipment.consigneeAddress} />
            {shippingFieldVisible('vesselName', shipment.mode, shipment.vesselName) && (
              <DetailRow historyKey="vesselName" label={fieldLabel('vesselName')} value={shipment.vesselName}
                offMode={isOffModeField('vesselName', shipment.mode) ? offModeHint(shipment.mode) : undefined} />
            )}
            {shippingFieldVisible('voyageNo', shipment.mode, shipment.voyageNumber) && (
              <DetailRow historyKey="voyageNo" label={fieldLabel('voyageNo')} value={shipment.voyageNumber}
                offMode={isOffModeField('voyageNo', shipment.mode) ? offModeHint(shipment.mode) : undefined} />
            )}
            {shippingFieldVisible('flightNo', shipment.mode, shipment.flightNo) && (
              <DetailRow historyKey="flightNo" label={fieldLabel('flightNo')} value={shipment.flightNo ?? null}
                offMode={isOffModeField('flightNo', shipment.mode) ? offModeHint(shipment.mode) : undefined} />
            )}
            <DetailRow historyKey="polRaw" label={fieldLabel('polRaw')} value={shipment.polRaw ?? null} />
            <DetailRow historyKey="podRaw" label={fieldLabel('podRaw')} value={shipment.podRaw ?? null} />
            <DetailRow historyKey="route" label="Route" value={shipment.route} />
            <DetailRow historyKey="originCountry" label="Origin Country" value={shipment.originCountry ?? '—'} />
          </DetailSection>

          {/* Section 4: Key Dates */}
          <DetailSection title="Key Dates" icon={<Calendar size={14} className="text-text-muted" />}>
            <DetailRow historyKey="cargoReadyDate" label={fieldLabel('cargoReadyDate')} value={formatDateMaybeTime(shipment.crd)} />
            <DetailRow historyKey="warehouseStartDate" label={fieldLabel('warehouseStartDate')} value={formatDateMaybeTime(shipment.warehouseStartDate)} />
            <DetailRow historyKey="warehouseEndDate" label={fieldLabel('warehouseEndDate')} value={formatDateMaybeTime(shipment.warehouseEndDate)} />
            <DetailRow historyKey="cfsCutoff" label={fieldLabel('cfsCutoff')} value={formatDateMaybeTime(shipment.cfsCutoff)} />
            <DetailRow historyKey="etd" label={fieldLabel('etd')} value={formatDateMaybeTime(shipment.etd)} />
            <DetailRow historyKey="atd" label={fieldLabel('atd')} value={formatDateMaybeTime(shipment.actualDeparture)} />
            <DetailRow historyKey="eta" label={fieldLabel('eta')} value={formatDateMaybeTime(shipment.eta)} />
            <DetailRow historyKey="ata" label={fieldLabel('ata')} value={formatDateMaybeTime(shipment.actualArrival)} />
            <DetailRow historyKey="inDcDate" label={fieldLabel('inDcDate')} value={formatDateMaybeTime(shipment.inDcDate)} />
          </DetailSection>
        </div>
        </FieldHistoryContext.Provider>
        </PendingReviewContext.Provider>
        )}
      </Card>

      {/* Tab switcher: Alerts/Emails vs History */}
      <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('details')}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'details'
              ? 'bg-cobalt-primary text-white'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          Alerts & Emails
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'history'
              ? 'bg-cobalt-primary text-white'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          <Clock size={12} />
          Change History
          {historyData?.history && historyData.history.length > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/20 px-1 text-[10px]">
              {historyData.history.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'details' ? (
        <>
          {/* Alerts — the nav, /alerts and the dashboard panel all use this one word. */}
          {shipment.alerts && shipment.alerts.some((a) => a.status === 'ACTIVE') && (
            <div className="space-y-2">
              <h4 className="text-base font-semibold text-text-primary">Alerts</h4>
              {shipment.alerts.flatMap((alert) =>
                alert.status !== 'ACTIVE'
                  ? []
                  : [
                      <AlertCard
                        key={alert.id}
                        alert={{
                          ...alert,
                          shipmentId: shipment.id,
                          // Detail alerts omit nested summary server-side; pass parent PO/consignee for header.
                          shipment: {
                            id: shipment.id,
                            poNumbers: shipment.poNumbers,
                            route: shipment.route,
                            consigneeName: shipment.consigneeName ?? null,
                          },
                        }}
                        compact
                      />,
                    ],
              )}
            </div>
          )}

          {/* Related Emails — always shown so orphan links (body wiped) are not invisible */}
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-base font-semibold text-text-primary">
                Related Emails
                {emailTotal > 0 && (
                  <span className="ml-2 text-sm font-normal text-text-muted">({emailTotal})</span>
                )}
              </h4>
              {emailTotal > 0 && (
                <PageSizeSelect
                  value={emailPerPage}
                  onChange={(size) => {
                    setEmailPerPage(size)
                    setEmailPage(1)
                  }}
                />
              )}
            </div>
            {emailTotal === 0 ? (
              <p className="text-sm text-text-muted">No related emails linked to this shipment.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {pageEmails.map((email) => {
                    const openable = email.id != null && !email.bodyMissing
                    const emailKey =
                      email.id ?? `orphan-${email.subject}-${email.receivedAt ?? ''}-${email.sender ?? ''}`
                    return (
                      <div
                        key={emailKey}
                        {...(openable
                          ? interactiveProps(() => {
                              const hl = shipment.criticReview?.multiBookingOrigin?.bookingNo?.trim()
                              const q = new URLSearchParams()
                              if (email.emailType) q.set('type', email.emailType)
                              if (hl) q.set('hl', hl) // Hybrid-C E3: highlight booking token in body
                              const qs = q.toString()
                              window.open(
                                `/email/${email.id}${qs ? `?${qs}` : ''}`,
                                `email_${email.id}`,
                                'popup,width=880,height=940,resizable=yes,scrollbars=yes',
                              )
                            })
                          : {})}
                        className={
                          openable
                            ? 'flex cursor-pointer items-center gap-3 rounded-lg bg-surface-900 p-3 transition-colors hover:bg-surface-700'
                            : 'flex cursor-default items-center gap-3 rounded-lg bg-surface-900/60 p-3 opacity-80'
                        }
                        title={openable ? undefined : 'Email body is not in the store (link only)'}
                      >
                        <Mail size={14} className="shrink-0 text-text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text-primary">{email.subject}</p>
                          <p className="text-xs text-text-muted">
                            {email.bodyMissing || email.id == null ? (
                              'Body not stored — re-ingest to open'
                            ) : (
                              <>
                                {parseSender(email.sender).name} ·{' '}
                                <span className="font-mono">{formatDateTime(email.receivedAt)}</span>
                              </>
                            )}
                          </p>
                        </div>
                        {/* No type tag: the timestamp is what tells you which mail supersedes which, and
                            the classification is overloaded — 'Other' means the agent judged it chatter,
                            OR the model returned nothing, OR a deterministic path never classified it. */}
                      </div>
                    )
                  })}
                </div>
                <Pagination
                  currentPage={safeEmailPage}
                  totalPages={emailTotalPages}
                  totalItems={emailTotal}
                  pageSize={emailPageSize}
                  onPageChange={setEmailPage}
                />
              </>
            )}
          </Card>
        </>
      ) : (
        /* History tab */
        <Card>
          <h4 className="mb-4 text-base font-semibold text-text-primary">Change History</h4>
          <CategorizedShipmentHistory history={historyData?.history ?? []} />
        </Card>
      )}
    </div>
  )
}

function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        {icon}
        {/* Title Case as written, not uppercased in CSS — same rule as the review card's group
            headers, so "Order Info" reads identically on both surfaces. */}
        <span className="text-xs font-semibold text-text-muted">{title}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/**
 * The review-warning icon opens a hover CARD styled exactly like the change-history one (same
 * shell, same portal + grace-close mechanics via useHoverPopover) — a native title tooltip beside
 * a designed card read as two different products (ops 2026-07-24).
 */
function PendingIconPopover({ label, ann }: { label: string; ann: PendingAnnotation }) {
  const { anchorRef, open, coords, openPopover, scheduleClose, clearClose } = useHoverPopover()
  const heading = ann.level === 'miss' ? 'Master Miss' : 'Needs Review'
  const panel =
    open && coords
      ? createPortal(
          <div
            role="region"
            aria-label={`${label} — ${heading}`}
            data-testid="pending-annotation-popover"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              maxHeight: coords.maxHeight,
              transform: coords.placeAbove ? 'translateY(-100%)' : undefined,
              zIndex: 9999,
            }}
            className={HOVER_CARD_CLASS}
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
          >
            <p
              className={cn(
                'mb-2 flex items-center gap-1 text-[11px] font-semibold',
                ann.level === 'miss' ? 'text-status-critical' : 'text-status-warning',
              )}
            >
              <AlertTriangle size={11} className="shrink-0" />
              <span className="min-w-0 truncate">
                {label} — {heading}
              </span>
            </p>
            <div className="divide-y divide-border font-sans">
              {ann.messages.map((m) => (
                <p key={m} className="py-2 text-xs leading-snug text-text-secondary first:pt-0 last:pb-0">
                  {m}
                </p>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null
  return (
    <>
      <span
        ref={anchorRef}
        data-testid={`pending-icon-${ann.level}`}
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
        className="ml-1 inline-flex cursor-help align-baseline"
      >
        <AlertTriangle
          size={12}
          aria-label={ann.level === 'miss' ? 'Master miss' : 'Pending review'}
          className={ann.level === 'miss' ? 'text-status-critical' : 'text-status-warning'}
        />
      </span>
      {panel}
    </>
  )
}

function DetailRow({
  label,
  value,
  hint,
  offMode,
  historyKey,
}: {
  label: string
  value: string | null | undefined
  /** shown next to "(pending)" to explain WHY a value is blank (so a gap reads as expected, not broken) */
  hint?: string
  /**
   * This row holds a value belonging to the OTHER transport mode — a flight number on a sea leg.
   *
   * Distinct from `hint`, which only renders in the empty branch: an off-mode row is by definition
   * NOT empty (an empty one is still hidden), so it needs a marker beside the value itself.
   */
  offMode?: string
  /** Leg column for this field (e.g. 'qty', 'polRaw'). When it has change history the value shows a
   *  clock marker and a hover timeline popover. Omit for untracked rows. */
  historyKey?: string
}) {
  const historyIndex = useContext(FieldHistoryContext)
  const entries = historyKey ? historyForField(historyKey, historyIndex) : []
  const ann = useContext(PendingReviewContext).get(historyKey ?? '')
  // Always what the leg STORES — the same value the review card prints as "Current (on shipment)".
  // The row used to substitute the critic's pre-write snapshot while a review was open, which made
  // this page and the review queue disagree about one field (see pending-review.ts). The amber
  // highlight and the warning icon carry "unresolved"; the value itself stays true.
  const shown = value
  // Amber colour only on a REAL stored value — "(pending)" and the date formatters' 'TBD' are
  // placeholders. The warning icon beside the history clock is the primary cue (2026-07-24):
  // yellow = open review question, red = master miss; hover shows the related message(s).
  const valueNode =
    shown != null && shown !== 'TBD' && ann ? (
      <mark className="review-pending-value">{shown}</mark>
    ) : (
      shown
    )
  const annIcon = ann ? <PendingIconPopover label={label} ann={ann} /> : null
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-3 sm:grid-cols-[10rem_1fr]">
      <span className="truncate text-sm text-text-muted">{label}</span>
      <span className="field-value font-mono text-base leading-snug text-text-primary">
        {shown != null ? (
          entries.length > 0 ? (
            <>
              <FieldHistoryPopover label={label} entries={entries}>
                {valueNode}
              </FieldHistoryPopover>
              {annIcon}
            </>
          ) : (
            <>
              {valueNode}
              {annIcon}
            </>
          )
        ) : (
          <>
            {/* Genuinely empty now — the row no longer hides a stored value behind this placeholder,
                so "(pending)" means the leg holds nothing. Amber only when a review question is open
                against the empty field itself. */}
            <span className={cn('italic', ann ? 'text-status-warning' : 'text-text-muted')}>
              (pending)
              {hint && (
                <span className="ml-1.5 font-sans text-sm not-italic text-text-muted/70">· {hint}</span>
              )}
            </span>
            {annIcon}
          </>
        )}
        {/*
          AFTER the value, never before it.
          Leading with the tag pushed the value out of the column every other row lines up on, so
          Vessel and Voyage sat indented against Forwarder and Flight No. directly above and below
          them. It also read backwards: the value is the row's subject and the tag annotates it,
          which is the order MeshMissTag already uses in ConflictRow.
        */}
        {offMode && shown != null && (
          <span
            data-testid="off-mode-marker"
            title={offMode}
            className="ml-2 whitespace-nowrap rounded bg-status-warning/15 px-1.5 align-[2px] font-sans text-[11px] font-medium leading-4 text-status-warning"
          >
            {offMode}
          </span>
        )}
      </span>
    </div>
  )
}