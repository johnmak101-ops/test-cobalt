import { Card } from '../ui/Card'
import { formatDate } from '../../lib/utils'

interface KeyDatesCardProps {
  crd: string | null
  cfsCutoff: string | null
  etd: string | null
  eta: string | null
  actualDeparture: string | null
  actualArrival: string | null
}

export function KeyDatesCard({
  crd,
  cfsCutoff,
  etd,
  eta,
  actualDeparture,
  actualArrival,
}: KeyDatesCardProps) {
  const dates = [
    { label: 'CRD (Cargo Ready)', value: crd },
    { label: 'CFS Cut-off', value: cfsCutoff },
    { label: 'ETD', value: etd },
    { label: 'ETA', value: eta },
    { label: 'Actual Departure', value: actualDeparture },
    { label: 'Actual Arrival', value: actualArrival },
  ].filter((d) => d.value)

  return (
    <Card>
      <h4 className="mb-4 text-sm font-semibold text-text-primary">Key Dates</h4>
      <div className="space-y-3">
        {dates.map((d) => (
          <div key={d.label} className="flex items-center justify-between">
            <span className="text-xs text-text-muted">{d.label}</span>
            <span className="font-mono text-sm text-text-primary">{formatDate(d.value)}</span>
          </div>
        ))}
        {dates.length === 0 && (
          <p className="text-sm text-text-muted italic">No dates available</p>
        )}
      </div>
    </Card>
  )
}
