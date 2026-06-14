import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { useReviewQueue, useConfirmReview, useCorrectReview, type ReviewItem } from '../hooks/use-review'
import { useShipment } from '../hooks/use-shipments'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'
import { ConflictReason } from '../components/ConflictReason'
import { ViewOriginalModal } from '../components/ViewOriginalModal'
import { modeLabel, stateLabel, formatDate } from '../lib/utils'

const EDITABLE: { key: keyof ReviewItem; label: string; type?: 'date' | 'number' }[] = [
  { key: 'soNo', label: 'SO #' },
  { key: 'bookingNo', label: 'Booking #' },
  { key: 'hblAwbFcrNo', label: 'HBL / AWB' },
  { key: 'mbl', label: 'MBL' },
  { key: 'containerNo', label: 'Container' },
  { key: 'consigneeName', label: 'Consignee' },
  { key: 'cargoReadyDate', label: 'Cargo ready', type: 'date' },
  { key: 'warehouseStartDate', label: 'Warehouse in', type: 'date' },
  { key: 'warehouseEndDate', label: 'Warehouse cut-off', type: 'date' },
  { key: 'etd', label: 'ETD', type: 'date' },
  { key: 'atd', label: 'ATD', type: 'date' },
  { key: 'eta', label: 'ETA', type: 'date' },
  { key: 'qty', label: 'Qty', type: 'number' },
]

const MS_LABELS: Record<string, string> = {
  BOOKING_SENT: 'Booking', SO_RECEIVED: 'SO', AT_WAREHOUSE: 'At warehouse', DRAFT_BL_RECEIVED: 'Draft B/L',
  FINAL_BL_RECEIVED: 'Final B/L', TELEX_RELEASED: 'Telex', INVOICE_RECEIVED: 'Invoice', DELIVERED: 'Delivered',
}

interface Milestone {
  emailMessageId?: string | null
  milestoneType: string
  occurredAt: string
  senderType?: string | null
}

const toInput = (v: unknown, type?: string) => (v == null ? '' : type === 'date' ? String(v).slice(0, 10) : String(v))
const confColor = (c: number | null) =>
  c == null ? 'text-text-muted' : c < 40 ? 'text-status-critical' : c < 70 ? 'text-status-warning' : 'text-status-success'

export default function ReviewDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: items = [], isLoading } = useReviewQueue()
  const { data: ship } = useShipment(id)
  const confirm = useConfirmReview()
  const correct = useCorrectReview()
  const it = items.find((x) => x.id === id)

  const [vals, setVals] = useState<Record<string, string> | null>(null)
  const [reason, setReason] = useState('')
  const [openEmail, setOpenEmail] = useState<string | null>(null)

  const back = (
    <Link to="/review-queue" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
      <ArrowLeft size={14} /> Review queue
    </Link>
  )

  if (user?.role === 'VIEWER') return <Card><div className="muted">Editors only.</div></Card>
  if (isLoading) return <div className="text-sm text-text-muted">Loading…</div>
  if (!it) {
    return (
      <div className="space-y-4">
        {back}
        <Card><div className="muted">This shipment is no longer awaiting review (confirmed, or not found).</div></Card>
      </div>
    )
  }

  const initial = Object.fromEntries(EDITABLE.map((f) => [f.key, toInput(it[f.key], f.type)])) as Record<string, string>
  const form = vals ?? initial
  const setF = (k: string, v: string) => setVals({ ...(vals ?? initial), [k]: v })
  const dirty = EDITABLE.some((f) => (form[f.key] ?? '') !== (initial[f.key] ?? ''))

  const save = () => {
    const fields: Record<string, unknown> = {}
    for (const f of EDITABLE) {
      const cur = form[f.key] ?? ''
      if (cur !== (initial[f.key] ?? '')) fields[f.key] = cur === '' ? null : cur
    }
    if (!Object.keys(fields).length) return
    correct.mutate({ id: it.id, fields, reason }, { onSuccess: () => navigate('/review-queue') })
  }
  const confirmAsIs = () => confirm.mutate(it.id, { onSuccess: () => navigate('/review-queue') })

  const conflicts = [...new Set(it.reviewReasons ?? [])]

  // distinct source emails, from the leg's milestones (each carries the source emailMessageId)
  const milestones = ((ship as { milestones?: Milestone[] } | undefined)?.milestones ?? []) as Milestone[]
  const seen = new Set<string>()
  const sourceEmails = milestones.flatMap((m) => {
    if (!m.emailMessageId || seen.has(m.emailMessageId)) return []
    seen.add(m.emailMessageId)
    const label = m.emailMessageId.startsWith('mock:') ? m.emailMessageId.slice(5) : m.emailMessageId
    return [{ id: m.emailMessageId, label, type: m.milestoneType, at: m.occurredAt, sender: m.senderType ?? null }]
  })

  return (
    <div className="space-y-6">
      {back}

      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/bookings/${it.bookingId}`} className="link font-mono text-xl font-bold">
          {it.jobNo ?? it.id.slice(0, 8)}
        </Link>
        <span className={`text-sm font-semibold ${confColor(it.confidence)}`}>conf {it.confidence ?? '—'}</span>
        <span className="text-sm text-text-secondary">
          {it.mode ? `${modeLabel(it.mode)} · ` : ''}
          {stateLabel(it.state)}
        </span>
      </div>

      {conflicts.length ? (
        <Card>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Flagged conflicts ({conflicts.length})
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-status-warning">
            {conflicts.map((r, i) => (
              <li key={i}><ConflictReason reason={r} /></li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sourceEmails.length ? (
        <Card>
          <h2 className="mb-1 font-semibold">Source emails</h2>
          <p className="mb-3 text-xs text-text-muted">The emails this shipment was built from — open one to confirm a value against the original.</p>
          <ul className="divide-y divide-border/50">
            {sourceEmails.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-text-primary" title={e.label}>{e.label}</div>
                  <div className="text-xs text-text-muted">
                    {MS_LABELS[e.type] ?? e.type} · {formatDate(e.at)}{e.sender ? ` · ${e.sender}` : ''}
                  </div>
                </div>
                <button onClick={() => setOpenEmail(e.id)} className="btn btn-ghost shrink-0 inline-flex items-center gap-1">
                  <Mail size={13} /> View
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 font-semibold">Correct fields</h2>
        <p className="mb-4 text-xs text-text-muted">
          Edits lock each field (human-wins) so the agent can't overwrite them, and are recorded in the audit log with your note.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {EDITABLE.map((f) => (
            <label key={f.key} className="space-y-1">
              <span className="text-xs text-text-muted">{f.label}</span>
              <input
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                value={form[f.key] ?? ''}
                onChange={(e) => setF(f.key, e.target.value)}
                className="input w-full"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          <input
            placeholder="Note / reason (recorded in the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input w-full"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={!dirty || correct.isPending} className="btn btn-success">
              Save corrections &amp; confirm
            </button>
            <button onClick={confirmAsIs} disabled={confirm.isPending} className="btn btn-primary">
              Confirm as-is
            </button>
            {correct.isError && <span className="text-sm text-status-critical">Could not save — check the values.</span>}
          </div>
        </div>
      </Card>

      {openEmail && <ViewOriginalModal messageId={openEmail} onClose={() => setOpenEmail(null)} />}
    </div>
  )
}
