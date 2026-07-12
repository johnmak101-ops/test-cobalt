import { useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import { usePageAccess } from '../../hooks/use-page-access'
import { useReviewPolicy, useSaveReviewPolicy } from '../../hooks/use-review-policy'

/** Admin panel for the human-review triggers. Editability follows the Access Control matrix
 *  ('review_policy'); the backend @PageWrite guard is authoritative. */
export function ReviewPolicySettings() {
  const { canEdit: canEditPage } = usePageAccess()
  const canEdit = canEditPage('review_policy')
  const { data, isLoading } = useReviewPolicy()
  const save = useSaveReviewPolicy()

  // Server snapshot; local edits live in `draft` until save or a new fetch replaces the snapshot.
  const serverEnabled = useMemo(
    () =>
      data?.triggers
        ? Object.fromEntries(data.triggers.map((t) => [t.id, t.enabled]))
        : null,
    [data],
  )
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null)
  const [serverSnap, setServerSnap] = useState(serverEnabled)
  if (serverEnabled !== serverSnap) {
    setServerSnap(serverEnabled)
    setDraft(null)
  }
  const enabled = draft ?? serverEnabled ?? {}
  const dirty = draft !== null

  if (isLoading) return <p className="text-sm text-text-secondary">Loading…</p>

  const toggle = (id: string) => {
    if (!canEdit) return
    setDraft({ ...enabled, [id]: !enabled[id] })
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text-primary">Review policy</h2>
      <p className="mt-1 text-sm text-text-secondary">
        When any of these is checked, matching emails go to a person before they are confirmed.
        Turning a box on only adds a human check — it never forces auto-confirm.
      </p>
      {!canEdit && <p className="mt-2 text-xs text-text-muted">You have view-only access to Review Policy.</p>}
      <ul className="mt-4 space-y-2">
        {(data?.triggers ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              id={`trigger-${t.id}`}
              checked={!!enabled[t.id]}
              disabled={!canEdit}
              onChange={() => toggle(t.id)}
              className={cn('h-4 w-4', !canEdit && 'cursor-not-allowed opacity-50')}
            />
            <label htmlFor={`trigger-${t.id}`} className="text-sm text-text-primary">
              Send to review when {t.label}
            </label>
          </li>
        ))}
      </ul>
      {canEdit && (
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(Object.keys(enabled).filter((id) => enabled[id]))}
          className="mt-4 rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      )}
    </Card>
  )
}
