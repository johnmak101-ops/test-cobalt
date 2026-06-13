import { Link } from 'react-router-dom'
import { useBookings } from '../hooks/use-tracking'
import { Card } from '../components/ui/Card'
import { StateBadge } from '../components/StateBadge'

export default function BookingsPage() {
  const { data: bookings = [], isLoading } = useBookings()

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Bookings</h1>
      <Card padding={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-5 py-3 font-medium">Job No</th>
              <th className="px-5 py-3 font-medium">Brand</th>
              <th className="px-5 py-3 font-medium">Mode</th>
              <th className="px-5 py-3 font-medium">Legs</th>
              <th className="px-5 py-3 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-surface-700">
                <td className="px-5 py-3">
                  <Link to={`/bookings/${b.id}`} className="font-mono text-cobalt-primary hover:underline">
                    {b.jobNo}
                  </Link>
                </td>
                <td className="px-5 py-3 text-text-secondary">{b.brand ?? '—'}</td>
                <td className="px-5 py-3">
                  {b.activeMode ? (
                    <span>
                      {b.activeMode === 'AIR' ? '✈️ ' : '🚢 '}
                      {b.activeMode}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-3 text-text-secondary">{b.legCount}</td>
                <td className="px-5 py-3">{b.activeState ? <StateBadge state={b.activeState} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <div className="px-5 py-6 text-sm text-text-muted">Loading…</div>}
        {!isLoading && !bookings.length && (
          <div className="px-5 py-6 text-sm text-text-muted">No bookings — click Reconcile in the top bar.</div>
        )}
      </Card>
    </div>
  )
}
