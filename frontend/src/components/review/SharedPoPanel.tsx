/**
 * "This PO is already on another shipment" — with the other shipment named.
 *
 * The reason line said a PO was shared and stopped there. With nothing under it the operator could not
 * tell a deliberate split from a switch of transport mode from a mis-link, and the card's only offer
 * was PO editing, which answers none of the three. This panel is the missing reference: for each
 * shared PO, the legs that also carry it, with the facts the judgement turns on — mode, ETD/ATD, and
 * what each side actually ships.
 *
 * It states facts and links out. It proposes no verdict and writes nothing: a cross-mode split and a
 * mis-link are indistinguishable from here, and only the operator has the context to tell them apart.
 */
import { ArrowUpRight } from 'lucide-react'
import type { SharedPo, SharedPoLeg } from '../../hooks/use-shipments'
import { isUsableIdentifier } from '../../lib/identifier-shape'
import { formatShipmentId } from '../../lib/utils'
import { REVIEW_FS } from './review-table-layout'
import { cn } from '../../lib/utils'

/**
 * A leg is NAMED by its derived Shipment ID — the same string the queue's "Shipment ID" column, the
 * detail page title and the focus page all print. This panel used to label siblings by booking
 * number, which re-created the "same leg answers to two different names depending on the screen"
 * problem #350 removed from the focus page: the operator saw `C26050645` here and `202605C7BD`
 * everywhere they went to look for it.
 */
function legName(leg: SharedPoLeg): string {
  return formatShipmentId(leg.shipmentId, leg.idAnchorAt)
}

/**
 * The carrier-side reference, for matching against a forwarder's mail. Secondary to the Shipment ID,
 * and skipped when digit-free: a leg whose booking number is `PO # :` was parsed from a spreadsheet
 * header, and printing that asks the operator to go looking for "PO # :".
 */
function legRef(leg: SharedPoLeg): string | null {
  return (
    [leg.bookingNo, leg.soNo, leg.hblAwbFcrNo]
      .map((v) => String(v ?? '').trim())
      .find((v) => isUsableIdentifier(v)) ?? null
  )
}

function qtyLabel(qty: number | null, unit: string | null): string | null {
  if (qty == null) return null
  return `${qty.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

const dateLabel = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null)

/** ETD, or ATD once it has sailed — the sibling's schedule in one token. */
function scheduleLabel(leg: SharedPoLeg): string | null {
  const atd = dateLabel(leg.atd)
  if (atd) return `sailed ${atd}`
  const etd = dateLabel(leg.etd)
  return etd ? `ETD ${etd}` : null
}

export interface SharedPoPanelProps {
  sharedPos: SharedPo[]
  /** This leg's own mode, so the cross-mode line can name both sides. */
  mode?: string | null
}

export function SharedPoPanel({ sharedPos, mode }: SharedPoPanelProps) {
  const groups = sharedPos.filter((g) => g.others.length > 0)
  if (groups.length === 0) return null

  const crossMode = groups.some((g) => g.anyCrossMode)
  const poWord = groups.length === 1 ? 'PO' : 'POs'

  return (
    <div
      className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-3 py-2.5"
      data-testid="shared-po-panel"
    >
      <p className={`${REVIEW_FS.topic} font-semibold text-text-primary`}>
        {groups.length === 1
          ? `PO ${groups[0]!.poNumber} is also on another shipment`
          : `${groups.length} ${poWord} on this leg are also on other shipments`}
      </p>
      <p className={`mt-0.5 ${REVIEW_FS.body} text-text-secondary`}>
        {crossMode
          ? /* The question the operator actually asks first. Named, not answered: a cross-mode split
               and a mis-link look the same from here. */
            `The other shipment moves by a different transport mode${
              mode ? ` (this leg is ${mode.toUpperCase()})` : ''
            } — a split across modes and a wrong link look alike, so check the quantities.`
          : 'Confirm whether the order was split across shipments, or linked here by mistake.'}
      </p>

      <div className="mt-2 space-y-2" data-testid="shared-po-list">
        {groups.map((g) => {
          const mine = qtyLabel(g.legQty, g.legQtyUnit)
          return (
            <div
              key={g.poNumber}
              className="rounded-md border border-border bg-surface-900 px-2.5 py-2"
              data-testid={`shared-po-${g.poNumber}`}
            >
              <p className={`${REVIEW_FS.meta} text-text-muted`}>
                <span className="font-mono text-cobalt-primary-light">PO {g.poNumber}</span>
                {mine && (
                  <>
                    <span> · this shipment ships </span>
                    <span className="font-mono text-text-primary">{mine}</span>
                  </>
                )}
              </p>
              <ul className="mt-1.5 space-y-1">
                {g.others.map((leg) => {
                  const theirQty = qtyLabel(leg.legQty, leg.legQtyUnit)
                  const schedule = scheduleLabel(leg)
                  return (
                    <li
                      key={leg.shipmentId}
                      className={cn(
                        'flex flex-wrap items-baseline gap-x-2 gap-y-0.5',
                        REVIEW_FS.body,
                        leg.dismissed && 'opacity-60',
                      )}
                    >
                      <a
                        href={`/shipments/${leg.shipmentId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 font-mono text-cobalt-primary-light hover:underline"
                        data-testid={`shared-po-open-${leg.shipmentId}`}
                      >
                        {legName(leg)}
                        <ArrowUpRight size={12} className="shrink-0" />
                      </a>
                      {/* The forwarder's own reference, for matching against their mail. */}
                      {legRef(leg) && (
                        <span className={`${REVIEW_FS.meta} font-mono text-text-muted`}>
                          {legRef(leg)}
                        </span>
                      )}
                      {leg.mode && (
                        <span
                          className={cn(
                            REVIEW_FS.meta,
                            leg.crossMode ? 'font-semibold text-status-warning' : 'text-text-muted',
                          )}
                        >
                          {leg.mode.toUpperCase()}
                        </span>
                      )}
                      {theirQty && (
                        <span className={`${REVIEW_FS.meta} font-mono text-text-secondary`}>
                          {theirQty}
                        </span>
                      )}
                      {schedule && (
                        <span className={`${REVIEW_FS.meta} text-text-muted`}>{schedule}</span>
                      )}
                      {/* State matters for the verdict: you do not move a PO off a leg that sailed. */}
                      {leg.dismissed ? (
                        <span className={`${REVIEW_FS.meta} text-text-muted`}>rejected</span>
                      ) : leg.provisional ? (
                        <span className={`${REVIEW_FS.meta} text-text-muted`}>still in review</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
