import { useAlerts } from '../hooks/use-alerts'
import { AlertSection } from '../components/alerts/AlertSection'
import { useNavigate } from 'react-router-dom'
import { Settings } from 'lucide-react'

export default function AlertsPage() {
  const { data, isLoading } = useAlerts()
  const navigate = useNavigate()

  const activeAlerts = (data?.alerts ?? []).filter((a) => a.status === 'ACTIVE')
  const critical = activeAlerts.filter((a) => a.severity === 'CRITICAL')
  const warning = activeAlerts.filter((a) => a.severity === 'WARNING')
  const info = activeAlerts.filter((a) => a.severity === 'INFO')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Alerts</h1>
        <button
          onClick={() => navigate('/settings/alerts')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
        >
          <Settings size={14} />
          Alert Settings
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading alerts...</span>
        </div>
      ) : activeAlerts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2">
          <span className="text-sm text-text-muted">No active alerts</span>
          <p className="text-xs text-text-muted">All shipments are on track.</p>
        </div>
      ) : (
        <div className="space-y-8">
          <AlertSection severity="CRITICAL" alerts={critical} />
          <AlertSection severity="WARNING" alerts={warning} />
          <AlertSection severity="INFO" alerts={info} />
        </div>
      )}
    </div>
  )
}
