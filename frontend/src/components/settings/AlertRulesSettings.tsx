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
  state: string | null
  triggerType: string
  triggerReference: string
  thresholdDays: number
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

/** Customer product rules — each card is warn + severe pair in the API (A1/A2, A3/A4). */
const PRODUCT_RULES = [
  {
    key: 'draft_bol',
    title: 'No Draft BOL received',
    description: 'Fires after ETD when Draft B/L is still missing.',
    warnId: 'A1',
    severeId: 'A2',
    warnDefault: 1,
    severeDefault: 2,
  },
  {
    key: 'final_bol',
    title: 'No Final BOL received',
    description: 'Fires after ETD when Final B/L is still missing.',
    warnId: 'A3',
    severeId: 'A4',
    warnDefault: 3,
    severeDefault: 7,
  },
] as const

const PAIR_IDS = new Set(PRODUCT_RULES.flatMap((p) => [p.warnId, p.severeId]))

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

function byId(rules: AlertRule[], id: string): AlertRule | undefined {
  return rules.find((r) => r.id === id)
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
  // Full list for save (includes locked A7 if present — we never drop it).
  const allRules = draft ?? serverRules ?? []
  const allRulesRef = useRef(allRules)
  allRulesRef.current = allRules
  const dirty = draft !== null

  const saveRules = useMutation({
    mutationFn: (rules: AlertRule[]) =>
      api.put('/alert-rules', {
        rules: rules.map((rule) => {
          const allowed = new Set(ALERT_COUNTRY_LIST.map((c) => c.code))
          const ct = rule.countryThresholds
          const cleaned =
            ct && Object.keys(ct).length > 0
              ? Object.fromEntries(
                  Object.entries(ct).filter(
                    ([code, days]) => allowed.has(code) && typeof days === 'number' && days > 0,
                  ),
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

  /**
   * Keep severe strictly after warning (customer: warn then severe).
   * Raising warn past severe bumps severe; lowering severe below warn bumps warn down.
   */
  const updatePairDays = (
    product: (typeof PRODUCT_RULES)[number],
    which: 'warn' | 'severe',
    next: number,
  ) => {
    setDraft((prev) => {
      const base = prev ?? serverRules ?? []
      const warn = byId(base, product.warnId)
      const severe = byId(base, product.severeId)
      if (!warn || !severe) return base
      let w = which === 'warn' ? next : warn.thresholdDays
      let s = which === 'severe' ? next : severe.thresholdDays
      w = Math.max(0, Math.min(30, Math.round(w)))
      s = Math.max(0, Math.min(30, Math.round(s)))
      if (which === 'warn' && s <= w) s = Math.min(30, w + 1)
      if (which === 'severe' && s <= w) w = Math.max(0, s - 1)
      return base.map((r) => {
        if (r.id === product.warnId) return { ...r, thresholdDays: w }
        if (r.id === product.severeId) return { ...r, thresholdDays: s }
        return r
      })
    })
  }

  /**
   * Country absolute days after ETD for the warning tier; severe = warning + (severeDefault − warnDefault)
   * so CN=4 with Draft (1/2) → warn@4 severe@5; Final (3/7) → warn@3 severe@7 when D=3.
   */
  const updateCountryDays = (
    product: (typeof PRODUCT_RULES)[number],
    code: string,
    days: number | '',
  ) => {
    const delta = product.severeDefault - product.warnDefault
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => {
        if (r.id !== product.warnId && r.id !== product.severeId) return r
        const ct = { ...(r.countryThresholds ?? {}) }
        if (days === '' || days === 0) {
          delete ct[code]
        } else {
          ct[code] = r.id === product.warnId ? days : days + delta
        }
        return { ...r, countryThresholds: Object.keys(ct).length > 0 ? ct : null }
      }),
    )
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading alert rules…</div>
  }

  const missingPair = PRODUCT_RULES.some(
    (p) => !byId(allRules, p.warnId) || !byId(allRules, p.severeId),
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">Alert rules</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Two customer rules — warning and severe thresholds after ETD.
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
            onClick={() => {
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

      {missingPair && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          Draft/Final BOL rules are not seeded yet. Run backend seed or rematch deploy, then reload.
        </p>
      )}

      <div className="space-y-4">
        {PRODUCT_RULES.map((product) => {
          const warn = byId(allRules, product.warnId)
          const severe = byId(allRules, product.severeId)
          if (!warn || !severe) return null
          const enabled = warn.enabled || severe.enabled
          // Country map from warn row (both kept in sync on edit)
          const countryMap = warn.countryThresholds ?? severe.countryThresholds ?? null

          return (
            <Card key={product.key} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary">{product.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{product.description}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Toggle ${product.title} enabled`}
                  onClick={() => {
                    if (!canEdit) return
                    const next = !enabled
                    updateRule(product.warnId, 'enabled', next)
                    updateRule(product.severeId, 'enabled', next)
                  }}
                  disabled={!canEdit}
                  className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                    enabled ? 'bg-cobalt-primary' : 'bg-surface-600',
                    !canEdit && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                      enabled ? 'left-[22px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-8">
                <div>
                  <label
                    htmlFor={`${id}-${product.key}-warn`}
                    className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-status-warning"
                  >
                    Warning — days after ETD
                  </label>
                  <DaysStepper
                    id={`${id}-${product.key}-warn`}
                    aria-label={`${product.title} warning days after ETD`}
                    value={warn.thresholdDays}
                    min={0}
                    max={29}
                    disabled={!canEdit}
                    onChange={(next) =>
                      updatePairDays(product, 'warn', next ?? product.warnDefault)
                    }
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${id}-${product.key}-severe`}
                    className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-status-critical"
                  >
                    Severe — days after ETD
                  </label>
                  <DaysStepper
                    id={`${id}-${product.key}-severe`}
                    aria-label={`${product.title} severe days after ETD`}
                    value={severe.thresholdDays}
                    min={1}
                    max={30}
                    disabled={!canEdit}
                    onChange={(next) =>
                      updatePairDays(product, 'severe', next ?? product.severeDefault)
                    }
                  />
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-border bg-surface-900/40 p-4">
                <div className="mb-3">
                  <p className="text-xs font-semibold text-text-secondary">
                    Country of origin (custom days)
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Absolute days after ETD for that origin — overrides both warning and severe
                    defaults when set. China, Bangladesh, Cambodia only. Tap − until{' '}
                    <span className="font-medium">Default</span> to inherit.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {ALERT_COUNTRY_LIST.map((country) => {
                    const raw = countryMap?.[country.code]
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
                          aria-label={`${country.label} days after ETD`}
                          value={days}
                          min={1}
                          max={30}
                          disabled={!canEdit}
                          onChange={(next) =>
                            updateCountryDays(product, country.code, next == null ? '' : next)
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Ensure unused pair ids stay in save payload (no-op when already present). */}
      <span className="sr-only" aria-hidden>
        {Array.from(PAIR_IDS).join(',')}
      </span>
    </div>
  )
}
