import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

interface DashboardStats {
  activeShipments: number
  warningAlerts: number
  criticalAlerts: number
  newEmails: number
}

interface DashboardData {
  stats: DashboardStats
  recentAlerts: Array<{
    id: string
    shipmentId: string
    ruleId: string
    severity: string
    message: string
    status: string
    triggeredAt: string
    shipment: {
      id: string
      poNumbers: string
      route: string | null
      consigneeName?: string | null
      customer?: { name: string } | null
    }
  }>
  recentActivity: Array<{
    id: string
    poNumbers: string
    status: string
    riskLevel: string
    route: string | null
    updatedAt: string
    bookingNo?: string | null
    etd?: string | null
    actualDeparture?: string | null
    customer: { name: string } | null
    forwarder: { name: string } | null
  }>
}

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard'),
    refetchInterval: 30000,
  })
}
