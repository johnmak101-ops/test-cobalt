import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card } from '../components/ui/Card'
import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import {
  useVendors,
  useCreateVendor,
  useDeleteVendor,
  useImportVendorsCsv,
} from '../hooks/use-vendors'
import {
  useEmailIntegration,
  useSaveEmailIntegration,
  useTestEmailConnection,
  useSyncEmails,
} from '../hooks/use-email-integrations'
import { Upload, Plus, Trash2, Factory, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronRight, Zap } from 'lucide-react'

interface AlertRule {
  id: string
  name: string
  description: string
  state: string
  triggerType: string
  triggerReference: string
  thresholdDays: number
  countryThresholds: Record<string, number> | null // ABSOLUTE days per origin country (as stored by the API)
  countryOffsets?: Record<string, number> // UI-only: extra days vs the default ("CN +1 day")
  severity: string
  enabled: boolean
  locked: boolean
}

const ALERT_COUNTRY_LIST = [
  { code: 'CN', label: 'China' },
  { code: 'BD', label: 'Bangladesh' },
  { code: 'KH', label: 'Cambodia' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'IN', label: 'India' },
  { code: 'LK', label: 'Sri Lanka' },
]

/**
 * The API stores per-country thresholds as ABSOLUTE days; this section edits them as an OFFSET
 * vs the rule's default ("CN +1 day"). Converting at the load/save boundary keeps the backend,
 * the evaluator, and the standalone Alert Rules page on their existing absolute model.
 */
function deriveCountryOffsets(rule: AlertRule): Record<string, number> {
  const out: Record<string, number> = {}
  if (rule.countryThresholds) {
    for (const [code, days] of Object.entries(rule.countryThresholds)) out[code] = days - rule.thresholdDays
  }
  return out
}

function withOffsets(rules: AlertRule[]): AlertRule[] {
  return rules.map((r) => ({ ...r, countryOffsets: deriveCountryOffsets(r) }))
}

function AlertRulesSettings() {
  const { data, isLoading } = useQuery<{ rules: AlertRule[] }>({
    queryKey: ['alertRules'],
    queryFn: () => api.get('/alert-rules'),
  })
  const qc = useQueryClient()
  const [localRules, setLocalRules] = useState<AlertRule[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data?.rules) {
      setLocalRules(withOffsets(data.rules))
      setDirty(false)
    }
  }, [data])

  const saveRules = useMutation({
    // Convert each rule's per-country OFFSET back to the API's ABSOLUTE days (default + offset)
    // and drop the UI-only countryOffsets field before sending.
    mutationFn: (rules: AlertRule[]) =>
      api.put('/alert-rules', {
        rules: rules.map(({ countryOffsets, ...rule }) => {
          const ct: Record<string, number> = {}
          for (const [code, off] of Object.entries(countryOffsets ?? {})) {
            if (off) ct[code] = rule.thresholdDays + off
          }
          return { ...rule, countryThresholds: Object.keys(ct).length > 0 ? ct : null }
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules'] })
      setDirty(false)
    },
  })

  const updateRule = (id: string, field: string, value: number | string | boolean) => {
    setLocalRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
    setDirty(true)
  }

  const updateCountryOffset = (id: string, code: string, offset: number | '') => {
    setLocalRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const offs = { ...(r.countryOffsets ?? {}) }
        if (offset === '' || offset === 0) delete offs[code]
        else offs[code] = offset
        return { ...r, countryOffsets: offs }
      })
    )
    setDirty(true)
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading alert rules...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Alert Rules Configuration</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Configure when alerts are triggered for each shipment state. Changes take effect
          immediately.
        </p>
      </div>

      <div className="space-y-4">
        {localRules.map((rule) => (
          <Card key={rule.id}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-muted">{rule.id}</span>
                <h4 className="text-sm font-semibold text-text-primary">{rule.name}</h4>
                {rule.locked && (
                  <span className="rounded bg-status-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
                    LOCKED
                  </span>
                )}
              </div>

              {/* Enabled toggle */}
              <button
                onClick={() => !rule.locked && updateRule(rule.id, 'enabled', !rule.enabled)}
                disabled={rule.locked}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                  rule.enabled ? 'bg-cobalt-primary' : 'bg-surface-600',
                  rule.locked && 'cursor-not-allowed opacity-50'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    rule.enabled ? 'left-[22px]' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <label className="text-xs text-text-muted">
                  Trigger {rule.triggerType === 'days_before' ? 'before' : 'after'} (days)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={rule.thresholdDays}
                  onChange={(e) =>
                    !rule.locked &&
                    updateRule(rule.id, 'thresholdDays', parseInt(e.target.value) || 0)
                  }
                  disabled={rule.locked}
                  className="mt-1 h-9 w-20 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted">Severity</label>
                <select
                  value={rule.severity}
                  onChange={(e) =>
                    !rule.locked && updateRule(rule.id, 'severity', e.target.value)
                  }
                  disabled={rule.locked}
                  className="mt-1 h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="CRITICAL">Critical</option>
                  <option value="WARNING">Warning</option>
                  <option value="INFO">Info</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted">State</label>
                <p className="mt-1 h-9 flex items-center text-sm text-text-secondary">
                  {rule.state.replace('_', ' ')}
                </p>
              </div>
            </div>

            {/* Per-country warning days — extra days added to the default for a given origin country */}
            {!rule.locked && (
              <div className="mt-5 rounded-lg border border-border bg-surface-800/50 p-3.5">
                <label className="text-xs font-medium text-text-secondary">Country warning days</label>
                <p className="mt-0.5 text-[10px] text-text-muted">
                  Extra days before this alert fires, by shipment origin country (added to the default of{' '}
                  {rule.thresholdDays} {rule.thresholdDays === 1 ? 'day' : 'days'}). Leave blank for none.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {ALERT_COUNTRY_LIST.map((country) => {
                    const off = rule.countryOffsets?.[country.code]
                    return (
                      <div
                        key={country.code}
                        className="flex items-center justify-between gap-2 rounded border border-border bg-surface-700/40 px-2 py-1"
                      >
                        <span className="min-w-0 truncate text-xs text-text-secondary">
                          <span className="font-semibold text-text-muted">{country.code}</span> {country.label}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-[11px] text-text-muted">+</span>
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={off ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              updateCountryOffset(rule.id, country.code, v === '' ? '' : parseInt(v) || 0)
                            }}
                            placeholder="0"
                            className="h-7 w-14 rounded border border-border bg-surface-700 px-2 text-xs text-text-primary placeholder:text-text-muted/40"
                          />
                          <span className="text-[11px] text-text-muted">days</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={() => {
            if (data?.rules) {
              setLocalRules(withOffsets(data.rules))
              setDirty(false)
            }
          }}
          disabled={!dirty}
          className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          Reset to Defaults
        </button>
        <button
          onClick={() => saveRules.mutate(localRules)}
          disabled={!dirty || saveRules.isPending}
          className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
        >
          {saveRules.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

function VendorsSettings() {
  const { data, isLoading } = useVendors()
  const createVendor = useCreateVendor()
  const deleteVendor = useDeleteVendor()
  const importCsv = useImportVendorsCsv()
  const [showCreate, setShowCreate] = useState(false)
  const [newVendor, setNewVendor] = useState({ name: '', type: 'factory', location: '' })
  const [csvText, setCsvText] = useState('')
  const [showCsvImport, setShowCsvImport] = useState(false)

  const vendors = data?.vendors ?? []

  const handleCreate = () => {
    if (!newVendor.name.trim()) return
    createVendor.mutate(
      {
        name: newVendor.name.trim(),
        type: newVendor.type,
        location: newVendor.location.trim() || undefined,
      },
      {
        onSuccess: () => {
          setNewVendor({ name: '', type: 'factory', location: '' })
          setShowCreate(false)
        },
      }
    )
  }

  const handleImportCsv = () => {
    if (!csvText.trim()) return
    importCsv.mutate(csvText.trim(), {
      onSuccess: () => {
        setCsvText('')
        setShowCsvImport(false)
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Vendors / Factories</h2>
          <p className="text-sm text-text-secondary">
            Vendor &amp; factory records are mirrored read-only from the Cobalt Mesh API. Maintain them in Cobalt Mesh;
            this app resolves them or flags unknowns for review.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            disabled
            title="Vendors are maintained in the Cobalt Mesh API — read-only here"
            onClick={() => {
              setShowCsvImport(!showCsvImport)
              setShowCreate(false)
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload size={13} />
            CSV Import
          </button>
          <button
            disabled
            title="Vendors are maintained in the Cobalt Mesh API — read-only here"
            onClick={() => {
              setShowCreate(!showCreate)
              setShowCsvImport(false)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={13} />
            Add Vendor
          </button>
        </div>
      </div>

      {/* CSV Import form */}
      {showCsvImport && (
        <Card>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Import Vendors from CSV</h4>
          <p className="mb-3 text-xs text-text-muted">
            Paste CSV with columns: name, type, location, email, phone, notes (header row required)
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={'name,type,location,email,phone\nShenzhen Textile Co,factory,Shenzhen,contact@example.com,+86 123'}
            rows={5}
            className="w-full rounded-lg border border-border bg-surface-700 p-3 font-mono text-xs text-text-primary placeholder:text-text-muted"
          />
          <div className="mt-3 flex items-center justify-between">
            {importCsv.data && (
              <p className="text-xs text-status-success">
                Imported {importCsv.data.imported}, {importCsv.data.errors} errors
              </p>
            )}
            {importCsv.isError && (
              <p className="text-xs text-status-critical">{importCsv.error?.message}</p>
            )}
            <button
              onClick={handleImportCsv}
              disabled={!csvText.trim() || importCsv.isPending}
              className="rounded-lg bg-cobalt-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
            >
              {importCsv.isPending ? 'Importing...' : 'Import'}
            </button>
          </div>
        </Card>
      )}

      {/* Quick create form */}
      {showCreate && (
        <Card>
          <h4 className="mb-3 text-sm font-semibold text-text-primary">Add New Vendor</h4>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-text-muted">Name *</label>
              <input
                type="text"
                value={newVendor.name}
                onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })}
                placeholder="e.g. Shenzhen Textile Co."
                className="mt-1 block h-9 w-52 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">Type</label>
              <select
                value={newVendor.type}
                onChange={(e) => setNewVendor({ ...newVendor, type: e.target.value })}
                className="mt-1 block h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary"
              >
                <option value="factory">Factory</option>
                <option value="subcontractor">Subcontractor</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">Location</label>
              <input
                type="text"
                value={newVendor.location}
                onChange={(e) => setNewVendor({ ...newVendor, location: e.target.value })}
                placeholder="e.g. Shenzhen, China"
                className="mt-1 block h-9 w-40 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!newVendor.name.trim() || createVendor.isPending}
              className="h-9 rounded-lg bg-cobalt-primary px-4 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
            >
              {createVendor.isPending ? 'Adding...' : 'Add'}
            </button>
          </div>
        </Card>
      )}

      {/* Vendors list */}
      {isLoading ? (
        <div className="text-sm text-text-muted">Loading vendors...</div>
      ) : vendors.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-border bg-surface-800 text-text-muted">
          <Factory size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No vendors configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vendors.map((vendor) => (
            <Card key={vendor.id}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-text-primary">{vendor.name}</h4>
                    <span className="rounded bg-surface-600 px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                      {vendor.type.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
                    {vendor.location && <span>{vendor.location}</span>}
                    {vendor.contactEmail && <span>{vendor.contactEmail}</span>}
                    {vendor.contactPhone && <span>{vendor.contactPhone}</span>}
                  </div>
                </div>
                <button
                  onClick={() => deleteVendor.mutate(vendor.id)}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-status-critical/10 hover:text-status-critical"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function EmailIntegrationSettings() {
  const { data, isLoading } = useEmailIntegration()
  const saveConfig = useSaveEmailIntegration()
  const testConnection = useTestEmailConnection()
  const syncEmails = useSyncEmails()

  const config = data?.config ?? null

  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [mailboxEmail, setMailboxEmail] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  // Populate form from config when loaded
  useEffect(() => {
    if (config) {
      setTenantId(config.tenantId ?? '')
      setClientId(config.clientId ?? '')
      setClientSecret('') // Leave blank; masked value is not the real secret
      setMailboxEmail(config.mailboxEmail ?? '')
      setIsActive(config.isActive)
    }
  }, [config])

  const handleSave = () => {
    const payload: Record<string, unknown> = {
      tenantId,
      clientId,
      mailboxEmail: mailboxEmail || null,
      isActive,
    }
    // Only send secret if the user entered a new one
    if (clientSecret) {
      payload.clientSecret = clientSecret
    } else if (!config) {
      // First-time save requires a secret
      return
    }
    saveConfig.mutate(payload as any)
  }

  const handleTest = () => {
    // Save first if not yet saved, then test
    if (!config && tenantId && clientId && clientSecret) {
      saveConfig.mutate(
        { tenantId, clientId, clientSecret, mailboxEmail: mailboxEmail || null, isActive },
        { onSuccess: () => testConnection.mutate() }
      )
    } else {
      testConnection.mutate()
    }
  }

  const handleSync = () => {
    syncEmails.mutate()
  }

  // Relative time formatting
  const formatLastSync = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return date.toLocaleDateString()
  }

  const isConnected = config?.lastSyncStatus === 'SUCCESS' || config?.lastSyncStatus === 'PARTIAL'
  const hasError = config?.lastSyncStatus === 'FAILED'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Microsoft 365 Email Connection</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Connect to your shared mailbox to automatically import shipping emails into Cobalt Track.
        </p>
      </div>

      {/* Connection Status */}
      {config && (
        <Card>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${isConnected ? 'bg-status-success' : hasError ? 'bg-status-critical' : 'bg-text-muted'}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {isConnected ? 'Connected' : hasError ? 'Connection Error' : 'Not Connected'}
                </span>
                {config.lastSyncAt && (
                  <span className="text-xs text-text-muted">
                    Last sync: {formatLastSync(config.lastSyncAt)}
                  </span>
                )}
              </div>
              {isConnected && (
                <p className="mt-0.5 text-xs text-text-secondary">
                  {config.lastSyncCount ?? 0} email{config.lastSyncCount !== 1 ? 's' : ''} synced
                </p>
              )}
              {hasError && config.lastSyncError && (
                <p className="mt-0.5 text-xs text-status-critical">{config.lastSyncError}</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Azure AD Credentials */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Azure AD / Entra ID Credentials</h3>
        <p className="mb-4 text-xs text-text-muted">
          Enter the credentials from your Azure App Registration. The Client Secret is masked after saving.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary">Tenant ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary">Client Secret</label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={config?._secretMasked ? '•••••••••••••• (enter new value to change)' : 'Enter client secret'}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Mailbox Settings */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Mailbox</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary">Email Address</label>
            <input
              type="email"
              value={mailboxEmail}
              onChange={(e) => setMailboxEmail(e.target.value)}
              placeholder="e.g. shipping@cobalt.hk"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              Auto-filled when you test the connection. You can also enter it manually.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Auto-sync</p>
              <p className="text-xs text-text-muted">Polls for new emails every 5 minutes when enabled</p>
            </div>
            <button
              onClick={() => setIsActive(!isActive)}
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                isActive ? 'bg-cobalt-primary' : 'bg-surface-600'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                  isActive ? 'left-[22px]' : 'left-0.5'
                )}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testConnection.isPending || (!tenantId && !config)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          {testConnection.isPending ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Zap size={14} />
          )}
          {testConnection.isPending ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          onClick={handleSync}
          disabled={syncEmails.isPending || !config}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          {syncEmails.isPending ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {syncEmails.isPending ? 'Syncing...' : 'Sync Now'}
        </button>
        <button
          onClick={handleSave}
          disabled
          title="Graph credentials are managed in the ingestion service (graph_api), not stored in the tracking app"
          className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {/* Test / Sync result messages */}
      {testConnection.data && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg border p-3 text-sm',
          testConnection.data.success
            ? 'border-status-success/30 bg-status-success/10 text-status-success'
            : 'border-status-critical/30 bg-status-critical/10 text-status-critical'
        )}>
          {testConnection.data.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
          <div>
            <p>{testConnection.data.message}</p>
            {testConnection.data.detectedMailbox && (
              <p className="mt-1 text-xs opacity-80">
                Detected mailbox: {testConnection.data.detectedMailbox}
              </p>
            )}
          </div>
        </div>
      )}
      {testConnection.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <p>{(testConnection.error as Error)?.message || 'Connection test failed'}</p>
        </div>
      )}
      {syncEmails.data && (
        <div className="rounded-lg border border-border bg-surface-800 p-3 text-sm text-text-secondary">
          <p>
            Sync complete: {syncEmails.data.synced} email{syncEmails.data.synced !== 1 ? 's' : ''} synced
            {syncEmails.data.skipped > 0 && `, ${syncEmails.data.skipped} skipped`}
            {syncEmails.data.errors.length > 0 && `, ${syncEmails.data.errors.length} error${syncEmails.data.errors.length !== 1 ? 's' : ''}`}
          </p>
          {syncEmails.data.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-status-critical">
              {syncEmails.data.errors.slice(0, 3).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {syncEmails.data.errors.length > 3 && (
                <li>...and {syncEmails.data.errors.length - 3} more</li>
              )}
            </ul>
          )}
        </div>
      )}
      {saveConfig.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <p>{(saveConfig.error as Error)?.message || 'Failed to save configuration'}</p>
        </div>
      )}
      {saveConfig.isSuccess && !testConnection.data && !syncEmails.data && (
        <div className="flex items-start gap-2 rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm text-status-success">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <p>Configuration saved successfully.</p>
        </div>
      )}

      {/* Setup Guide */}
      <div className="rounded-lg border border-border">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          <span>Setup Guide — How to configure Azure AD</span>
          {showGuide ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {showGuide && (
          <div className="border-t border-border px-4 py-3">
            <ol className="list-inside list-decimal space-y-2 text-xs text-text-secondary">
              <li>
                Go to{' '}
                <span className="font-mono text-text-primary">https://portal.azure.com</span>{' '}
                and sign in with your organizational account.
              </li>
              <li>
                Navigate to <span className="font-semibold text-text-primary">Azure Active Directory</span> →{' '}
                <span className="font-semibold text-text-primary">App registrations</span> →{' '}
                <span className="font-semibold text-text-primary">New registration</span>.
              </li>
              <li>
                Give it a name (e.g. "Cobalt Track Email Sync"), select "Accounts in this organizational directory only",
                and click <span className="font-semibold text-text-primary">Register</span>.
              </li>
              <li>
                On the app's page, copy the <span className="font-semibold text-text-primary">Application (client) ID</span>{' '}
                and <span className="font-semibold text-text-primary">Directory (tenant) ID</span> — paste them above.
              </li>
              <li>
                Go to <span className="font-semibold text-text-primary">API permissions</span> →{' '}
                <span className="font-semibold text-text-primary">Add a permission</span> →{' '}
                <span className="font-semibold text-text-primary">Microsoft Graph</span> →{' '}
                <span className="font-semibold text-text-primary">Application permissions</span> →{' '}
                search for and check <span className="font-mono text-text-primary">Mail.Read</span> →{' '}
                click <span className="font-semibold text-text-primary">Add permission</span>.
              </li>
              <li>
                Click <span className="font-semibold text-text-primary">Grant admin consent</span> for the permission.
              </li>
              <li>
                Go to <span className="font-semibold text-text-primary">Certificates & secrets</span> →{' '}
                <span className="font-semibold text-text-primary">New client secret</span> → give it a description
                and expiry → copy the <span className="font-semibold text-text-primary">Value</span> (this is your Client Secret).
              </li>
              <li>
                Paste the Client Secret above, then click <span className="font-semibold text-text-primary">Test Connection</span> to verify everything works.
              </li>
            </ol>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="text-sm text-text-muted">Loading configuration...</div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const location = useLocation()
  const isAlertsSettings = location.pathname.includes('/settings/alerts')
  const isVendorsSettings = location.pathname.includes('/settings/vendors')
  const isEmailSettings = location.pathname.includes('/settings/email')

  return (
    <div className="flex gap-6">
      {/* Settings Nav */}
      <nav className="w-48 shrink-0 space-y-1">
        {[
          { to: '/settings', label: 'General', end: true },
          { to: '/settings/email', label: 'Email Integration', end: false },
          { to: '/settings/alerts', label: 'Alert Rules', end: false },
          { to: '/settings/vendors', label: 'Vendors', end: false },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-cobalt-primary/15 text-cobalt-primary'
                  : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary'
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Settings Content */}
      <div className="flex-1">
        {isEmailSettings ? (
          <EmailIntegrationSettings />
        ) : isAlertsSettings ? (
          <AlertRulesSettings />
        ) : isVendorsSettings ? (
          <VendorsSettings />
        ) : (
          <div>
            <h2 className="text-base font-semibold text-text-primary">General Settings</h2>
            <p className="mt-2 text-sm text-text-secondary">
              Application settings will be configured here. Email connection, user management,
              and API configuration will be available in future updates.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
