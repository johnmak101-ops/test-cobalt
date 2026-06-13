import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useBooking, useShipment } from '../hooks/use-tracking'
import { Card } from '../components/ui/Card'
import { StateBadge } from '../components/StateBadge'
import { MilestoneTimeline } from '../components/MilestoneTimeline'
import { formatDate } from '../lib/utils'
import type { Leg } from '../lib/types'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-mono text-text-primary">{value || '—'}</div>
    </div>
  )
}

function LegCard({ leg }: { leg: Leg }) {
  const { data } = useShipment(leg.id)
  const superseded = leg.legStatus === 'SUPERSEDED'

  return (
    <Card className={superseded ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg">{leg.mode === 'AIR' ? '✈️' : '🚢'}</span>
        <span className="font-semibold text-text-primary">
          Leg {leg.legNo} · {leg.mode ?? '—'}
        </span>
        <StateBadge state={leg.state} />
        {superseded ? (
          <span className="rounded bg-surface-700 px-2 py-0.5 text-[11px] font-semibold text-text-muted">SUPERSEDED</span>
        ) : (
          <span className="rounded bg-status-success/15 px-2 py-0.5 text-[11px] font-semibold text-status-success">ACTIVE</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
        <Field label="Booking #" value={leg.bookingNo} />
        <Field label="SO #" value={leg.soNo} />
        <Field label="HBL / AWB" value={leg.hblAwbFcrNo} />
        {leg.mode === 'AIR' ? <Field label="Flight" value={leg.flightNo} /> : <Field label="Vessel" value={leg.vesselName} />}
        <Field label="ETD" value={formatDate(leg.etd)} />
        <Field label="ETA" value={formatDate(leg.eta)} />
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Timeline</div>
        <MilestoneTimeline milestones={data?.milestones ?? []} />
      </div>
    </Card>
  )
}

export default function BookingDetailPage() {
  const { id } = useParams()
  const { data: b, isLoading } = useBooking(id)

  if (isLoading) return <div className="text-text-muted">Loading…</div>
  if (!b) return <div className="text-text-muted">Booking not found.</div>

  return (
    <div className="space-y-6">
      <Link to="/bookings" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Bookings
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold">{b.jobNo}</h1>
        <span className="rounded bg-surface-700 px-2 py-0.5 text-xs text-text-secondary">{b.status}</span>
        {b.brand && <span className="text-text-muted">{b.brand}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Purchase Orders</h2>
          {b.pos.length ? (
            b.pos.map((p) => (
              <div key={p.id} className="flex justify-between border-b border-border/50 py-2 text-sm last:border-0">
                <span className="font-mono text-text-primary">{p.poNumber}</span>
                <span className="text-text-muted">
                  {p.itemStyleNo ?? ''} {p.totalQuantity ? `· ${p.totalQuantity} ${p.quantityUnit ?? ''}` : ''}
                </span>
              </div>
            ))
          ) : (
            <div className="text-sm text-text-muted">—</div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Booking</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Cargo ready (CRD)" value={formatDate(b.crd)} />
            <Field label="Legs" value={String(b.legs.length)} />
            <Field label="Active mode" value={b.activeMode ?? '—'} />
            <Field label="Active state" value={b.activeState ?? '—'} />
          </div>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 font-semibold">Shipment legs</h2>
        <div className="space-y-4">
          {b.legs.map((l) => (
            <LegCard key={l.id} leg={l} />
          ))}
        </div>
      </div>
    </div>
  )
}
