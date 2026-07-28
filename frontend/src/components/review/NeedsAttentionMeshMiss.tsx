import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { PartyPicker } from '../shipments/PartyPicker'
import type { PartyKind } from '../../hooks/use-parties'
import type { NeedsAttentionItem } from './needs-attention'
import { isExpandableMiss, isMeshPortCollapsed } from './needs-attention'
import { cn } from '../../lib/utils'
import { REVIEW_PANEL_DOT, REVIEW_PANEL_ITEM } from './review-table-layout'

/**
 * Expandable master-miss summary: multi-party Mesh miss or multi-port UN/LOCODE miss.
 * One summary bullet; expand to list each name/token.
 */
export function NeedsAttentionMeshMiss({
  item,
  className,
  listClassName,
  pick,
  picking,
}: {
  item: NeedsAttentionItem
  className?: string
  /** Class for expanded name rows (detail page uses list-disc; review uses panel item). */
  listClassName?: string
  /**
   * How to link a raw party to a Mesh master, when this surface can write.
   *
   * `kindFor` returns null for a name whose column cannot be identified on this leg — then the row
   * lists the candidates read-only rather than offering a control that would write nowhere.
   * Omitted entirely on read-only surfaces (the shipment detail page renders the same items).
   */
  pick?: {
    kindFor: (partyName: string) => PartyKind | null
    isMasterValue: (kind: PartyKind, value: string) => boolean
    onPick: (partyName: string, storedValue: string) => void
  }
  /** The party name currently being written, so its control can disable without freezing the list. */
  picking?: string | null
}) {
  const [open, setOpen] = useState(false)
  if (!isExpandableMiss(item)) return null

  // A collapsed line lists its parties in `details`; a single one names its party only through the
  // candidates map. Both reach the same expansion.
  const names = item.details ?? Object.keys(item.meshCandidates ?? {})
  const n = names.length
  const isPort = isMeshPortCollapsed(item)
  // One party with five candidates is asking "which of these", not "which name" — label it by the
  // thing the operator is about to choose from.
  const singleWithCandidates = n === 1 && (item.meshCandidates?.[names[0]!]?.length ?? 0) > 0
  const showLabel = open
    ? isPort
      ? 'Hide ports'
      : singleWithCandidates
        ? 'Hide matches'
        : 'Hide names'
    : isPort
      ? `Show ${n} ports`
      : singleWithCandidates
        ? `Show ${item.meshCandidates![names[0]!]!.length} in Mesh`
        : `Show ${n} names`
  const rowSuffix = isPort ? ' — not in UN/LOCODE masters' : ' — not in Mesh'
  const testId = isPort ? 'mesh-port-collapsed' : 'mesh-party-collapsed'
  const expandTestId = isPort ? 'mesh-port-expand' : 'mesh-party-expand'
  const detailsTestId = isPort ? 'mesh-port-details' : 'mesh-party-details'

  return (
    <li className={cn('list-none', className)} data-testid={testId}>
      <div className={cn(REVIEW_PANEL_ITEM, 'items-start')}>
        <span
          className={cn(
            REVIEW_PANEL_DOT,
            item.severity === 'high'
              ? 'bg-status-critical'
              : item.severity === 'medium'
                ? 'bg-status-warning'
                : 'bg-surface-600',
          )}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full min-w-0 items-start gap-1.5 text-left text-sm leading-snug text-text-secondary hover:text-text-primary"
            data-testid={expandTestId}
          >
            {open ? (
              <ChevronDown size={14} className="mt-0.5 shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={14} className="mt-0.5 shrink-0 text-text-muted" />
            )}
            <span className="min-w-0">
              {item.text}
              <span className="ml-1.5 text-xs font-medium text-cobalt-primary-light">
                {showLabel}
              </span>
            </span>
          </button>
          {open && (
            <ul
              className={cn(
                'mt-1.5 space-y-1 border-l border-border pl-3 ml-1',
                listClassName,
              )}
              data-testid={detailsTestId}
            >
              {names.map((name) => {
                const candidates = item.meshCandidates?.[name] ?? []
                return (
                  <li key={name} className="text-sm leading-snug text-text-secondary">
                    <span className="font-mono text-text-primary">{name}</span>
                    {candidates.length === 0 ? (
                      <span className="text-text-muted">{rowSuffix}</span>
                    ) : (
                      <>
                        {/* Not "not in Mesh" — Mesh has it, under a longer name, N times over.
                            The operator's question is WHICH, so answer it with the list rather
                            than sending them to a search box for something we already know. */}
                        <span className="text-text-muted">
                          {candidates.length === 1
                            ? ' — in Mesh, not linked:'
                            : ` — ${candidates.length} in Mesh, none named exactly this:`}
                        </span>
                        <MeshCandidateControl
                          name={name}
                          candidates={candidates}
                          pick={pick}
                          busy={picking === name}
                        />
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * The control for "which Mesh master is this party?" — the SAME PartyPicker the shipment detail
 * form, the create form and the review conflict rows use for Customer Code, Vendor Code and
 * Forwarder.
 *
 * It was a row of bespoke buttons first. That put two different controls on one decision: picking a
 * vendor was a searchable master dropdown everywhere in the app, and picking a forwarder here was
 * something else — so the two read as different kinds of action when they are the same action.
 *
 * Seeded with the raw name, which is what makes it no worse than the buttons: PartyPicker filters on
 * its own text, so a field holding "LOGWIN" opens already narrowed to the five LOGWIN companies.
 * Nobody is sent to search for something the app has just finished telling them it knows.
 *
 * The write fires when the value becomes a real master identifier — the code for Customer/Vendor,
 * the name for Forwarder, exactly what PartyPicker hands back on a pick. Free text that resolves to
 * nothing is left alone: this control links a party to an existing master and nothing else, and the
 * ordinary edit form is still where a genuinely-new name gets typed.
 */
function MeshCandidateControl({
  name,
  candidates,
  pick,
  busy,
}: {
  name: string
  candidates: string[]
  pick?: {
    kindFor: (partyName: string) => PartyKind | null
    isMasterValue: (kind: PartyKind, value: string) => boolean
    onPick: (partyName: string, storedValue: string) => void
  }
  busy: boolean
}) {
  const kind = pick?.kindFor(name) ?? null
  const [draft, setDraft] = useState(name)

  // No write path (read-only surface) or no column to write to — list them, do not offer a control.
  if (!pick || !kind) {
    return (
      <span className="mt-1 flex flex-wrap gap-1.5">
        {candidates.map((master) => (
          <span
            key={master}
            data-testid="mesh-candidate-name"
            className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-text-secondary"
          >
            {master}
          </span>
        ))}
      </span>
    )
  }

  return (
    <span className="mt-1 block max-w-md" data-testid="mesh-candidate-picker">
      <PartyPicker
        kind={kind}
        value={draft}
        ariaLabel={`Link ${name} to a Mesh ${kind}`}
        placeholder={`Search ${kind}s — code or name`}
        className="h-8 w-full rounded-md border border-border bg-surface-700 px-2 text-sm text-text-primary placeholder:text-text-muted/70 focus:border-cobalt-primary focus:outline-none disabled:opacity-40"
        onChange={(v) => {
          setDraft(v)
          if (!busy && pick.isMasterValue(kind, v)) pick.onPick(name, v)
        }}
      />
    </span>
  )
}
