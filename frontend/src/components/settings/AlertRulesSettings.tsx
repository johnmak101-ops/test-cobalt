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

const STATE_LABELS: Record<string, string> = {
  BOOKED: 'Booked',
  CONFIRMED: 'Confirmed',
  AT_WAREHOUSE: 'At warehouse',
  SAILED: 'Sailed',
  DEPARTED: 'Departure',
  ARRIVED: 'Delivered',
}

const SEVERITY_CHIP: Record<string, string> = {
  CRITICAL: 'bg-status-critical/15 text-status-critical border-status-critical/30',
  WARNING: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  INFO: 'bg-status-info/15 text-status-info border-status-info/30',
}

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

  const updateRule = (ruleId: string, field: string, value: number | string | boolean) => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => (r.id === ruleId ? { ...r, [field]: value } : r)),
    )
  }

  const updateCountryOffset = (ruleId: string, code: string, offset: number | '') => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => {
        if (r.id !== ruleId) return r
        const offs = { ...(r.countryOffsets ?? {}) }
        if (offset === '' || offset === 0) delete offs[code]
        else offs[code] = offset
        return { ...r, countryOffsets: offs }
      }),
    )
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading alert rules…</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">Alert rules</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Day thresholds and severity for A1 / A2. Changes apply on save.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={!dirty}
            className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => saveRules.mutate(allRules)}
            disabled={!canEdit || !dirty || saveRules.isPending}
            className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
          >
            {saveRules.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {!canEdit && (
        <p className="text-xs text-text-muted">You have view-only access to Alert Rules.</p>
      )}

      <div className="space-y-4">
        {localRules.map((rule) => {
          const stateLabel = rule.state
            ? (STATE_LABELS[rule.state] ?? rule.state.replace(/_/g, ' '))
            : null
          const triggerWord = rule.triggerType === 'days_before' ? 'before' : 'after'
          return (
            <Card key={rule.id} className="overflow-hidden">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="rounded-md bg-surface-700 px-2 py-0.5 font-mono text-[11px] font-semibold text-text-muted">
                    {rule.id}
                  </span>
                  <h3 className="text-sm font-semibold text-text-primary">{rule.name}</h3>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      SEVERITY_CHIP[rule.severity] ?? 'border-border bg-surface-700 text-text-muted',
                    )}
                  >
                    {rule.severity}
                  </span>
                  {stateLabel && (
                    <span className="rounded-full border border-border bg-surface-800 px-2 py-0.5 text-[11px] text-text-secondary">
                      When: {stateLabel}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Toggle ${rule.name} enabled`}
                  onClick={() => !rule.locked && canEdit && updateRule(rule.id, 'enabled', !rule.enabled)}
                  disabled={rule.locked || !canEdit}
                  className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                    rule.enabled ? 'bg-cobalt-primary' : 'bg-surface-600',
                    (rule.locked || !canEdit) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                      rule.enabled ? 'left-[22px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>

              {rule.description && (
                <p className="mt-3 text-xs leading-relaxed text-text-muted">{rule.description}</p>
              )}

              {/* Primary controls — horizontal form row */}
              {!rule.locked && (
                <div className="mt-4 flex flex-wrap items-end gap-4">
                  <div className="min-w-[7.5rem]">
                    <label
                      htmlFor={`${id}-${rule.id}-threshold`}
                      className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-text-muted"
                    >
                      Days {triggerWord}
                    </label>
                    <div className="flex items-center gap-2">
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
                        className="h-10 w-16 rounded-lg border border-border bg-surface-700 px-3 text-center text-sm font-medium text-text-primary disabled:opacity-50"
                      />
                      <span className="text-xs text-text-muted">days</span>
                    </div>
                  </div>
                  <div className="min-w-[9rem]">
                    <label
                      htmlFor={`${id}-${rule.id}-severity`}
                      className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-text-muted"
                    >
                      Severity
                    </label>
                    <select
                      id={`${id}-${rule.id}-severity`}
                      value={rule.severity}
                      onChange={(e) => updateRule(rule.id, 'severity', e.target.value)}
                      disabled={!canEdit}
                      className="h-10 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:opacity-50"
                    >
                      <option value="CRITICAL">Critical</option>
                      <option value="WARNING">Warning</option>
                      <option value="INFO">Info</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Country offsets */}
              {!rule.locked && (
                <div className="mt-5 rounded-xl border border-border bg-surface-900/40 p-4">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-text-secondary">Extra days by origin</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        Added to the default ({rule.thresholdDays}d). Leave empty for no extra.
                      </p>
                    </div>
                  </div>
                  <div
                    id={`${id}-${rule.id}-country`}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {ALERT_COUNTRY_LIST.map((country) => {
                      const off = rule.countryOffsets?.[country.code]
                      const active = off != null && off > 0
                      return (
                        <label
                          key={country.code}
                          className={cn(
                            'flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors',
                            active
                              ? 'border-cobalt-primary/40 bg-cobalt-primary/10'
                              : 'border-border bg-surface-800/50 hover:border-border hover:bg-surface-700/40',
                          )}
                        >
                          <span className="min-w-0 truncate text-xs">
                            <span className="font-semibold text-text-primary">{country.code}</span>
                            <span className="ml-1.5 text-text-muted">{country.label}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-[11px] text-text-muted">+</span>
                            <input
                              type="number"
                              min={0}
                              max={30}
                              value={off ?? ''}
                              disabled={!canEdit}
                              onChange={(e) => {
                                const v = e.target.value
                                updateCountryOffset(
                                  rule.id,
                                  country.code,
                                  v === '' ? '' : parseInt(v) || 0,
                                )
                              }}
                              placeholder="0"
                              className="h-8 w-12 rounded-md border border-border bg-surface-700 px-1.5 text-center text-xs font-medium text-text-primary placeholder:text-text-muted/40 disabled:opacity-50"
                            />
                            <span className="w-7 text-[11px] text-text-muted">d</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {localRules.length === 0 && (
        <p className="rounded-lg border border-border bg-surface-800/40 px-4 py-8 text-center text-sm text-text-muted">
          No configurable alert rules (A1 / A2) available.
        </p>
      )}
    </div>
  )
}
