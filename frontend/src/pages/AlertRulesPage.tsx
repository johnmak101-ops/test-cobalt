import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card } from '../components/ui/Card'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../lib/utils'
import { ArrowLeft } from 'lucide-react'

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

export default function AlertRulesPage() {
  const navigate = useNavigate()
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/alerts')}
            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Alert Rules</h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              Configure when alerts are triggered for each shipment state
            </p>
          </div>
        </div>
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
                    <p className="mt-1 flex h-9 items-center text-sm text-text-secondary">
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
        </>
      )}
    </div>
  )
}
