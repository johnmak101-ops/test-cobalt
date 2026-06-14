import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useShipment } from '../hooks/use-shipments'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { MilestoneTimeline } from '../components/MilestoneTimeline'
import { formatDate } from '../lib/utils'

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
  eta: string | null
  milestones: unknown[]
  pos: unknown[]
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

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold">{s.bookingNo ?? s.hblAwbFcrNo ?? s.soNo ?? s.id.slice(0, 8)}</h1>
        <Badge variant="status" value={s.state} />
        {s.reviewStatus === 'provisional' && (
          <span className="rounded bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
            Provisional · conf {s.confidence ?? '—'}
          </span>
        )}
      </div>

      {s.reviewReasons?.length ? (
        <Card>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Flagged for review</div>
          <ul className="list-inside list-disc text-sm text-status-warning">
            {s.reviewReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Shipment</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Mode" value={s.mode} />
            <Field label="Booking #" value={s.bookingNo} />
            <Field label="SO #" value={s.soNo} />
            <Field label="HBL / AWB" value={s.hblAwbFcrNo} />
            <Field label="MBL" value={s.mbl} />
            <Field label="Container" value={s.containerNo} />
            <Field label="ETD" value={formatDate(s.etd)} />
            <Field label="ETA" value={formatDate(s.eta)} />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Purchase Orders</h2>
          <div className="text-sm text-text-secondary">{s.pos?.length ? `${s.pos.length} linked` : '—'}</div>
        </Card>
      </div>

      <Card>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Timeline</div>
        <MilestoneTimeline milestones={(s.milestones ?? []) as never} />
      </Card>
    </div>
  )
}
