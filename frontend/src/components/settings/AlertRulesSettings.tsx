import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import { usePageAccess } from '../../hooks/use-page-access'

interface AlertRule {
  id: string
  name: string
  description: string | null
  /** Backend may return null when the rule has no mapped staircase state. */
  state: string | null
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
  const id = useId()
  const { data, isLoading } = useQuery<{ rules: AlertRule[] }>({
    queryKey: ['alertRules'],
    queryFn: () => api.get('/alert-rules'),
  })
  const qc = useQueryClient()
  const { canEdit: canEditPage } = usePageAccess()
  const canEdit = canEditPage('alert_rules') // Access Control matrix; backend @PageWrite is authoritative
  const serverRules = useMemo(
    () => (data?.rules ? withOffsets(data.rules) : null),
    [data],
  )
  const [draft, setDraft] = useState<AlertRule[] | null>(null)
  const [serverSnap, setServerSnap] = useState(serverRules)
  if (serverRules !== serverSnap) {
    setServerSnap(serverRules)
    setDraft(null)
  }
  // Only threshold rules A1/A2 are listed in Settings. Built-ins (e.g. A7 LOCKED) still
  // evaluate in the backend but must not show noise (0 days / State —) in this UI.
  // Keep full list for save so we never drop A3–A7 from the API payload.
  const CONFIGURABLE_RULE_IDS = new Set(['A1', 'A2'])
  const allRules = draft ?? serverRules ?? []
  const localRules = allRules.filter((r) => CONFIGURABLE_RULE_IDS.has(r.id))
  const dirty = draft !== null

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
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['alertRules'] })
    },
  })

  const updateRule = (id: string, field: string, value: number | string | boolean) => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    )
  }

  const updateCountryOffset = (id: string, code: string, offset: number | '') => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => {
        if (r.id !== id) return r
        const offs = { ...(r.countryOffsets ?? {}) }
        if (offset === '' || offset === 0) delete offs[code]
        else offs[code] = offset
        return { ...r, countryOffsets: offs }
      }),
    )
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
                type="button"
                aria-label={`Toggle ${rule.name} enabled`}
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

            {/* Threshold / severity / country — only meaningful for day-based rules (A1/A2). */}
            {!rule.locked && (
            <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <label htmlFor={`${id}-${rule.id}-threshold`} className="text-xs text-text-muted">
                  Trigger {rule.triggerType === 'days_before' ? 'before' : 'after'} (days)
                </label>
                <input
                  id={`${id}-${rule.id}-threshold`}
                  type="number"
                  min={0}
                  max={30}
                  value={rule.thresholdDays}
                  onChange={(e) =>
                    updateRule(rule.id, 'thresholdDays', parseInt(e.target.value) || 0)
                  }
                  disabled={!canEdit}
                  className="mt-1 h-9 w-20 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor={`${id}-${rule.id}-severity`} className="text-xs text-text-muted">Severity</label>
                <select
                  id={`${id}-${rule.id}-severity`}
                  value={rule.severity}
                  onChange={(e) =>
                    updateRule(rule.id, 'severity', e.target.value)
                  }
                  disabled={!canEdit}
                  className="mt-1 h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="CRITICAL">Critical</option>
                  <option value="WARNING">Warning</option>
                  <option value="INFO">Info</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-${rule.id}-state`} className="text-xs text-text-muted">State</label>
                <p id={`${id}-${rule.id}-state`} className="mt-1 h-9 flex items-center text-sm text-text-secondary">
                  {rule.state ? rule.state.replace(/_/g, ' ') : '—'}
                </p>
              </div>
            </div>
            )}

            {/* Per-country warning days — extra days added to the default for a given origin country */}
            {!rule.locked && (
              <div className="mt-5 rounded-lg border border-border bg-surface-800/50 p-3.5">
                <label htmlFor={`${id}-${rule.id}-country`} className="text-xs font-medium text-text-secondary">Country warning days</label>
                <p className="mt-0.5 text-[10px] text-text-muted">
                  Extra days before this alert fires, by shipment origin country (added to the default of{' '}
                  {rule.thresholdDays} {rule.thresholdDays === 1 ? 'day' : 'days'}). Leave blank for none.
                </p>
                <div id={`${id}-${rule.id}-country`} className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
      {!canEdit && (
        <p className="pt-2 text-right text-xs text-text-muted">You have view-only access to Alert Rules.</p>
      )}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => setDraft(null)}
          disabled={!dirty}
          className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          Reset to Defaults
        </button>
        <button
          type="button"
          onClick={() => saveRules.mutate(allRules)}
          disabled={!canEdit || !dirty || saveRules.isPending}
          className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
        >
          {saveRules.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
