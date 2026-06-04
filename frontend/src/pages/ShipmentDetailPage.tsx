import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useShipment } from '../hooks/use-shipments'
import { useShipmentHistory } from '../hooks/use-shipment-history'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { MilestoneTimeline } from '../components/shipments/MilestoneTimeline'
import { KeyDatesCard } from '../components/shipments/KeyDatesCard'
import { ShipmentHistoryTimeline } from '../components/shipments/ShipmentHistoryTimeline'
import { AlertCard } from '../components/alerts/AlertCard'
import { parsePONumbers, formatRelativeTime, cn } from '../lib/utils'
import { ArrowLeft, Mail, Clock } from 'lucide-react'

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: shipment, isLoading } = useShipment(id!)
  const { data: historyData } = useShipmentHistory(id!)
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Loading shipment...</span>
      </div>
    )
  }

  if (!shipment) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Shipment not found</span>
      </div>
    )
  }

  const poNumbers = parsePONumbers(shipment.poNumbers)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/shipments')}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          Back to Shipments
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-mono text-xl font-semibold text-text-primary">
              PO# {poNumbers.join(', ')}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {shipment.customer?.name ?? 'Unknown Customer'}
              {shipment.forwarder && ` · ${shipment.forwarder.name}`}
              {shipment.route && ` · ${shipment.route}`}
            </p>
          </div>
          <Badge variant="status" value={shipment.status} />
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: Timeline */}
        <div className="lg:col-span-1">
          <Card>
            <h4 className="mb-4 text-sm font-semibold text-text-primary">Milestone Timeline</h4>
            <MilestoneTimeline
              milestones={shipment.milestones ?? []}
              currentStatus={shipment.status}
            />
          </Card>
        </div>

        {/* Right column: Details */}
        <div className="space-y-6 lg:col-span-2">
          {/* Key Dates */}
          <KeyDatesCard
            crd={shipment.crd}
            cfsCutoff={shipment.cfsCutoff}
            etd={shipment.etd}
            eta={shipment.eta}
            actualDeparture={shipment.actualDeparture}
            actualArrival={shipment.actualArrival}
          />

          {/* Extracted Data */}
          <Card>
            <h4 className="mb-4 text-sm font-semibold text-text-primary">Extracted Data</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                { label: 'HBL#', value: shipment.hblNumber },
                { label: 'Vessel', value: shipment.vesselName },
                { label: 'Voyage', value: shipment.voyageNumber },
                { label: 'Warehouse', value: shipment.warehouseAddress },
                {
                  label: 'Qty Shipped',
                  value:
                    (shipment as any).quantityShipped != null
                      ? `${(shipment as any).quantityShipped} ${(shipment as any).quantityUnit ?? ''}`
                      : null,
                },
              ].map((item) => (
                <div key={item.label}>
                  <span className="text-xs text-text-muted">{item.label}</span>
                  <p className="font-mono text-sm text-text-primary">
                    {item.value ?? <span className="italic text-text-muted">(pending)</span>}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Tab switcher: Alerts/Emails vs History */}
          <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
            <button
              onClick={() => setActiveTab('details')}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === 'details'
                  ? 'bg-cobalt-primary text-white'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              Alerts & Emails
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === 'history'
                  ? 'bg-cobalt-primary text-white'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              <Clock size={12} />
              Change History
              {historyData?.history && historyData.history.length > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/20 px-1 text-[10px]">
                  {historyData.history.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'details' ? (
            <>
              {/* Active Alerts */}
              {shipment.alerts && shipment.alerts.filter((a) => a.status === 'ACTIVE').length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-text-primary">Active Alerts</h4>
                  {shipment.alerts
                    .filter((a) => a.status === 'ACTIVE')
                    .map((alert) => (
                      <AlertCard
                        key={alert.id}
                        alert={{
                          ...alert,
                          shipmentId: shipment.id,
                        }}
                        compact
                      />
                    ))}
                </div>
              )}

              {/* Related Emails */}
              {shipment.emails && shipment.emails.length > 0 && (
                <Card>
                  <h4 className="mb-4 text-sm font-semibold text-text-primary">Related Emails</h4>
                  <div className="space-y-2">
                    {shipment.emails.map((email) => (
                      <div
                        key={email.id}
                        className="flex items-center gap-3 rounded-lg bg-surface-900 p-3"
                      >
                        <Mail size={14} className="shrink-0 text-text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text-primary">{email.subject}</p>
                          <p className="text-xs text-text-muted">
                            {email.sender} · {formatRelativeTime(email.receivedAt)}
                          </p>
                        </div>
                        {email.emailType && (
                          <Badge variant="emailType" value={email.emailType} />
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          ) : (
            /* History tab */
            <Card>
              <h4 className="mb-4 text-sm font-semibold text-text-primary">Change History</h4>
              <ShipmentHistoryTimeline history={historyData?.history ?? []} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
