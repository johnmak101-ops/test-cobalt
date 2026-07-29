import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { DaysStepper } from './DaysStepper'
import { toast } from '../ui/Toast'
import { useAuth } from '../../hooks/use-auth'

type EtdFallback = { airDays: number; seaDays: number }

/**
 * Lifecycle tunables — the no-arrival-data Delivered fallback (ops 2026-07-24): a leg with no
 * ETA/ATA/In-DC turns Delivered once its departure is older than these mode-aware allowances.
 * SUPERADMIN only, tab and endpoint alike (mirrored here on Save).
 */
export function LifecycleSettings() {
  const { user } = useAuth()
  const canEdit = user?.role === 'SUPERADMIN'
  const qc = useQueryClient()
  const { data } = useQuery<EtdFallback>({
    queryKey: ['settings', 'etd-fallback'],
    queryFn: () => api.get('/settings/etd-fallback'),
  })
  const [draft, setDraft] = useState<EtdFallback | null>(null)
  useEffect(() => {
    if (data) setDraft((d) => d ?? data)
  }, [data])
  const save = useMutation({
    mutationFn: (body: EtdFallback) => api.put('/settings/etd-fallback', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'etd-fallback'] })
      toast('Lifecycle settings saved')
    },
    onError: () => toast.error('Save failed — please retry'),
  })
  const dirty = !!draft && !!data && (draft.airDays !== data.airDays || draft.seaDays !== data.seaDays)

  return (
    <Card>
      <h4 className="mb-1 text-base font-semibold text-text-primary">Lifecycle</h4>
      <p className="mb-4 text-xs text-text-muted">
        A shipment with no ETA, ATA or In-DC date turns <span className="font-medium">Delivered</span> once
        its departure (ATD, else ETD) is older than these transit allowances. A stated ETA always wins.
      </p>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="mb-1 text-xs text-text-secondary">Air — days after departure</p>
          <DaysStepper
            aria-label="Air days after departure"
            value={draft?.airDays ?? null}
            onChange={(v) => setDraft((d) => (d ? { ...d, airDays: v ?? 0 } : d))}
            min={0}
            max={365}
            disabled={!canEdit || !draft}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-text-secondary">Sea — days after departure</p>
          <DaysStepper
            aria-label="Sea days after departure"
            value={draft?.seaDays ?? null}
            onChange={(v) => setDraft((d) => (d ? { ...d, seaDays: v ?? 0 } : d))}
            min={0}
            max={365}
            disabled={!canEdit || !draft}
          />
        </div>
        <button
          type="button"
          disabled={!canEdit || !dirty || save.isPending}
          onClick={() => draft && save.mutate(draft)}
          className="rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {!canEdit && <p className="mt-2 text-xs text-text-muted">Superadmins can change these allowances.</p>}
    </Card>
  )
}
