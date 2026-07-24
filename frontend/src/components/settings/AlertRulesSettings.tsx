import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/utils'
import { usePageAccess } from '../../hooks/use-page-access'
import { toast } from '../ui/Toast'
import { DaysStepper } from './DaysStepper'

interface AlertRule {
  id: string
  name: string
  description: string | null
  state: string | null
  triggerType: string
  triggerReference: string
  thresholdDays: number
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'INFO', label: 'Info' },
]

const ALERT_COUNTRY_LIST = [
  { code: 'CN', label: 'China' },
  { code: 'BD', label: 'Bangladesh' },
  { code: 'KH', label: 'Cambodia' },
]

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

function apiError(e: unknown, fallback: string) {
  const msg = e instanceof Error ? e.message.replace(/^API error \d+:\s*/i, '') : fallback
  return msg || fallback
}

/**
 * One card per editable rule: a single days-after-ETD threshold + a chosen severity, with
 * per-rule country-of-origin overrides. Locked rows (the retired A2/A4 critical tiers and the
 * built-in A7) are hidden here and skipped server-side.
 */
export function AlertRulesSettings() {
  const id = useId()
  const { data, isLoading } = useQuery<{ rules: AlertRule[] }>({
    queryKey: ['alertRules'],
    queryFn: () => api.get('/alert-rules'),
  })
  const qc = useQueryClient()
  const { canEdit: canEditPage } = usePageAccess()
  const canEdit = canEditPage('alert_rules')
  const serverRules = useMemo(() => (data?.rules ? normalizeRules(data.rules) : null), [data])
  const [draft, setDraft] = useState<AlertRule[] | null>(null)
  const [serverSnap, setServerSnap] = useState(serverRules)
  if (serverRules !== serverSnap) {
    setServerSnap(serverRules)
    setDraft(null)
  }
  const allRules = draft ?? serverRules ?? []
  const visibleRules = allRules.filter((r) => !r.locked)
  const dirty = draft !== null

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alertRules'] })
    qc.invalidateQueries({ queryKey: ['alerts'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const saveRules = useMutation({
    // Server owns identity fields; send only what is editable (the whitelist pipe strips the rest anyway).
    mutationFn: (rules: AlertRule[]) =>
      api.put('/alert-rules', {
        rules: rules.flatMap((r) =>
          r.locked
            ? []
            : [
                {
                  id: r.id,
                  thresholdDays: r.thresholdDays,
                  severity: r.severity,
                  enabled: r.enabled,
                  countryThresholds: r.countryThresholds,
                },
              ],
        ),
      }),
    onSuccess: () => {
      setDraft(null)
      toast.success('Saved')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e, 'Save failed')),
  })

  const updateRule = (ruleId: string, patch: Partial<AlertRule>) => {
    setDraft((prev) => (prev ?? serverRules ?? []).map((r) => (r.id === ruleId ? { ...r, ...patch } : r)))
  }

  /** Per-rule absolute days-after-ETD for that origin; null/0 clears the override. */
  const updateCountryDays = (ruleId: string, code: string, days: number | null) => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => {
        if (r.id !== ruleId) return r
        const ct = { ...(r.countryThresholds ?? {}) }
        if (days == null || days <= 0) delete ct[code]
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
          <h2 className="text-lg font-semibold text-text-primary">Alert Rules</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Both rules fire a set number of days after ETD — pick the threshold and severity.
          </p>
        </div>
        {/* No "Reset to Defaults" button: it did not work from the UI, and the two thresholds it
            restored are quicker to retype than to trust. POST /alert-rules/reset went with it —
            `pnpm seed` is the way back to factory thresholds. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => saveRules.mutate(allRules)}
            disabled={!canEdit || !dirty || saveRules.isPending}
            className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
          >
            {saveRules.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {!canEdit && <p className="text-xs text-text-muted">You have view-only access to Alert Rules.</p>}

      {visibleRules.length === 0 && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          No editable alert rules found. Run the backend seed, then reload.
        </p>
      )}

      <div className="space-y-4">
        {visibleRules.map((rule) => (
          <Card key={rule.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
              {/* No rule.id chip ("A1"/"A3"): the code is an internal key, meaningless to the
                  operator reading the card. It still keys the row and the PUT payload. */}
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h3 className="text-sm font-semibold text-text-primary">{rule.name}</h3>
                <Badge variant="severity" value={rule.severity} />
              </div>
              <button
                type="button"
                aria-label={`Toggle ${rule.name} enabled`}
                onClick={() => canEdit && updateRule(rule.id, { enabled: !rule.enabled })}
                disabled={!canEdit}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                  rule.enabled ? 'bg-cobalt-primary' : 'bg-surface-600',
                  !canEdit && 'cursor-not-allowed opacity-50',
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

            <div className="mt-4 flex flex-wrap items-end gap-8">
              <div>
                <label
                  htmlFor={`${id}-${rule.id}-days`}
                  className="mb-2 block text-[11px] font-medium text-text-secondary"
                >
                  Threshold — Days After ETD
                </label>
                <DaysStepper
                  id={`${id}-${rule.id}-days`}
                  aria-label={`${rule.name} days after ETD`}
                  value={rule.thresholdDays}
                  min={0}
                  max={30}
                  disabled={!canEdit}
                  onChange={(next) => updateRule(rule.id, { thresholdDays: next ?? 0 })}
                />
              </div>
              <div>
                <label
                  htmlFor={`${id}-${rule.id}-severity`}
                  className="mb-2 block text-[11px] font-medium text-text-secondary"
                >
                  Severity
                </label>
                <select
                  id={`${id}-${rule.id}-severity`}
                  aria-label={`${rule.name} severity`}
                  value={rule.severity}
                  disabled={!canEdit}
                  onChange={(e) => updateRule(rule.id, { severity: e.target.value })}
                  className="h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none disabled:opacity-50"
                >
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-surface-900/40 p-4">
              <div className="mb-3">
                <p className="text-xs font-semibold text-text-secondary">Custom Days</p>
                {/* The country list and the "tap − until Default" hint are dropped: the three tiles
                    below ARE the list, and each already reads "Default" until it is overridden. */}
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Overrides this rule’s days-after-ETD threshold when the shipment’s origin matches.
                </p>
              </div>
              {/* auto-fit, not a breakpoint: a tile needs 32px padding + the 168px fixed-width
                  DaysStepper + room for the label, so columns may only form at >=272px. sm:grid-cols-3
                  split at 640px and the un-shrinkable stepper then overflowed onto the next tile. */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(272px,100%),1fr))] gap-3">
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
                        <span className="block text-sm font-semibold text-text-primary">{country.code}</span>
                        <span className="block text-xs text-text-muted">{country.label}</span>
                      </span>
                      <DaysStepper
                        size="sm"
                        optional
                        emptyLabel="Default"
                        aria-label={`${rule.name} — ${country.label} days after ETD`}
                        value={days}
                        min={1}
                        max={30}
                        disabled={!canEdit}
                        onChange={(next) => updateCountryDays(rule.id, country.code, next)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
