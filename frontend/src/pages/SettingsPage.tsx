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
import { Upload, Plus, Trash2, Factory } from 'lucide-react'

interface AlertRule {
  id: string
  name: string
  description: string
  state: string
  triggerType: string
  triggerReference: string
  thresholdDays: number
  severity: string
  enabled: boolean
  locked: boolean
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
      setLocalRules(data.rules)
      setDirty(false)
    }
  }, [data])

  const saveRules = useMutation({
    mutationFn: (rules: AlertRule[]) => api.put('/alert-rules', { rules }),
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

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading alert rules...</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Alert Rules Configuration</h2>
        <p className="text-sm text-text-secondary">
          Configure when alerts are triggered for each shipment state. Changes take effect
          immediately.
        </p>
      </div>

      <div className="space-y-3">
        {localRules.map((rule) => (
          <Card key={rule.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-text-muted">{rule.id}</span>
                  <h4 className="text-sm font-semibold text-text-primary">{rule.name}</h4>
                  {rule.locked && (
                    <span className="rounded bg-status-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
                      LOCKED
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-text-secondary">{rule.description}</p>
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

            <div className="mt-4 flex flex-wrap items-center gap-4">
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
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={() => {
            if (data?.rules) {
              setLocalRules(data.rules)
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
            Manage vendor and factory records. Import from CSV or add manually.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowCsvImport(!showCsvImport)
              setShowCreate(false)
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            <Upload size={13} />
            CSV Import
          </button>
          <button
            onClick={() => {
              setShowCreate(!showCreate)
              setShowCsvImport(false)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light"
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

export default function SettingsPage() {
  const location = useLocation()
  const isAlertsSettings = location.pathname.includes('/settings/alerts')
  const isVendorsSettings = location.pathname.includes('/settings/vendors')

  return (
    <div className="flex gap-6">
      {/* Settings Nav */}
      <nav className="w-40 shrink-0 space-y-1">
        {[
          { to: '/settings', label: 'General', end: true },
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
        {isAlertsSettings ? (
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
