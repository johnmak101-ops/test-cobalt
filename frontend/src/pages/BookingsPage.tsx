import { Link } from 'react-router-dom'
import { useBookings } from '../hooks/use-tracking'
import { Card } from '../components/ui/Card'
import { StateBadge } from '../components/StateBadge'
import { ModeIcon } from '../components/ui/ModeIcon'

export default function BookingsPage() {
  const { data: bookings = [], isLoading } = useBookings()

  return (
    <div className="space-y-6">
      <h1 className="page-title">Bookings</h1>
      <Card padding={false}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Job No</th>
              <th>Brand</th>
              <th>Mode</th>
              <th>Legs</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} className="hover:bg-surface-700">
                <td>
                  <Link to={`/bookings/${b.id}`} className="font-mono link">
                    {b.jobNo}
                  </Link>
                </td>
                <td className="text-text-secondary">{b.brand ?? '—'}</td>
                <td>
                  {b.activeMode ? (
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <ModeIcon mode={b.activeMode} />
                      {b.activeMode}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-text-secondary">{b.legCount}</td>
                <td>{b.activeState ? <StateBadge state={b.activeState} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <div className="px-5 py-6 muted">Loading…</div>}
        {!isLoading && !bookings.length && (
          <div className="px-5 py-6 muted">No bookings yet — run Reconcile from the top bar to import shipments.</div>
        )}
      </Card>
    </div>
  )
}
