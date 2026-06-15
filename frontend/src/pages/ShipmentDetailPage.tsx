import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Package } from 'lucide-react'
import { useShipment } from '../hooks/use-shipments'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { MilestoneTimeline } from '../components/MilestoneTimeline'
import { ConflictList } from '../components/ConflictList'
import { formatDate, modeLabel } from '../lib/utils'

interface LinkedPO {
  id: string
  poNumber: string
  totalQuantity: number | null
  quantityUnit: string | null
  vendor?: { name: string } | null
}

interface Identifier {
  type: string
  value: string
  docType: string | null
  isCurrent: boolean
  sourceEmailId: string | null
}

interface LegDetail {
  id: string
  state: string
  mode: string | null
  reviewStatus: string
  confidence: number | null
  reviewReasons: string[] | null
  bookingNo: string | null
  soNo: string | null
  hblAwbFcrNo: string | null
  mbl: string | null
  containerNo: string | null
  etd: string | null
  atd: string | null
  eta: string | null
  route: string | null
  customer?: { id: string; name: string; code: string } | null
  forwarder?: { id: string; name: string } | null
  pos: LinkedPO[]
  milestones: unknown[]
  identifiers?: Identifier[]
}

const ID_LABEL: Record<string, string> = {
  booking_no: 'Booking #', so_no: 'SO #', hbl_awb_fcr_no: 'HBL / AWB', mbl: 'MBL', container_no: 'Container',
}
const openEmail = (messageId: string) => window.open(`/emails/view?messageId=${encodeURIComponent(messageId)}`, '_blank', 'noopener')

/** Every value each rotating identifier ever held — current (bold) + the superseded / conflict
 *  alternates that the single column can't show, so nothing extracted is buried. */
function IdentifierHistory({ identifiers }: { identifiers: Identifier[] }) {
  const byType = new Map<string, Identifier[]>()
  for (const i of identifiers) {
    const a = byType.get(i.type) ?? []
    a.push(i)
    byType.set(i.type, a)
  }
  const withHistory = [...byType.entries()].filter(([, vs]) => vs.length > 1)
  if (!withHistory.length) return null
  return (
    <Card>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Identifier history</div>
      <p className="muted mb-3 text-xs">
        Every value this shipment carried for each rotating ID — the current one plus alternates that were superseded
        or lost a conflict. Click an alternate to view its source email.
      </p>
      <div className="space-y-3">
        {withHistory.map(([type, vs]) => {
          const current = vs.find((v) => v.isCurrent) ?? vs[0]
          const alts = vs.filter((v) => v !== current)
          return (
            <div key={type} className="text-sm">
              <div className="text-xs text-text-muted">{ID_LABEL[type] ?? type}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-text-primary">{current?.value ?? '—'}</span>
                {alts.map((a, k) => (
                  <button
                    key={k}
                    onClick={() => a.sourceEmailId && openEmail(a.sourceEmailId)}
                    disabled={!a.sourceEmailId}
                    title={a.sourceEmailId ? 'View original email' : undefined}
                    className={`rounded bg-surface-700 px-1.5 py-0.5 font-mono text-xs text-text-muted line-through decoration-text-muted/50 ${a.sourceEmailId ? 'hover:text-cobalt-primary hover:no-underline' : 'cursor-default'}`}
                  >
                    {a.value}{a.docType ? ` · ${a.docType}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-mono text-text-primary">{value || '—'}</div>
    </div>
  )
}

export default function ShipmentDetailPage() {
  const { id } = useParams()
  const { data, isLoading } = useShipment(id)
  const s = data as LegDetail | undefined

  if (isLoading) return <div className="text-sm text-text-muted">Loading…</div>
  if (!s) return <div className="text-sm text-text-muted">Shipment not found.</div>

  return (
    <div className="space-y-6">
      <Link to="/shipments" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Shipments
      </Link>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-bold">{s.bookingNo ?? s.hblAwbFcrNo ?? s.soNo ?? s.id.slice(0, 8)}</h1>
          <Badge variant="status" value={s.state} />
          {s.reviewStatus === 'provisional' && (
            <span className="rounded bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
              Provisional · conf {s.confidence ?? '—'}
            </span>
          )}
        </div>
        <div className="text-sm text-text-secondary">
          {[s.customer?.name, s.forwarder?.name, s.route].filter(Boolean).join('  ·  ') || '—'}
        </div>
      </div>

      {s.reviewReasons?.length ? (
        <Card>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Flagged for review</div>
          <ConflictList reasons={s.reviewReasons ?? []} />
        </Card>
      ) : null}

      <IdentifierHistory identifiers={s.identifiers ?? []} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Shipment</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Mode" value={modeLabel(s.mode)} />
            <Field label="Route" value={s.route} />
            <Field label="Customer" value={s.customer?.name} />
            <Field label="Forwarder" value={s.forwarder?.name} />
            <Field label="Booking #" value={s.bookingNo} />
            <Field label="SO #" value={s.soNo} />
            <Field label="HBL / AWB" value={s.hblAwbFcrNo} />
            <Field label="MBL" value={s.mbl} />
            <Field label="Container" value={s.containerNo} />
            <Field label="ETD" value={formatDate(s.etd)} />
            <Field label="ATD" value={formatDate(s.atd)} />
            <Field label="ETA" value={formatDate(s.eta)} />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">
            Purchase Orders <span className="text-text-muted">({s.pos?.length ?? 0})</span>
          </h2>
          {s.pos?.length ? (
            <ul className="divide-y divide-border/50">
              {s.pos.map((po) => (
                <li key={po.id}>
                  <Link
                    to={`/purchase-orders/${po.id}`}
                    className="flex items-center justify-between py-2 transition-colors hover:text-cobalt-primary"
                  >
                    <span className="inline-flex items-center gap-2 font-mono text-sm">
                      <Package size={13} className="text-text-muted" /> {po.poNumber}
                    </span>
                    <span className="text-xs text-text-muted">
                      {po.vendor?.name ?? ''}
                      {po.totalQuantity != null ? ` · ${po.totalQuantity}${po.quantityUnit ?? ''}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-text-muted">No linked POs.</div>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Timeline</div>
        <MilestoneTimeline milestones={(s.milestones ?? []) as never} />
      </Card>
    </div>
  )
}
