import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import { usePageAccess } from '../../hooks/use-page-access'
import { toast } from '../ui/Toast'
import { DaysStepper } from './DaysStepper'

interface AlertRule {
  id: string
  name: string
  description: string | null
  /** Backend may return null when the rule has no mapped staircase state. */
  state: string | null
  triggerType: string
  triggerReference: string
  thresholdDays: number
  /** Absolute days per origin country (as stored by the API). Empty/null = use default. */
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

/** POC A1–A6 configurable threshold rules. A7 is built-in and hidden here. */
const CONFIGURABLE_RULE_IDS = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
/** Country absolute-day overrides only for cut-off / Draft B/L rules. */
const COUNTRY_OVERRIDE_RULE_IDS = new Set(['A2', 'A3'])

const ALERT_COUNTRY_LIST = [
  { code: 'CN', label: 'China' },
  { code: 'BD', label: 'Bangladesh' },
  { code: 'KH', label: 'Cambodia' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'IN', label: 'India' },
  { code: 'LK', label: 'Sri Lanka' },
]

/** Human label for the default days control. */
function thresholdLabel(rule: AlertRule): string {
  const before = rule.triggerType === 'days_before'
  switch (rule.triggerReference) {
    case 'booking_request':
      return before ? 'Days before booking' : 'Days after booking'
    case 'cutoff':
      return before ? 'Days before cut-off' : 'Days after cut-off'
    case 'draft_bl':
      return before ? 'Days before Draft B/L' : 'Days after Draft B/L'
    case 'final_bl':
      return before ? 'Days before Final B/L' : 'Days after Final B/L'
    case 'eta':
      return before ? 'Days before ETA' : 'Days after ETA'
    case 'etd':
      return before ? 'Days before ETD' : 'Days after ETD'
    default:
      return before ? 'Days before' : 'Days after'
  }
}

function normalizeRules(rules: AlertRule[]): AlertRule[] {
  return rules.map((r) => ({
    ...r,
    countryThresholds: r.countryThresholds
      ? typeof r.countryThresholds === 'string'
        ? (JSON.parse(r.countryThresholds as unknown as string) as Record<string, number>)
        : r.countryThresholds
      : null,
  }))
}

export function AlertRulesSettings() {
  const id = useId()
  const { data, isLoading } = useQuery<{ rules: AlertRule[] }>({
    queryKey: ['alertRules'],
    queryFn: () => api.get('/alert-rules'),
  })
  const qc = useQueryClient()
  const { canEdit: canEditPage } = usePageAccess()
  const canEdit = canEditPage('alert_rules')
  const serverRules = useMemo(
    () => (data?.rules ? normalizeRules(data.rules) : null),
    [data],
  )
  const [draft, setDraft] = useState<AlertRule[] | null>(null)
  const [serverSnap, setServerSnap] = useState(serverRules)
  if (serverRules !== serverSnap) {
    setServerSnap(serverRules)
    setDraft(null)
  }
  // Keep full list for save so we never drop A7 from the API payload.
  const allRules = draft ?? serverRules ?? []
  const allRulesRef = useRef(allRules)
  allRulesRef.current = allRules
  const localRules = allRules
    .filter((r) => CONFIGURABLE_RULE_IDS.has(r.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  const dirty = draft !== null

  const saveRules = useMutation({
    mutationFn: (rules: AlertRule[]) =>
      api.put('/alert-rules', {
        rules: rules.map((rule) => {
          const ct = rule.countryThresholds
          const cleaned =
            ct && Object.keys(ct).length > 0
              ? Object.fromEntries(
                  Object.entries(ct).filter(([, days]) => typeof days === 'number' && days > 0),
                )
              : null
          return {
            ...rule,
            countryThresholds: cleaned && Object.keys(cleaned).length > 0 ? cleaned : null,
          }
        }),
      }) as Promise<{
        rules: AlertRule[]
        eval?: { evaluated: number; fired: number; resolved: number } | null
      }>,
    onSuccess: () => {
      setDraft(null)
      toast.success('Saved')
      qc.invalidateQueries({ queryKey: ['alertRules'] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message.replace(/^API error \d+:\s*/i, '') : 'Save failed'
      toast.error(msg || 'Save failed')
    },
  })

  const updateRule = (ruleId: string, field: string, value: number | string | boolean) => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => (r.id === ruleId ? { ...r, [field]: value } : r)),
    )
  }

  const updateCountryDays = (ruleId: string, code: string, days: number | '') => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => {
        if (r.id !== ruleId) return r
        const ct = { ...(r.countryThresholds ?? {}) }
        if (days === '' || days === 0) delete ct[code]
        else ct[code] = days
        return { ...r, countryThresholds: Object.keys(ct).length > 0 ? ct : null }
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
            onClick={() => {
              // Flush focused DaysStepper input, then save latest draft (ref avoids stale closure).
              ;(document.activeElement as HTMLElement | null)?.blur?.()
              window.setTimeout(() => saveRules.mutate(allRulesRef.current), 0)
            }}
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
          const showCountry = COUNTRY_OVERRIDE_RULE_IDS.has(rule.id)
          return (
            <Card key={rule.id} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="rounded-md bg-surface-700 px-2 py-0.5 font-mono text-[11px] font-semibold text-text-muted">
                    {rule.id}
                  </span>
                  <h3 className="text-sm font-semibold text-text-primary">{rule.name}</h3>
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

              {!rule.locked && (
                <div className="mt-4 flex flex-wrap items-end gap-6">
                  <div>
                    <label
                      htmlFor={`${id}-${rule.id}-threshold`}
                      className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-text-muted"
                    >
                      {thresholdLabel(rule)} (default)
                    </label>
                    <DaysStepper
                      id={`${id}-${rule.id}-threshold`}
                      aria-label={thresholdLabel(rule)}
                      value={rule.thresholdDays}
                      min={0}
                      max={30}
                      disabled={!canEdit}
                      onChange={(next) => updateRule(rule.id, 'thresholdDays', next ?? 0)}
                    />
                  </div>
                  <div className="min-w-[10rem]">
                    <label
                      htmlFor={`${id}-${rule.id}-severity`}
                      className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-text-muted"
                    >
                      Severity
                    </label>
                    <select
                      id={`${id}-${rule.id}-severity`}
                      value={rule.severity}
                      onChange={(e) => updateRule(rule.id, 'severity', e.target.value)}
                      disabled={!canEdit}
                      className="h-12 w-full rounded-2xl border border-border bg-surface-700 px-3 text-sm text-text-primary disabled:opacity-50"
                    >
                      <option value="CRITICAL">Critical</option>
                      <option value="WARNING">Warning</option>
                      <option value="INFO">Info</option>
                    </select>
                  </div>
                </div>
              )}

              {showCountry && !rule.locked && (
                <div className="mt-5 rounded-xl border border-border bg-surface-900/40 p-4">
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-text-secondary">Days by origin country</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Absolute days for that origin (overrides the default of {rule.thresholdDays}).
                      Tap − until <span className="font-medium">Default</span> to inherit the rule
                      default.
                    </p>
                  </div>
                  <div
                    id={`${id}-${rule.id}-country`}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    {ALERT_COUNTRY_LIST.map((country) => {
                      const raw = rule.countryThresholds?.[country.code]
                      const days = typeof raw === 'number' && raw > 0 ? raw : null
                      const active = days != null
                      return (
                        <div
                          key={country.code}
                          className={cn(
                            'flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition-colors',
                            active
                              ? 'border-cobalt-primary/40 bg-cobalt-primary/10'
                              : 'border-border bg-surface-800/50',
                          )}
                        >
                          <span className="min-w-0 truncate">
                            <span className="block text-sm font-semibold text-text-primary">
                              {country.code}
                            </span>
                            <span className="block text-xs text-text-muted">{country.label}</span>
                          </span>
                          <DaysStepper
                            size="sm"
                            optional
                            emptyLabel="Default"
                            aria-label={`${country.label} days`}
                            value={days}
                            min={1}
                            max={30}
                            disabled={!canEdit}
                            onChange={(next) =>
                              updateCountryDays(rule.id, country.code, next == null ? '' : next)
                            }
                          />
                        </div>
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
          No configurable alert rules (A1–A6) available.
        </p>
      )}
    </div>
  )
}
