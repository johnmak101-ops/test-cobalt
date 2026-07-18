import { useId, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useShipment, useUpdateShipment, type ShipmentDetail } from '../hooks/use-shipments'
import { useShipmentHistory } from '../hooks/use-shipment-history'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { MilestoneTimeline } from '../components/shipments/MilestoneTimeline'
import { ShipmentHistoryTimeline } from '../components/shipments/ShipmentHistoryTimeline'
import { AlertCard } from '../components/alerts/AlertCard'
import { formatDate, formatDateTime, formatDateMaybeTime, cn } from '../lib/utils'
import { buildNeedsAttentionGroups, looksLikeLocode } from '../components/review/needs-attention'
import { EDITABLE_FIELDS, fieldLabel, type EditableField } from '../lib/review-fields'
import { toast } from '../components/ui/Toast'
import { ArrowLeft, Mail, Clock, ClipboardList, Package, Ship, Calendar, AlertTriangle, AlertCircle, Info, Pencil, Check, X, NotebookPen } from 'lucide-react'

// The human-editable leg fields, grouped like the read-only card. `db` = the backend column the PATCH writes
// (+ locks + audits); `get` reads the current value off the loaded shipment (whose UI names differ from db).
// Customer / vendor codes are NOT free-text (master links). Mode / POL / POD / forwarderRaw ARE editable
// free-text (#183). PO# / Item·Style stay on the Customer Purchase Orders card, not this form.
type EditType = 'text' | 'number' | 'date'
interface EditField { db: string; label: string; type: EditType; get: (s: ShipmentDetail) => unknown }
/**
 * Derived from EDITABLE_FIELDS, never hand-listed: this modal used to keep its own copy of every
 * label and it drifted from both the read view below it and the review queue's conflict table.
 * PO# / Item·Style are excluded — they live on the Customer Purchase Orders card (per-PO), not here.
 */
const EDIT_SECTIONS: { title: string; fields: EditField[] }[] = (() => {
  const order: EditableField['section'][] = ['Order Info', 'Cargo & Logistics', 'Shipping', 'Key Dates']
  return order.map((title) => ({
    title,
    fields: EDITABLE_FIELDS.filter((f) => f.section === title && f.column !== 'itemStyleNo').map((f) => ({
      db: f.column,
      label: f.label,
      type: f.type,
      get: (s: ShipmentDetail) => {
        // Prefer free-text raw; fall back to resolved master name so edit is not blank when only FK is set.
        if (f.column === 'forwarderRaw') {
          return s.forwarderRaw ?? s.forwarder?.name ?? null
        }
        return (s as unknown as Record<string, unknown>)[f.uiKey]
      },
    })),
  }))
})()
/** A stored value → the string an <input> expects (date → YYYY-MM-DD). */
function toInputValue(v: unknown, type: EditType): string {
  if (v == null || v === '') return ''
  if (type === 'date') { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) }
  return String(v)
}

/** Sea modes show vessel/voyage; air modes show flight. Unknown mode shows all present fields. */
function isAirMode(mode: string | null | undefined): boolean {
  return (mode ?? '').toUpperCase().startsWith('AIR')
}
function isSeaMode(mode: string | null | undefined): boolean {
  return (mode ?? '').toUpperCase().startsWith('SEA')
}
/** Hide sea-only or air-only transport/doc fields based on mode. */
function shippingFieldVisible(dbColumn: string, mode: string | null | undefined): boolean {
  // Sea: vessel + voyage + ocean MBL (not flight/MAWB)
  if (dbColumn === 'vesselName' || dbColumn === 'voyageNo' || dbColumn === 'mbl') {
    if (isAirMode(mode)) return false
    return true
  }
  // Air: flight + MAWB (not vessel/voyage/MBL)
  if (dbColumn === 'flightNo' || dbColumn === 'mawb') {
    if (isSeaMode(mode)) return false
    return true
  }
  return true
}

/** House bill label: HAWB on air, HBL/FCR on sea. */
function houseBillLabel(mode: string | null | undefined): string {
  return isAirMode(mode) ? 'HAWB' : fieldLabel('hblAwbFcrNo')
}

/**
 * Turn the "see conflict table" clause into a Review Queue deep-link.
 * Conflict comparison UI lives on ReviewCard, not shipment detail.
 */
function AttentionTextWithConflictLink({ text, expandId }: { text: string; expandId: string }) {
  const m = text.match(/^(.*?)(see conflict table)(.*)$/i)
  if (!m) return <>{text}</>
  return (
    <>
      {m[1]}
      <Link
        to="/review-queue"
        state={{ expandId }}
        className="font-medium text-cobalt-primary underline-offset-2 hover:underline"
        data-testid="conflict-table-link"
      >
        {m[2]}
      </Link>
      {m[3]}
    </>
  )
}

export default function ShipmentDetailPage() {
  const fieldId = useId()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const fromAlerts = (location.state as { fromAlerts?: boolean })?.fromAlerts
  const { data: shipment, isLoading } = useShipment(id!)
  const { data: historyData } = useShipmentHistory(id!)
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')
  const update = useUpdateShipment(id!)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

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
      .map((e) => e.receivedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  // Title from MEANINGFUL identifiers — booking no / SO no (then a PO), never the opaque UUID.
  // Display copy: "Booking ID" (not BK chip) — review/editor fields keep "Booking No." (#126).
  // #151: multi-leg bookings show "B123 · Leg 1/2" in the Booking ID value.
  const bookingTitleValue =
    shipment.bookingNo &&
    ((shipment.legCount ?? 1) > 1
      ? `${shipment.bookingNo} · Leg ${shipment.legNo ?? 1}/${shipment.legCount}`
      : shipment.bookingNo)
  const titleIds = [
    bookingTitleValue && { label: 'Booking ID', value: bookingTitleValue },
    shipment.soNumber && { label: 'SO', value: shipment.soNumber },
  ].filter(Boolean) as { label: string; value: string }[]
  if (titleIds.length === 0 && linkedPOs[0]) titleIds.push({ label: 'PO', value: linkedPOs[0].poNumber })
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
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setNote('')
  }
  // draft vs the saved shipment — computed on every render so the Save gate reacts to edits live.
  const computeChanged = (): Record<string, unknown> => {
    const changed: Record<string, unknown> = {}
    for (const sec of EDIT_SECTIONS) for (const f of sec.fields) {
      const orig = toInputValue(f.get(shipment), f.type)
      const next = draft[f.db] ?? ''
      if (next !== orig) changed[f.db] = next === '' ? null : next
    }
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
        toast(reason ? `Save failed — ${reason}` : 'Save failed — please retry')
      },
    })
  }

  // A note is mandatory whenever there are real edits — Save stays blocked until it's written.
  const editedCount = editing ? Object.keys(computeChanged()).length : 0
  const saveBlocked = editedCount > 0 && !note.trim()

  // Collapsed Needs attention groups (same builder as ReviewCard) — show for any shipment with items.
  // Conflict table lives on Review Queue (ReviewCard), not here — so we pass conflictsCount for
  // suppress-on-card semantics, then re-surface a linked CTA when fieldConflicts exist.
  const fieldConflictCount = shipment.fieldConflicts?.length ?? 0
  const attentionGroups = buildNeedsAttentionGroups({
    reviewReasons: shipment.reviewReasons ?? [],
    riskFlags: shipment.criticReview?.riskFlags ?? [],
    conflictsCount: fieldConflictCount,
    // LOCODE on polRaw/podRaw ⇒ auto-matched — hide country/city port-miss noise (VIETNAM, HCMC)
    portsLinked: {
      pol: looksLikeLocode(shipment.polRaw),
      pod: looksLikeLocode(shipment.podRaw),
    },
  })
  const reviewQueueState = { expandId: shipment.id }
  const showConflictTableCta = fieldConflictCount > 0
  const showNeedsAttention = attentionGroups.length > 0 || showConflictTableCta

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
            <h1 className="font-mono text-xl font-semibold text-text-primary break-words">
              {titleIds.length > 0 ? (
                titleIds.map((x, i) => (
                  <span key={x.label + x.value}>
                    {i > 0 && <span className="mx-2 text-text-muted">·</span>}
                    <span className="text-sm font-normal text-text-muted">{x.label} </span>
                    {x.value}
                  </span>
                ))
              ) : (
                <span className="text-text-muted">{shipment.id.slice(0, 8)}</span>
              )}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {shipment.customer?.name ?? 'Unknown Customer'}
              {shipment.forwarder && ` · ${shipment.forwarder.name}`}
              {shipment.route && ` · ${shipment.route}`}
            </p>
          </div>
          <Badge variant="status" value={shipment.status} />
        </div>
      </div>

      {/* Review banner — provisional = committed but unconfirmed; fix path is Review Queue */}
      {shipment.reviewStatus === 'provisional' && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-status-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-status-warning">Awaiting Review</p>
            <p className="mt-0.5 text-xs text-text-secondary">
              This shipment is committed but unconfirmed. Resolve issues below, then approve in the review queue.
            </p>
          </div>
          <Link
            to="/review-queue"
            state={{ expandId: shipment.id }}
            className="shrink-0 rounded-lg bg-status-warning/20 px-3 py-1.5 text-xs font-medium text-status-warning hover:bg-status-warning/30"
          >
            Review & approve →
          </Link>
        </div>
      )}

      {/* Needs attention — grouped/collapsed (same as ReviewCard); not limited to provisional.
          "see conflict table" links to Review Queue with expandId (table is on the review card). */}
      {showNeedsAttention && (
        <div
          className="rounded-xl border border-border bg-surface-900/40 px-4 py-3"
          data-testid="needs-attention-detail"
        >
          <p className="text-sm font-medium text-text-primary">Needs attention</p>
          <div className="mt-2 space-y-3">
            {showConflictTableCta && (
              <div data-testid="needs-group-fields_disagree-cta">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Fields disagree</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-text-secondary">
                  <li>
                    {fieldConflictCount} field(s) disagree —{' '}
                    <Link
                      to="/review-queue"
                      state={reviewQueueState}
                      className="font-medium text-cobalt-primary underline-offset-2 hover:underline"
                      data-testid="conflict-table-link"
                    >
                      see conflict table
                    </Link>
                  </li>
                </ul>
              </div>
            )}
            {attentionGroups.map((g) => (
              <div key={g.groupId}>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{g.title}</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-text-secondary">
                  {g.items.map((it) => (
                    <li
                      key={it.lineId}
                      title={[it.key, ...(it.evidence ?? [])].filter(Boolean).join('\n')}
                    >
                      <AttentionTextWithConflictLink text={it.text} expandId={shipment.id} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <h4 className="mb-4 text-sm font-semibold text-text-primary">Milestone Timeline</h4>
        <MilestoneTimeline
          milestones={shipment.milestones ?? []}
          currentStatus={shipment.status}
          horizontal
          mode={shipment.mode}
          etd={shipment.etd}
          atd={shipment.actualDeparture}
          eta={shipment.eta}
          ata={shipment.actualArrival}
          inDcDate={shipment.inDcDate}
          warehouseStartDate={shipment.warehouseStartDate}
        />
      </Card>

      {/* Linked POs card — PO# + style/item are the useful columns; shipment cargo total lives under Order Details → Qty. */}
      {linkedPOs.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-text-muted" />
              <h4 className="text-sm font-semibold text-text-primary">
                Customer Purchase Orders
                <span className="ml-2 text-xs font-normal text-text-muted">
                  {linkedPOs.length} PO{linkedPOs.length !== 1 ? 's' : ''} on this shipment
                </span>
              </h4>
            </div>
            {/* Most bookings only have a shipment carton total, not a per-PO split — show it once, quietly. */}
            {(linkedPOs[0]?.sharedBroadcastTotal != null || shipment.quantityShipped != null) && (
              <p className="text-xs text-text-muted">
                Shipment total:{' '}
                <span className="font-medium text-text-secondary">
                  {linkedPOs[0]?.sharedBroadcastTotal ?? shipment.quantityShipped}
                  {(linkedPOs[0]?.sharedBroadcastUnit ?? shipment.quantityUnit)
                    ? ` ${linkedPOs[0]?.sharedBroadcastUnit ?? shipment.quantityUnit}`
                    : ''}
                </span>
              </p>
            )}
          </div>
          <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
            <table className="w-full min-w-[20rem]">
              <thead>
                <tr className="border-b border-border bg-surface-900/50">
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-text-muted">Customer PO#</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-text-muted">Item / Style</th>
                </tr>
              </thead>
              <tbody>
                {linkedPOs.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => navigate(`/purchase-orders/${po.id}`, { state: { fromShipment: id } })}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700"
                  >
                    <td className="px-3 py-2 font-mono text-sm text-cobalt-primary-light">{po.poNumber}</td>
                    <td className="px-3 py-2 font-mono text-sm text-text-secondary">
                      {po.itemStyleNo?.trim() ? po.itemStyleNo : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Order Details (full width) — read-only by default; Edit opens an inline form (human edits win) */}
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-text-primary">Order Details</h4>
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
                title={saveBlocked ? 'Add a note for the agent before saving' : undefined}
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
            <p className="mb-3 text-xs text-text-muted">
              Fill anything the AI missed. Your edits are kept and will not be overwritten by future emails;
              every change is logged in Change History.
            </p>
            <div
              className="mb-4 rounded-lg border border-border bg-surface-900/50 px-3 py-2.5 text-xs text-text-muted"
              data-testid="edit-scope-note"
            >
              <p className="font-medium text-text-secondary">What this form covers</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                <li>
                  <span className="text-text-secondary">Here:</span> booking/SO, cargo,{' '}
                  <span className="text-text-secondary">mode / POL / POD / forwarder</span> (free text),
                  consignee, vessel/voyage, key dates.
                </li>
                <li>
                  <span className="text-text-secondary">Not free-text here:</span> customer and vendor codes
                  (master links — shown read-only above).
                </li>
                <li>
                  <span className="text-text-secondary">POs and item/style:</span> edit on the{' '}
                  <span className="text-text-secondary">Customer Purchase Orders</span> card above this section.
                </li>
              </ul>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
              {EDIT_SECTIONS.map((sec) => (
                <DetailSection key={sec.title} title={sec.title} icon={<ClipboardList size={14} className="text-text-muted" />}>
                  {sec.fields
                    .filter((f) => shippingFieldVisible(f.db, draft.mode || shipment.mode))
                    .map((f) => (
                    <div key={f.db} className="grid grid-cols-[7rem_1fr] sm:grid-cols-[9rem_1fr] items-center gap-x-2">
                      <label htmlFor={`${fieldId}-${f.db}`} className="truncate text-xs text-text-muted">{f.label}</label>
                      <input
                        id={`${fieldId}-${f.db}`}
                        type={f.type}
                        min={f.type === 'number' ? 0 : undefined}
                        step={f.db === 'qty' ? 1 : f.type === 'number' ? 'any' : undefined}
                        value={draft[f.db] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.db]: e.target.value }))}
                        placeholder={
                          f.db === 'mode'
                            ? 'AIR, SEA_FCL, SEA_LCL…'
                            : f.db === 'polRaw' || f.db === 'podRaw'
                              ? 'UN/LOCODE or airport (e.g. CNSHA, HKG)'
                              : f.db === 'flightNo'
                                ? 'e.g. CA1398'
                                : undefined
                        }
                        className="h-8 w-full rounded-md border border-border bg-surface-700 px-2 text-sm text-text-primary placeholder:text-text-muted/70 focus:border-cobalt-primary focus:outline-none"
                      />
                    </div>
                  ))}
                </DetailSection>
              ))}
            </div>
            {/* Required feedback for agent-soul iteration — a save with real edits is blocked without it. */}
            <div className="mt-6 border-t border-border pt-4">
              <label htmlFor={`${fieldId}-note`} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <NotebookPen size={13} className="text-text-muted" />
                Note for the agent
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
                  saveBlocked ? 'border-status-warning/60 focus:border-status-warning' : 'border-border focus:border-cobalt-primary',
                )}
              />
              {saveBlocked && (
                <p className="mt-1 text-xs text-status-warning">
                  Add a note to save your {editedCount} edit{editedCount !== 1 ? 's' : ''}.
                </p>
              )}
            </div>
          </>
        ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {/* Section 1: Order Info */}
          <DetailSection title="Order Info" icon={<ClipboardList size={14} className="text-text-muted" />}>
            <DetailRow label="Customer Code" value={shipment.customer?.code ?? null} />
            <DetailRow label="Vendor Code" value={shipment.vendor?.code ?? null} />
            <DetailRow
              label={fieldLabel('bookingNo')}
              value={shipment.bookingNo}
              hint={
                shipment.bookingNo
                  ? undefined
                  : shipment.hblNumber || shipment.soNumber
                    ? 'not stated in this shipment’s email(s)'
                    : 'awaiting the forwarder booking'
              }
            />
            <DetailRow
              label={fieldLabel('soNo')}
              value={shipment.soNumber}
              hint={
                shipment.soNumber
                  ? undefined
                  : shipment.status === 'CANCELLED'
                    ? 'cancelled before an SO was issued'
                    : 'assigned once the booking is confirmed'
              }
            />
            <DetailRow
              label="Last Email"
              value={lastEmailAt ? formatDate(lastEmailAt) : null}
              hint={lastEmailAt ? undefined : 'no related emails'}
            />
          </DetailSection>

          {/* Section 2: Cargo & Logistics */}
          <DetailSection title="Cargo & Logistics" icon={<Package size={14} className="text-text-muted" />}>
            <DetailRow label={fieldLabel('qty')} value={shipment.quantityShipped != null ? String(shipment.quantityShipped) : null} />
            <DetailRow label={fieldLabel('qtyUnit')} value={shipment.quantityUnit ?? null} />
            <DetailRow label={fieldLabel('grossWeight')} value={shipment.grossWeight != null ? `${shipment.grossWeight} KGS` : null} />
            <DetailRow label={fieldLabel('measurement')} value={shipment.measurement != null ? `${shipment.measurement} CBM` : null} />
            <DetailRow label={fieldLabel('htsCode')} value={shipment.htsCode?.replace(/,/g, ', ') ?? null} />
            <DetailRow
              label={fieldLabel('containerNo')}
              value={shipment.containerNo}
              hint={shipment.containerNo ? undefined : 'assigned at loading (Draft/Final B/L stage)'}
            />
            <DetailRow label={houseBillLabel(shipment.mode)} value={shipment.hblNumber} />
            {shippingFieldVisible('mbl', shipment.mode) && (
              <DetailRow
                label={fieldLabel('mbl')}
                value={shipment.mblNumber}
                hint={!shipment.mblNumber && shipment.hblNumber ? 'house B/L — carrier master B/L not shared' : undefined}
              />
            )}
            {shippingFieldVisible('mawb', shipment.mode) && (
              <DetailRow label={fieldLabel('mawb')} value={shipment.mawb ?? null} />
            )}
            <DetailRow label={fieldLabel('scacCode')} value={shipment.scacCode} />
          </DetailSection>

          {/* Section 3: Shipping */}
          <DetailSection title="Shipping" icon={<Ship size={14} className="text-text-muted" />}>
            <DetailRow label={fieldLabel('mode')} value={shipment.mode} />
            <DetailRow
              label={fieldLabel('forwarderRaw')}
              value={shipment.forwarder?.name ?? shipment.forwarderRaw ?? null}
            />
            <DetailRow label={fieldLabel('consigneeName')} value={shipment.consigneeName} />
            <DetailRow label={fieldLabel('consigneeAddress')} value={shipment.consigneeAddress} />
            {shippingFieldVisible('vesselName', shipment.mode) && (
              <DetailRow label={fieldLabel('vesselName')} value={shipment.vesselName} />
            )}
            {shippingFieldVisible('voyageNo', shipment.mode) && (
              <DetailRow label={fieldLabel('voyageNo')} value={shipment.voyageNumber} />
            )}
            {shippingFieldVisible('flightNo', shipment.mode) && (
              <DetailRow label={fieldLabel('flightNo')} value={shipment.flightNo ?? null} />
            )}
            <DetailRow label={fieldLabel('polRaw')} value={shipment.polRaw ?? null} />
            <DetailRow label={fieldLabel('podRaw')} value={shipment.podRaw ?? null} />
            <DetailRow label="Route" value={shipment.route} />
            <DetailRow label="Origin Country" value={shipment.originCountry ?? '—'} />
          </DetailSection>

          {/* Section 4: Key Dates */}
          <DetailSection title="Key Dates" icon={<Calendar size={14} className="text-text-muted" />}>
            <DetailRow label={fieldLabel('cargoReadyDate')} value={formatDateMaybeTime(shipment.crd)} />
            <DetailRow label={fieldLabel('warehouseStartDate')} value={formatDateMaybeTime(shipment.warehouseStartDate)} />
            <DetailRow label={fieldLabel('warehouseEndDate')} value={formatDateMaybeTime(shipment.warehouseEndDate)} />
            <DetailRow label={fieldLabel('cfsCutoff')} value={formatDateMaybeTime(shipment.cfsCutoff)} />
            <DetailRow label={fieldLabel('etd')} value={formatDateMaybeTime(shipment.etd)} />
            <DetailRow label={fieldLabel('atd')} value={formatDateMaybeTime(shipment.actualDeparture)} />
            <DetailRow label={fieldLabel('eta')} value={formatDateMaybeTime(shipment.eta)} />
            <DetailRow label={fieldLabel('ata')} value={formatDateMaybeTime(shipment.actualArrival)} />
            <DetailRow label={fieldLabel('inDcDate')} value={formatDateMaybeTime(shipment.inDcDate)} />
          </DetailSection>
        </div>
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
          {/* Active Alerts */}
          {shipment.alerts && shipment.alerts.filter((a) => a.status === 'ACTIVE').length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-text-primary">Active Alerts</h4>
              {shipment.alerts
                .filter((a) => a.status === 'ACTIVE')
                .map((alert) => (
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
                  />
                ))}
            </div>
          )}

          {/* Related Emails — always shown so orphan links (body wiped) are not invisible */}
          <Card>
            <h4 className="mb-4 text-sm font-semibold text-text-primary">Related Emails</h4>
            {(shipment.emails ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">No related emails linked to this shipment.</p>
            ) : (
              <div className="space-y-2">
                {(shipment.emails ?? []).map((email, i) => {
                  const openable = email.id != null && !email.bodyMissing
                  return (
                    <div
                      key={email.id ?? `orphan-${i}`}
                      onClick={
                        openable
                          ? () =>
                              window.open(
                                `/email/${email.id}?type=${encodeURIComponent(email.emailType ?? '')}`,
                                `email_${email.id}`,
                                'popup,width=880,height=940,resizable=yes,scrollbars=yes',
                              )
                          : undefined
                      }
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
                          {email.bodyMissing || email.id == null
                            ? 'Body not stored — re-ingest to open'
                            : (
                                <>
                                  {email.sender} ·{' '}
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
            )}
          </Card>
        </>
      ) : (
        /* History tab */
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-text-primary">Change History</h4>
          <ShipmentHistoryTimeline history={historyData?.history ?? []} />
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
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string | null | undefined
  /** shown next to "(pending)" to explain WHY a value is blank (so a gap reads as expected, not broken) */
  hint?: string
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] sm:grid-cols-[9rem_1fr] gap-x-2 items-baseline">
      <span className="text-xs text-text-muted truncate">{label}</span>
      <span className="font-mono text-sm text-text-primary break-words min-w-0">
        {value ?? (
          <span className="italic text-text-muted">
            (pending)
            {hint && <span className="ml-1.5 font-sans text-xs not-italic text-text-muted/70">· {hint}</span>}
          </span>
        )}
      </span>
    </div>
  )
}