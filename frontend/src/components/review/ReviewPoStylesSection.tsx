/**
 * Review POs & styles.
 * Edit mode is the same card-level blue Edit / Done editing as the conflict table —
 * one click edits fields and every PO row together (no second Edit on this strip).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Link2Off, Loader2, Plus, X } from 'lucide-react'
import {
  planAll,
  planForPo,
  styleTokens,
  type PoStylePlan,
  type PoStyleSelection,
} from '../../lib/po-style-plan'
import type { LinkedPO } from '../../hooks/use-shipments'
import {
  useCreatePurchaseOrder,
  useUpdatePurchaseOrder,
  useUnlinkShipmentFromPO,
  useLinkShipmentToPO,
} from '../../hooks/use-purchase-orders'
import { toast } from '../ui/Toast'
import {
  REVIEW_COL,
  REVIEW_GROUP_HEADER,
  REVIEW_HEAD,
  REVIEW_TABLE_CLASS,
  REVIEW_TD,
  REVIEW_TH,
} from './review-table-layout'
import { parseStyleEntries } from '../../lib/review-fields'
import { ReviewColGroup } from './ReviewColGroup'
import { StyleListDisplay, StyleListEditor } from './ConflictRow'
import { cn } from '../../lib/utils'

const inputCls =
  'w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

const HEADER_BTN =
  'inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-700 hover:text-text-primary disabled:opacity-50'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The style this thread resolved to, when the PO does not already carry it.
 *
 * NOT a proposal from the email. It is written by the committer's reconciler
 * (`summarizeStyleConflict(enr.styleConflict, enr.itemStyleNo)` in po-enrichment.ts) to record which
 * of several competing styles it ranked first — and `upsertPo` is fill-if-null / superset-upgrade
 * only, so on any row that reaches this function the write was DECLINED and the PO kept what it had.
 * A value the write path refused has no business in an apply-me colour under an apply-me heading;
 * it renders slate under "Also Seen In Email" instead. Nothing is hidden — Edit still takes it deliberately.
 *
 * The suffix only earns a cell when the value is genuinely absent from the PO. Absent means absent
 * as a TOKEN: `C192/FERN JUMPER` already carries `C192` (parseStyleEntries reads the part before the
 * slash as the PO/article prefix), and showing the bare code there would invite the operator to
 * overwrite the fuller value with a shorter one they already have.
 *
 * Reads BOTH wordings. `(system read: X)` is what the reconciler writes now; `(kept X)` is the old
 * phrasing, still sitting in review_reasons on every leg committed before that fix — those rows must
 * keep rendering, so the legacy alternative stays until the column is known to be clear of them.
 */
export function alsoSeenStyleForPo(
  poNumber: string,
  reviewReasons: string[],
  currentStyle?: string | null,
): string | null {
  const re = new RegExp(
    `PO\\s+${escapeRegExp(poNumber)}:.*?item\\/style[\\s\\S]*?\\((?:system read:\\s*|kept\\s+)([^)]+)\\)`,
    'i',
  )
  for (const r of reviewReasons) {
    const m = r.match(re)
    if (!m?.[1]) continue
    const seen = m[1].trim().replace(/^"|"$/g, '')
    return styleAlreadyPresent(seen, currentStyle) ? null : seen
  }
  return null
}

/** True when `seen` is already carried by the stored style — as the whole value, one of its list
 *  entries, or an entry's article prefix (`C192` in `C192/FERN JUMPER`). */
function styleAlreadyPresent(seen: string, currentStyle: string | null | undefined): boolean {
  const norm = (s: string) => s.trim().toUpperCase()
  const k = norm(seen)
  if (k === '') return true
  const current = String(currentStyle ?? '').trim()
  if (current === '') return false
  if (norm(current) === k) return true
  return parseStyleEntries(current).some(
    (e) => norm(e.style) === k || (e.po !== '' && norm(e.po) === k),
  )
}

type Draft = { poNumber: string; itemStyleNo: string }

function draftsFromPos(pos: LinkedPO[]): Record<string, Draft> {
  const out: Record<string, Draft> = {}
  for (const p of pos) {
    out[p.id] = {
      poNumber: p.poNumber,
      itemStyleNo: p.itemStyleNo?.trim() ?? '',
    }
  }
  return out
}

interface RowForm {
  poNumber: string
  itemStyleNo: string
}

export interface ReviewPoStylesSectionProps {
  shipmentId: string
  linkedPOs: LinkedPO[]
  customerId?: string | null
  readOnly?: boolean
  /** Card-level Edit / Done editing — drives this whole strip. */
  editing?: boolean
  reviewReasons?: string[]
  /**
   * When true, no outer border/title chrome — lives inside the shared decision grid shell
   * (same column tracks as field conflicts).
   */
  embedded?: boolean
  /** Third-column header — tracks the card's state label (Also Seen In Email → Resolution → Edited). */
  proposedColumnLabel?: string
  /**
   * Every PO whose style list the ticks would rewrite, emitted on each change.
   *
   * The section computes the plan; the CARD applies it — the same split the backend uses
   * (planPoReconcile decides, the committer writes). The card owns applying because its primary
   * button is what names the count and what the operator presses, and a section that wrote on its
   * own would have changed the PO while the bar still read "No Changes".
   */
  onPlanChange?: (plans: PoStylePlan[]) => void
}

export function ReviewPoStylesSection({
  shipmentId,
  linkedPOs,
  customerId = null,
  readOnly = false,
  editing = false,
  reviewReasons = [],
  embedded = false,
  proposedColumnLabel = REVIEW_HEAD.proposed,
  onPlanChange,
}: ReviewPoStylesSectionProps) {
  const create = useCreatePurchaseOrder()
  const update = useUpdatePurchaseOrder()
  const unlink = useUnlinkShipmentFromPO()
  const link = useLinkShipmentToPO()

  const canEdit = editing && !readOnly
  /** What the operator has ticked, per PO. An absent entry is "untouched" — every stored token kept,
   *  nothing added — so an untouched desk holds no state and plans to write nothing. */
  const [selections, setSelections] = useState<Record<string, PoStyleSelection>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsFromPos(linkedPOs))
  const [adding, setAdding] = useState(false)
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null)

  const prevEditing = useRef(false)
  const draftsRef = useRef(drafts)
  const linkedRef = useRef(linkedPOs)

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])
  useEffect(() => {
    linkedRef.current = linkedPOs
  }, [linkedPOs])

  const busy =
    create.isPending || update.isPending || unlink.isPending || link.isPending

  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
  const isDropped = (poId: string, tok: string): boolean =>
    (selections[poId]?.dropped ?? []).some((d) => same(d, tok))

  const toggleDropped = (poId: string, tok: string) =>
    setSelections((s) => {
      const cur = s[poId] ?? {}
      const dropped = cur.dropped ?? []
      const has = dropped.some((d) => same(d, tok))
      return {
        ...s,
        [poId]: { ...cur, dropped: has ? dropped.filter((d) => !same(d, tok)) : [...dropped, tok] },
      }
    })

  const toggleAdded = (poId: string) =>
    setSelections((s) => ({ ...s, [poId]: { ...(s[poId] ?? {}), added: !s[poId]?.added } }))

  /**
   * The write plan, recomputed from the ticks and handed up on every change.
   *
   * Keyed on its own JSON so the card is told once per real change rather than once per render —
   * `planAll` returns a fresh array each time, and passing that straight to an effect would loop.
   * Refs carry the current callback and plans so neither has to sit in the dependency list and
   * re-fire the emit when a parent re-renders for unrelated reasons.
   *
   * Self-clearing after an apply: once the PO stores the new list, a `dropped` token no longer
   * matches anything and `alsoSeenStyleForPo` stops offering the added value, so both plans go null
   * without this component having to know a write happened.
   */
  const plans = planAll(
    linkedPOs,
    (p) => alsoSeenStyleForPo(p.poNumber, reviewReasons, p.itemStyleNo),
    selections,
  )
  const plansKey = JSON.stringify(plans)
  const plansRef = useRef(plans)
  plansRef.current = plans
  const onPlanChangeRef = useRef(onPlanChange)
  useEffect(() => {
    onPlanChangeRef.current = onPlanChange
  }, [onPlanChange])
  useEffect(() => {
    onPlanChangeRef.current?.(plansRef.current)
  }, [plansKey])

  // View mode: derive from server (no effect mirror). Edit mode: local drafts only.
  const displayDrafts = canEdit ? drafts : draftsFromPos(linkedPOs)

  // Enter edit → seed drafts. Leave (Done editing) → save dirty POs.
  useEffect(() => {
    const was = prevEditing.current
    prevEditing.current = canEdit

    if (canEdit && !was) {
      setDrafts(draftsFromPos(linkedRef.current))
      setAdding(false)
      setConfirmUnlinkId(null)
      return
    }

    if (!canEdit && was) {
      setAdding(false)
      setConfirmUnlinkId(null)
      const d = draftsRef.current
      const pos = linkedRef.current
      const saves: Promise<unknown>[] = []
      for (const po of pos) {
        const draft = d[po.id]
        if (!draft) continue
        const poNumber = draft.poNumber.trim()
        if (!poNumber) {
          toast.error(`PO# required (${po.poNumber})`)
          continue
        }
        const itemStyleNo = draft.itemStyleNo.trim() || null
        const patch: { id: string; poNumber?: string; itemStyleNo?: string | null } = {
          id: po.id,
        }
        if (poNumber !== po.poNumber) patch.poNumber = poNumber
        if ((itemStyleNo ?? '') !== (po.itemStyleNo?.trim() ?? '')) {
          patch.itemStyleNo = itemStyleNo
        }
        if (patch.poNumber == null && !('itemStyleNo' in patch)) continue
        saves.push(
          update.mutateAsync(patch).catch(() => {
            toast.error(`Couldn't save PO ${poNumber}`)
          }),
        )
      }
      if (saves.length > 0) {
        void Promise.all(saves).then((results) => {
          const ok = results.filter((r) => r !== undefined).length
          if (ok > 0) toast(`Saved ${ok} PO${ok === 1 ? '' : 's'}`)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { poNumber: '', itemStyleNo: '' }), ...patch },
    }))
  }

  const handleAdd = (f: RowForm) => {
    create.mutate(
      {
        poNumber: f.poNumber.trim(),
        customerId: customerId ?? undefined,
        itemStyleNo: f.itemStyleNo.trim() || null,
      },
      {
        onSuccess: (po: unknown) => {
          const poId = (po as { id?: string })?.id
          if (!poId) return toast.error('Created the PO but got no id back')
          link.mutate(
            { poId, shipmentId },
            {
              onSuccess: () => {
                toast(`Added PO ${f.poNumber.trim()}`)
                setAdding(false)
              },
              onError: () =>
                toast.error('Created the PO, but linking it to this shipment failed'),
            },
          )
        },
        onError: () =>
          toast.error(`Couldn't add PO ${f.poNumber.trim()} — it may already exist`),
      },
    )
  }

  const handleUnlink = (po: LinkedPO) => {
    if (!po.linkId) {
      setConfirmUnlinkId(null)
      return toast.error('No shipment link to remove')
    }
    unlink.mutate(
      { poId: po.id, linkId: po.linkId },
      {
        onSuccess: () => {
          toast(`Removed PO ${po.poNumber} from this shipment`)
          setConfirmUnlinkId(null)
        },
        onError: () => toast.error('Remove failed — please retry'),
      },
    )
  }

  /**
   * The review desk lists only the POs that need an answer — the ones the thread stated a different
   * item/style for. A leg with seven POs and one disagreement used to print all seven, six of them
   * with `—` in the third column, which reads as "something is wrong with these POs" when nothing
   * is. The full list is the shipment page's job, one click away on Open Shipment.
   *
   * Edit mode shows every PO: adding, unlinking and correcting are what Edit is for.
   */
  const visiblePOs = canEdit
    ? linkedPOs
    : linkedPOs.filter((p) => alsoSeenStyleForPo(p.poNumber, reviewReasons, p.itemStyleNo) != null)
  const sorted = [...visiblePOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )
  /** Always 4 columns — matches the field-conflict table (actions live inside the proposed cell).
   *  The 4th is Reference Email: empty here (a PO row has no per-candidate source email), but the
   *  track must exist or the two stacked grids stop lining up. */
  const colSpan = 4

  const table = (
    <table className={REVIEW_TABLE_CLASS}>
      <ReviewColGroup />
      <tbody>
        {/* Section label row — same rhythm as conflict group headers */}
        <tr className="border-b border-border">
          <td colSpan={colSpan} className={REVIEW_GROUP_HEADER}>
            <span className="inline-flex flex-wrap items-center gap-2">
              POs & Styles
              <span className="font-normal text-text-muted">
                ({sorted.length} {sorted.length === 1 ? 'PO' : 'POs'})
                {canEdit ? ' — editing' : ''}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(true)
                    setConfirmUnlinkId(null)
                  }}
                  disabled={busy}
                  className={HEADER_BTN}
                  data-testid="review-po-add"
                >
                  <Plus size={13} /> Add PO
                </button>
              )}
            </span>
          </td>
        </tr>
        {/* #358: name the grid for THIS section — the card's shared thead (when present) sits above
            the conflict groups saying "Field / PO#" / "Current"; down here the columns read
            unlabeled, and those names never fit PO rows anyway. */}
        <tr className="border-b border-border bg-surface-900/50">
          <th scope="col" className={cn(REVIEW_COL.label, REVIEW_TH)}>PO</th>
          <th scope="col" className={cn(REVIEW_COL.existing, REVIEW_TH)}>Item/Style</th>
          <th
            scope="col"
            className={cn(REVIEW_COL.proposed, REVIEW_TH)}
            data-testid="po-proposed-column-header"
          >
            {proposedColumnLabel}
          </th>
          {/* Header kept (not blank) so the column reads as deliberate rather than a rendering gap. */}
          <th scope="col" className={cn(REVIEW_COL.reference, REVIEW_TH)}>{REVIEW_HEAD.reference}</th>
        </tr>
        {canEdit && adding && (
          <AddRow busy={busy} onCancel={() => setAdding(false)} onSave={handleAdd} />
        )}
        {sorted.map((po) => {
          const alsoSeen = alsoSeenStyleForPo(po.poNumber, reviewReasons, po.itemStyleNo)
          const plan = planForPo(po, alsoSeen, selections[po.id])
          const draft = displayDrafts[po.id] ?? {
            poNumber: po.poNumber,
            itemStyleNo: po.itemStyleNo?.trim() ?? '',
          }

          if (canEdit && confirmUnlinkId === po.id) {
            return (
              <tr
                key={po.id}
                className="border-b border-border bg-surface-900/40"
                data-testid={`review-po-unlink-confirm-${po.id}`}
              >
                <td colSpan={colSpan} className="px-3 py-2 text-sm text-text-secondary">
                  <span className="mr-3">
                    Remove PO <span className="font-mono font-medium">{po.poNumber}</span>{' '}
                    from this shipment?
                  </span>
                  <button
                    type="button"
                    className="mr-2 font-medium text-status-critical hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => handleUnlink(po)}
                  >
                    {busy ? <Loader2 size={12} className="inline animate-spin" /> : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text-primary"
                    disabled={busy}
                    onClick={() => setConfirmUnlinkId(null)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )
          }

          return (
            <tr
              key={po.id}
              data-testid={`review-po-row-${po.id}`}
              className="border-b border-border last:border-0 align-top"
            >
              <td className={cn(REVIEW_COL.label, REVIEW_TD, 'font-medium text-text-primary')}>
                {canEdit ? (
                  <input
                    className={inputCls}
                    value={draft.poNumber}
                    onChange={(e) => setDraft(po.id, { poNumber: e.target.value })}
                    aria-label={`PO number for ${po.poNumber}`}
                  />
                ) : (
                  <a
                    href={`/purchase-orders/${po.id}`}
                    className="field-value font-mono text-sm font-medium leading-snug text-cobalt-primary-light hover:underline"
                  >
                    {po.poNumber}
                  </a>
                )}
              </td>
              <td className={cn(REVIEW_COL.existing, REVIEW_TD)}>
                {canEdit ? (
                  /* pairs=false: the row IS a PO — a slash stays inside the style token. */
                  <StyleListEditor
                    label={`Style for PO ${po.poNumber}`}
                    value={draft.itemStyleNo}
                    onChange={(v) => setDraft(po.id, { itemStyleNo: v })}
                    pairs={false}
                  />
                ) : (
                  /* View mode composes rather than displays: every stored token is a box, ticked,
                     so dropping one is a click instead of a trip through Edit and a retype. */
                  <>
                    {styleTokens(po.itemStyleNo).map((tok) => (
                      <StyleTick
                        key={tok}
                        label={tok}
                        checked={!isDropped(po.id, tok)}
                        tone="keep"
                        onChange={() => toggleDropped(po.id, tok)}
                        aria-label={`Keep style ${tok} on PO ${po.poNumber}`}
                      />
                    ))}
                    {styleTokens(po.itemStyleNo).length === 0 && (
                      <span className="text-sm text-text-muted">—</span>
                    )}
                    {plan && <PlanLine plan={plan} />}
                  </>
                )}
              </td>
              <td className={cn(REVIEW_COL.proposed, REVIEW_TD)} data-po-proposed="">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Slate and unticked: this is a value the upsert rules refused to write, so
                        taking it stays the operator's deliberate act. Pre-ticking it would be
                        "AI Proposed" again, one distracted Apply from overwriting what the rules kept. */}
                    {alsoSeen ? (
                      canEdit ? (
                        <StyleListDisplay value={alsoSeen} className="text-review-seen" pairs={false} />
                      ) : (
                        <StyleTick
                          label={alsoSeen}
                          checked={!!selections[po.id]?.added}
                          tone="add"
                          onChange={() => toggleAdded(po.id)}
                          aria-label={`Add style ${alsoSeen} to PO ${po.poNumber}`}
                        />
                      )
                    ) : (
                      <span className="text-sm text-text-muted">—</span>
                    )}
                  </div>
                  {canEdit && po.linkId && (
                    <IconBtn
                      title="Remove from this shipment"
                      disabled={busy}
                      onClick={() => setConfirmUnlinkId(po.id)}
                    >
                      <Link2Off size={14} />
                    </IconBtn>
                  )}
                </div>
              </td>
              {/* Reference Email track — a PO row has no per-candidate source email; the cell exists
                  only to keep this grid aligned with the conflict table stacked below it. */}
              <td className={cn(REVIEW_COL.reference, REVIEW_TD)} aria-hidden />
            </tr>
          )
        })}
        {sorted.length === 0 && !(canEdit && adding) && (
          <tr>
            <td colSpan={colSpan} className="px-3 py-4 text-center text-sm text-text-muted">
              No POs on this shipment yet.
              {canEdit ? ' Use Add PO above.' : ' Click Edit to add POs.'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  if (embedded) {
    return (
      <div data-testid="review-po-styles-section" aria-label="POs and styles">
        {table}
      </div>
    )
  }

  return (
    <section
      className="max-w-full overflow-x-auto rounded-lg border border-border"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
      {table}
    </section>
  )
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-text-muted transition-colors hover:bg-surface-600 hover:text-text-primary disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function AddRow({
  onSave,
  onCancel,
  busy,
}: {
  onSave: (f: RowForm) => void
  onCancel: () => void
  busy: boolean
}) {
  const [f, setF] = useState<RowForm>({ poNumber: '', itemStyleNo: '' })
  const canSave = f.poNumber.trim().length > 0 && !busy
  const set = (k: keyof RowForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value })

  return (
    <tr className="border-b border-border bg-surface-900/40" data-testid="review-po-add-row">
      <td className={cn(REVIEW_COL.label, REVIEW_TD)}>
        <input
          className={inputCls}
          placeholder="PO number"
          value={f.poNumber}
          onChange={set('poNumber')}
          aria-label="New PO number"
        />
      </td>
      <td className={cn(REVIEW_COL.existing, REVIEW_TD)}>
        <input
          className={inputCls}
          placeholder="Item / style"
          value={f.itemStyleNo}
          onChange={set('itemStyleNo')}
          aria-label="New item / style"
        />
      </td>
      <td className={cn(REVIEW_COL.proposed, REVIEW_TD)}>
        <div className="flex items-center justify-end gap-0.5">
          <IconBtn title="Save" disabled={!canSave} onClick={() => canSave && onSave(f)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </IconBtn>
          <IconBtn title="Cancel" onClick={onCancel}>
            <X size={14} />
          </IconBtn>
        </div>
      </td>
      {/* Reference Email track — keeps the add/edit row the same width as the rows around it. */}
      <td className={cn(REVIEW_COL.reference, REVIEW_TD)} aria-hidden />
    </tr>
  )
}

/**
 * One style, with the box that decides its fate.
 *
 * `keep` (left column) reads as "this stays" and opens ticked; `add` (right column) reads as "this
 * joins" and opens empty. An unticked keep is struck through rather than hidden — the operator needs
 * to see what they are removing right up until they press Apply, and a vanishing row reads as a bug.
 */
function StyleTick({
  label,
  checked,
  tone,
  onChange,
  'aria-label': ariaLabel,
}: {
  label: string
  checked: boolean
  tone: 'keep' | 'add'
  onChange: () => void
  'aria-label': string
}) {
  const dropped = tone === 'keep' && !checked
  return (
    <label className="flex cursor-pointer items-start gap-2 py-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        /* One colour for "the operator chose this", across every table on the card: the style
           checkboxes, the conflict-table take, and the master radio rows. The green 'add' tone put a
           third colour on one row — the left column blue, the "Also seen in email" tick green — which
           read as two different kinds of choice when both are the same act. What is being added is
           already said by which column the box sits in. */
        className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-cobalt-primary-light"
      />
      <span
        className={cn(
          'field-value min-w-0 break-words font-mono text-sm leading-snug',
          dropped && 'text-text-muted line-through',
          !dropped && tone === 'keep' && 'text-text-primary',
          tone === 'add' && (checked ? 'font-medium text-status-success' : 'text-review-seen'),
        )}
      >
        {label}
      </span>
    </label>
  )
}

/**
 * The list this row will write, spelled out.
 *
 * A value assembled from two columns of boxes is otherwise something the operator has to hold in
 * their head, and holding it wrong is how the wrong style gets committed. The clearing case gets its
 * own wording and the critical colour: emptying a PO's styles is legitimate — sometimes the whole
 * list is junk — but it must never be the quiet by-product of unticking three boxes.
 */
function PlanLine({ plan }: { plan: PoStylePlan }) {
  return (
    <p
      data-testid={`po-plan-${plan.poId}`}
      className="mt-2 border-t border-dashed border-border pt-1.5 text-[11px] leading-snug text-text-muted"
    >
      {plan.clears ? (
        <span className="font-semibold text-status-critical">will CLEAR this PO&apos;s styles</span>
      ) : (
        <>
          will write{' '}
          <span className="field-value font-mono font-medium text-text-primary">
            {plan.itemStyleNo}
          </span>
        </>
      )}
    </p>
  )
}
