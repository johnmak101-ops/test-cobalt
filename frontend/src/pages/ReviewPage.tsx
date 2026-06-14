import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useReviewQueue, useConfirmReview, useCorrectReview, type ReviewItem } from '../hooks/use-review'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'

const EDITABLE: { key: keyof ReviewItem; label: string; date?: boolean }[] = [
  { key: 'soNo', label: 'SO #' },
  { key: 'bookingNo', label: 'Booking #' },
  { key: 'hblAwbFcrNo', label: 'HBL/AWB' },
  { key: 'mbl', label: 'MBL' },
  { key: 'containerNo', label: 'Container' },
  { key: 'etd', label: 'ETD', date: true },
  { key: 'eta', label: 'ETA', date: true },
  { key: 'qty', label: 'Qty' },
]

const fmt = (v: unknown, date?: boolean) => (v == null ? '' : date ? String(v).slice(0, 10) : String(v))
const confColor = (c: number | null) =>
  c == null ? 'text-text-muted' : c < 40 ? 'text-status-critical' : c < 70 ? 'text-status-warning' : 'text-status-success'

export default function ReviewPage() {
  const { user } = useAuth()
  const { data: items = [] } = useReviewQueue()
  const confirm = useConfirmReview()
  const correct = useCorrectReview()
  const [editing, setEditing] = useState<string | null>(null)

  if (user?.role === 'VIEWER') {
    return (
      <Card>
        <div className="text-sm text-text-muted">Editors only.</div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Review queue</h1>
        <p className="text-sm text-text-muted">
          Low-confidence shipments held for human review. Confirm as-is, or correct fields — your edits lock so the
          agent can't overwrite them.
        </p>
      </div>

      {!items.length && (
        <Card>
          <div className="text-sm text-text-muted">Nothing to review — every shipment is confirmed. 🎉</div>
        </Card>
      )}

      {items.map((it) => (
        <Card key={it.id} padding={false}>
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-3">
                <Link to={`/bookings/${it.bookingId}`} className="font-mono text-sm text-cobalt-primary hover:underline">
                  {it.jobNo ?? it.id.slice(0, 8)}
                </Link>
                <span className={`text-sm font-semibold ${confColor(it.confidence)}`}>conf {it.confidence ?? '—'}</span>
                <span className="text-xs text-text-muted">
                  {it.mode ?? ''} {it.mode ? '· ' : ''}
                  {it.state}
                </span>
              </div>
              <div className="truncate text-xs text-text-secondary">
                {it.soNo && <>SO {it.soNo} · </>}
                {it.bookingNo && <>BK {it.bookingNo} · </>}
                {it.hblAwbFcrNo && <>HBL {it.hblAwbFcrNo} · </>}
                PO {it.pos.join(', ') || '—'}
              </div>
              {it.reviewReasons?.length ? (
                <ul className="mt-1 list-inside list-disc text-xs text-status-warning">
                  {it.reviewReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setEditing(editing === it.id ? null : it.id)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
              >
                {editing === it.id ? 'Cancel' : 'Correct'}
              </button>
              <button
                onClick={() => confirm.mutate(it.id)}
                disabled={confirm.isPending}
                className="rounded-lg bg-cobalt-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
          {editing === it.id && <CorrectForm item={it} correct={correct} onDone={() => setEditing(null)} />}
        </Card>
      ))}
    </div>
  )
}

function CorrectForm({
  item,
  correct,
  onDone,
}: {
  item: ReviewItem
  correct: ReturnType<typeof useCorrectReview>
  onDone: () => void
}) {
  const initial = Object.fromEntries(EDITABLE.map((f) => [f.key, fmt(item[f.key], f.date)])) as Record<string, string>
  const [vals, setVals] = useState<Record<string, string>>(initial)
  const [reason, setReason] = useState('')
  const input =
    'rounded-lg border border-border bg-surface-800 px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-cobalt-primary'

  const submit = () => {
    const fields: Record<string, unknown> = {}
    for (const f of EDITABLE) {
      const cur = vals[f.key] ?? ''
      if (cur !== (initial[f.key] ?? '')) fields[f.key] = cur === '' ? null : cur
    }
    if (!Object.keys(fields).length) return onDone()
    correct.mutate({ id: item.id, fields, reason }, { onSuccess: onDone })
  }

  return (
    <div className="border-t border-border bg-surface-900/60 px-5 py-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {EDITABLE.map((f) => (
          <label key={f.key} className="space-y-1">
            <span className="text-xs text-text-muted">{f.label}</span>
            <input
              type={f.date ? 'date' : 'text'}
              value={vals[f.key] ?? ''}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              className={`${input} w-full`}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input
          placeholder="Reason (recorded in the audit log)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${input} flex-1`}
        />
        <button
          onClick={submit}
          disabled={correct.isPending}
          className="shrink-0 rounded-lg bg-status-success px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save &amp; confirm
        </button>
      </div>
    </div>
  )
}
