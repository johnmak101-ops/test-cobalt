import { useState } from 'react'
import { useShipments } from '../hooks/use-shipments'
import { ShipmentTable } from '../components/shipments/ShipmentTable'
import { ShipmentFilters } from '../components/shipments/ShipmentFilters'

export default function ShipmentTrackerPage() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const { data, isLoading } = useShipments({ status: statusFilter })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Shipment Tracker</h1>
      </div>

      <ShipmentFilters value={statusFilter} onChange={setStatusFilter} />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading shipments...</span>
        </div>
      ) : (
        <ShipmentTable shipments={data?.shipments ?? []} />
      )}
    </div>
  )
}
