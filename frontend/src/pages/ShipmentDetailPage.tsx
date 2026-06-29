import { useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useShipment } from '../hooks/use-shipments'
import { useShipmentHistory } from '../hooks/use-shipment-history'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { MilestoneTimeline } from '../components/shipments/MilestoneTimeline'
import { ShipmentHistoryTimeline } from '../components/shipments/ShipmentHistoryTimeline'
import { AlertCard } from '../components/alerts/AlertCard'
import { formatRelativeTime, formatDate, cn } from '../lib/utils'
import { ArrowLeft, Mail, Clock, ClipboardList, Package, Ship, Calendar, AlertTriangle, AlertCircle, Info } from 'lucide-react'

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const fromAlerts = (location.state as { fromAlerts?: boolean })?.fromAlerts
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

  const shortId = shipment.bookingNo ?? shipment.id.slice(0, 12)
  const linkedPOs = shipment.linkedPOs ?? []
  const activeAlerts = (shipment.alerts ?? []).filter((a) => a.status === 'ACTIVE')
  const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length
  const warningCount = activeAlerts.filter((a) => a.severity === 'WARNING').length
  const infoCount = activeAlerts.filter((a) => a.severity === 'INFO').length
  const topSeverity = criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'INFO'

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <button
          onClick={() => navigate(fromAlerts ? '/alerts' : '/shipments')}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          {fromAlerts ? 'Back to Alerts' : 'Back to Shipments'}
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-mono text-xl font-semibold text-text-primary">
              {shortId}
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

      {/* Alert banner */}
      {activeAlerts.length > 0 && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-4 py-3',
            topSeverity === 'CRITICAL'
              ? 'border-status-critical/30 bg-status-critical/10 text-status-critical'
              : topSeverity === 'WARNING'
                ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                : 'border-status-info/30 bg-status-info/10 text-status-info'
          )}
        >
          {topSeverity === 'CRITICAL' ? (
            <AlertCircle size={18} className="shrink-0" />
          ) : topSeverity === 'WARNING' ? (
            <AlertTriangle size={18} className="shrink-0" />
          ) : (
            <Info size={18} className="shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {activeAlerts.length === 1
                ? activeAlerts[0].message
                : `${activeAlerts.length} active alerts on this shipment`}
            </p>
            {activeAlerts.length > 1 && (
              <p className="mt-0.5 text-xs opacity-75">
                {[
                  criticalCount > 0 && `${criticalCount} critical`,
                  warningCount > 0 && `${warningCount} warning`,
                  infoCount > 0 && `${infoCount} info`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Horizontal Milestone Timeline (full width) */}
      <Card>
        <h4 className="mb-4 text-sm font-semibold text-text-primary">Milestone Timeline</h4>
        <MilestoneTimeline
          milestones={shipment.milestones ?? []}
          currentStatus={shipment.status}
          horizontal
        />
      </Card>

      {/* Linked POs card */}
      {linkedPOs.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Package size={14} className="text-text-muted" />
            <h4 className="text-sm font-semibold text-text-primary">
              Customer Purchase Orders
              <span className="ml-2 text-xs font-normal text-text-muted">
                {linkedPOs.length} PO{linkedPOs.length !== 1 ? 's' : ''} on this shipment
              </span>
            </h4>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-900/50">
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-text-muted">Customer PO#</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-text-muted">Vendor</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-text-muted">Shipped</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-text-muted">Total</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-text-muted">UOM</th>
                </tr>
              </thead>
              <tbody>
                {linkedPOs.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => navigate(`/purchase-orders/${po.id}`, { state: { fromShipment: id } })}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700"
                  >
                    <td className="px-3 py-2 font-mono text-sm text-cobalt-primary-light">{po.poNumber}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary">{po.vendor?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-text-primary">{po.quantity ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-text-muted">{po.totalQuantity ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{po.quantityUnit ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Order Details (full width) */}
      <Card>
        <h4 className="mb-4 text-sm font-semibold text-text-primary">Order Details</h4>
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {/* Section 1: Order Info */}
          <DetailSection title="Order Info" icon={<ClipboardList size={14} className="text-text-muted" />}>
            <DetailRow label="Customer Code" value={shipment.customer?.code ?? null} />
            <DetailRow label="Vendor Code" value={shipment.vendor?.code ?? null} />
            <DetailRow label="PO#" value={linkedPOs.length > 0 ? linkedPOs.map(p => p.poNumber).join(', ') : '—'} />
            <DetailRow label="Booking No." value={shipment.bookingNo} />
            <DetailRow label="SO#" value={shipment.soNumber} />
            <DetailRow label="Item / Style No." value={shipment.itemStyleNo} />
            <DetailRow label="Email Date" value={formatDate(shipment.createdAt)} />
          </DetailSection>

          {/* Section 2: Cargo & Logistics */}
          <DetailSection title="Cargo & Logistics" icon={<Package size={14} className="text-text-muted" />}>
            <DetailRow label="Qty" value={shipment.quantityShipped != null ? String(shipment.quantityShipped) : null} />
            <DetailRow label="UOM" value={shipment.quantityUnit ?? null} />
            <DetailRow label="Container No." value={shipment.containerNo} />
            <DetailRow label="HBL / AWB / FCR No." value={shipment.hblNumber} />
            <DetailRow label="MBL" value={shipment.mblNumber} />
            <DetailRow label="SCAC Code" value={shipment.scacCode} />
          </DetailSection>

          {/* Section 3: Shipping */}
          <DetailSection title="Shipping" icon={<Ship size={14} className="text-text-muted" />}>
            <DetailRow label="Forwarder" value={shipment.forwarder?.name ?? null} />
            <DetailRow label="Consignee Name" value={shipment.consigneeName} />
            <DetailRow label="Consignee Address" value={shipment.consigneeAddress} />
            <DetailRow label="Vessel" value={shipment.vesselName} />
            <DetailRow label="Voyage" value={shipment.voyageNumber} />
            <DetailRow label="Route" value={shipment.route} />
            <DetailRow label="Origin Country" value={shipment.originCountry ?? '—'} />
          </DetailSection>

          {/* Section 4: Key Dates */}
          <DetailSection title="Key Dates" icon={<Calendar size={14} className="text-text-muted" />}>
            <DetailRow label="Cargo Ready Date" value={formatDate(shipment.crd)} />
            <DetailRow label="WH Start Date" value={formatDate(shipment.warehouseStartDate)} />
            <DetailRow label="WH End Date" value={formatDate(shipment.warehouseEndDate)} />
            <DetailRow label="CFS Cut-off" value={formatDate(shipment.cfsCutoff)} />
            <DetailRow label="ETD" value={formatDate(shipment.etd)} />
            <DetailRow label="ATD" value={formatDate(shipment.actualDeparture)} />
            <DetailRow label="ETA" value={formatDate(shipment.eta)} />
            <DetailRow label="ATA" value={formatDate(shipment.actualArrival)} />
            <DetailRow label="In DC Date" value={formatDate(shipment.inDcDate)} />
          </DetailSection>
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
  )
}

function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-2 items-baseline">
      <span className="text-xs text-text-muted truncate">{label}</span>
      <span className="font-mono text-sm text-text-primary break-words">
        {value ?? <span className="italic text-text-muted">(pending)</span>}
      </span>
    </div>
  )
}