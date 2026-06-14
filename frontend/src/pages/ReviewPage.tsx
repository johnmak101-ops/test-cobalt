import { Link } from 'react-router-dom'
import { useReviewQueue } from '../hooks/use-review'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'
import { modeLabel, stateLabel } from '../lib/utils'

const confColor = (c: number | null) =>
  c == null ? 'text-text-muted' : c < 40 ? 'text-status-critical' : c < 70 ? 'text-status-warning' : 'text-status-success'

export default function ReviewPage() {
  const { user } = useAuth()
  const { data: items = [] } = useReviewQueue()

  if (user?.role === 'VIEWER') {
    return (
      <Card>
        <div className="muted">Editors only.</div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Review queue</h1>
        <p className="muted">Low-confidence shipments held for review. Click one to confirm it or correct the flagged fields.</p>
      </div>

      {!items.length ? (
        <Card>
          <div className="muted">No shipments are awaiting review — all are confirmed.</div>
        </Card>
      ) : (
        <Card padding={false}>
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const n = new Set(it.reviewReasons ?? []).size
              return (
                <li key={it.id}>
                  <Link
                    to={`/review-queue/${it.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-surface-700"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-cobalt-primary-light">{it.jobNo ?? it.id.slice(0, 8)}</span>
                        <span className={`text-xs font-semibold ${confColor(it.confidence)}`}>conf {it.confidence ?? '—'}</span>
                        <span className="text-xs text-text-muted">
                          {it.mode ? `${modeLabel(it.mode)} · ` : ''}
                          {stateLabel(it.state)}
                        </span>
                      </div>
                      <div className="truncate text-xs text-text-secondary">
                        {it.soNo && <>SO {it.soNo} · </>}
                        {it.bookingNo && <>BK {it.bookingNo} · </>}
                        {it.hblAwbFcrNo && <>HBL {it.hblAwbFcrNo} · </>}
                        PO {it.pos.join(', ') || '—'}
                      </div>
                    </div>
                    {n > 0 && (
                      <span className="shrink-0 rounded-full bg-status-warning/15 px-2.5 py-0.5 text-xs font-semibold text-status-warning">
                        {n} {n === 1 ? 'issue' : 'issues'}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
