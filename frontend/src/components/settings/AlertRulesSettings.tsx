import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'

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

export function AlertRulesSettings() {
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
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-text-muted">{rule.id}</span>
                <h4 className="truncate text-sm font-semibold text-text-primary">{rule.name}</h4>
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
