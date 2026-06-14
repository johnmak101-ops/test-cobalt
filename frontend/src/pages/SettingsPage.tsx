import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useThreshold, useSetThreshold } from '../hooks/use-settings'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'

export default function SettingsPage() {
  const { user } = useAuth()
  const { data } = useThreshold()
  const set = useSetThreshold()
  const [value, setValue] = useState(85)
  useEffect(() => {
    if (data) setValue(data.threshold)
  }, [data])

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'
  if (user?.role === 'VIEWER') {
    return (
      <Card>
        <div className="text-sm text-text-muted">Editors only.</div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <Card>
        <h2 className="font-semibold">Review-gate confidence threshold</h2>
        <p className="mt-1 text-sm text-text-muted">
          A decision scoring at or above this auto-confirms; below it, the shipment is held in the review queue.
          {isAdmin ? '' : ' Only admins can change it.'}
        </p>
        <div className="mt-5 flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            disabled={!isAdmin}
            className="flex-1 accent-cobalt-primary"
          />
          <span className="w-12 text-right font-mono text-2xl font-bold text-cobalt-primary">{value}</span>
        </div>
        {isAdmin && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => set.mutate(value)}
              disabled={set.isPending || value === data?.threshold}
              className="rounded-lg bg-cobalt-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            {set.isSuccess && value === data?.threshold && (
              <span className="inline-flex items-center gap-1 text-sm text-status-success">
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
