import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface EmailIntegrationConfig {
  id: string
  tenantId: string
  clientId: string
  clientSecret: string // masked when fetched
  _secretMasked: boolean
  mailboxEmail: string | null
  isActive: boolean
  lastSyncAt: string | null
  lastSyncStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | null
  lastSyncError: string | null
  lastSyncCount: number
  createdAt: string
  updatedAt: string
}

interface GetConfigResponse {
  config: EmailIntegrationConfig | null
}

interface SaveConfigPayload {
  tenantId: string
  clientId: string
  clientSecret: string
  mailboxEmail?: string | null
  isActive?: boolean
}

interface TestConnectionResponse {
  success: boolean
  message: string
  detectedMailbox?: string
  userCount?: number
  config?: EmailIntegrationConfig | null
}

interface SyncResponse {
  synced: number
  skipped: number
  errors: string[]
  config?: EmailIntegrationConfig | null
}

export function useEmailIntegration() {
  return useQuery<GetConfigResponse>({
    queryKey: ['emailIntegration'],
    queryFn: () => api.get('/email-integrations'),
  })
}

export function useSaveEmailIntegration() {
  const qc = useQueryClient()
  return useMutation<GetConfigResponse, Error, SaveConfigPayload>({
    mutationFn: (payload) => api.put('/email-integrations', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emailIntegration'] })
    },
  })
}

export function useTestEmailConnection() {
  const qc = useQueryClient()
  return useMutation<TestConnectionResponse, Error, void>({
    mutationFn: () => api.post<TestConnectionResponse>('/email-integrations/test', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emailIntegration'] })
    },
  })
}

export function useSyncEmails() {
  const qc = useQueryClient()
  return useMutation<SyncResponse, Error, void>({
    mutationFn: () => api.post<SyncResponse>('/email-integrations/sync', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emailIntegration'] })
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
  })
}