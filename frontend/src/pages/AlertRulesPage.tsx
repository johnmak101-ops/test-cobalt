import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card } from '../components/ui/Card'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'
import { cn } from '../lib/utils'
import { ArrowLeft, Lock } from 'lucide-react'

interface AlertRule {
  id: string
  name: string
  description: string
  state: string
  triggerType: string
  triggerReference: string
  thresholdDays: number
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

const COUNTRY_LIST = [
  { code: 'CN', label: 'China' },
  { code: 'BD', label: 'Bangladesh' },
  { code: 'KH', label: 'Cambodia' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'IN', label: 'India' },
  { code: 'LK', label: 'Sri Lanka' },
]

const STATE_LABELS: Record<string, string> = {
  BOOKED: 'Booked',
  CONFIRMED: 'Confirmed',
  AT_WAREHOUSE: 'At Warehouse',
  SAILED: 'Sailed',
  DEPARTED: 'Departure',
  ARRIVED: 'Delivered',
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-status-critical/15 text-status-critical',
  WARNING: 'bg-status-warning/15 text-status-warning',
  INFO: 'bg-status-info/15 text-status-info',
}

export default function AlertRulesPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  // Alert-rule editing is restricted to ADMIN or higher (paired with the backend PUT guard in ui.controllers.ts).
  const canEdit = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'
  const { data, isLoading } = useQuery<{ rules: AlertRule[] }>({
    queryKey: ['alertRules'],
    queryFn: () => api.get('/alert-rules'),
  })
  const qc = useQueryClient()
  const [localRules, setLocalRules] = useState<AlertRule[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data?.rules) {
      setLocalRules(
        data.rules.map((r: AlertRule) => ({
          ...r,
          countryThresholds: r.countryThresholds
            ? typeof r.countryThresholds === 'string'
              ? JSON.parse(r.countryThresholds)
              : r.countryThresholds
            : {},
        }))
      )
      setDirty(false)
    }
  }, [data])

  const saveRules = useMutation({
    mutationFn: (rules: AlertRule[]) =>
      api.put('/alert-rules', {
        rules: rules.map((r) => ({
          ...r,
          countryThresholds:
            r.countryThresholds && Object.keys(r.countryThresholds).length > 0
              ? JSON.stringify(r.countryThresholds)
              : null,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules'] })
      setDirty(false)
    },
  })

  const updateRule = (id: string, field: string, value: number | string | boolean) => {
    if (!canEdit) return
    setLocalRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
    setDirty(true)
  }

  const updateCountryThreshold = (ruleId: string, countryCode: string, days: number | '') => {
    if (!canEdit) return
    setLocalRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r
        const ct = { ...(r.countryThresholds || {}) }
        if (days === '' || days === 0) {
          delete ct[countryCode]
        } else {
          ct[countryCode] = days as number
        }
        return { ...r, countryThresholds: Object.keys(ct).length > 0 ? ct : null }
      })
    )
    setDirty(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => navigate('/alerts')}
            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Alert Rules</h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {canEdit
                ? 'Configure when alerts are triggered for each shipment state'
                : 'How alerts are triggered for each shipment state'}
            </p>
          </div>
        </div>
        {!canEdit && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-muted">
            <Lock size={13} />
            View only · an admin can edit
          </span>
        )}
      </div>

      {/* Rules */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-text-muted">
          Loading alert rules...
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {localRules.map((rule) => (
              <Card key={rule.id}>
                {/* Top row: name, severity badge, enabled toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span className="font-mono text-xs text-text-muted">{rule.id}</span>
                    <h4 className="text-sm font-semibold text-text-primary">{rule.name}</h4>
                    {rule.locked && (
                      <span className="rounded bg-status-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
                        LOCKED
                      </span>
                    )}
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', SEVERITY_COLORS[rule.severity] ?? 'bg-surface-700 text-text-muted')}>
                      {rule.severity}
                    </span>
                  </div>
                  <button
                    onClick={() => !rule.locked && updateRule(rule.id, 'enabled', !rule.enabled)}
                    disabled={rule.locked || !canEdit}
                    className={cn(
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                      rule.enabled ? 'bg-cobalt-primary' : 'bg-surface-600',
                      (rule.locked || !canEdit) && 'cursor-not-allowed opacity-50'
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

                {/* Description */}
                <p className="mt-1 text-xs text-text-secondary">{rule.description}</p>

                {/* Settings row */}
                <div className="mt-4 flex flex-wrap items-end gap-6">
                  <div>
                    <label className="text-xs text-text-muted">Default threshold (days)</label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={rule.thresholdDays}
                      onChange={(e) =>
                        !rule.locked &&
                        updateRule(rule.id, 'thresholdDays', parseInt(e.target.value) || 0)
                      }
                      disabled={rule.locked || !canEdit}
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
                      disabled={rule.locked || !canEdit}
                      className="mt-1 h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="CRITICAL">Critical</option>
                      <option value="WARNING">Warning</option>
                      <option value="INFO">Info</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">State</label>
                    <p className="mt-1 flex h-9 items-center text-sm text-text-secondary">
                      {rule.state ? (STATE_LABELS[rule.state] ?? rule.state.replace(/_/g, ' ')) : '—'}
                    </p>
                  </div>
                </div>

                {/* Country-specific thresholds */}
                {!rule.locked && (
                  <div className="mt-4 rounded-lg border border-border bg-surface-800/50 p-3">
                    <label className="text-xs font-medium text-text-secondary">
                      Country thresholds
                    </label>
                    <p className="text-[10px] text-text-muted">
                      Override default threshold when shipment origin country matches
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {COUNTRY_LIST.map((country) => {
                        const currentDays = rule.countryThresholds?.[country.code]
                        return (
                          <div key={country.code} className="flex items-center gap-2">
                            <span className="w-6 text-[11px] font-semibold text-text-muted">{country.code}</span>
                            <span className="w-24 text-xs text-text-secondary">{country.label}</span>
                            <input
                              type="number"
                              min={0}
                              max={30}
                              value={currentDays ?? ''}
                              onChange={(e) => {
                                const val = e.target.value
                                if (val === '') {
                                  updateCountryThreshold(rule.id, country.code, '')
                                } else {
                                  updateCountryThreshold(rule.id, country.code, parseInt(val) || 0)
                                }
                              }}
                              placeholder={String(rule.thresholdDays)}
                              disabled={!canEdit}
                              className="h-7 w-14 rounded border border-border bg-surface-700 px-2 text-xs text-text-primary placeholder:text-text-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <span className="text-[11px] text-text-muted">days</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* Actions — admin or higher (backend rejects a lower-role PUT anyway) */}
          {canEdit && (
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={() => {
                if (data?.rules) {
                  setLocalRules(
                    data.rules.map((r: AlertRule) => ({
                      ...r,
                      countryThresholds: r.countryThresholds
                        ? typeof r.countryThresholds === 'string'
                          ? JSON.parse(r.countryThresholds)
                          : r.countryThresholds
                        : {},
                    }))
                  )
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
          )}
        </>
      )}
    </div>
  )
}