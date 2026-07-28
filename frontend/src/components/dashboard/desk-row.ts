/**
 * Row metrics for the dashboard's two side-by-side desks (Active Alerts · Review Queue).
 *
 * The two panels sit in one grid band, so their Nth rows are read across as a pair. Left to
 * themselves the rows size to their content — a two-line alert message beside a one-line review
 * reason — and the columns drift apart further with every row down the card.
 *
 * So height is RESERVED rather than earned: every row spends the same space on a meta line and two
 * message lines whether or not it has them to fill. A row with a short message keeps its second line
 * empty instead of pulling its neighbour out of line.
 *
 * ONE definition, imported by both AlertCard (compact only) and ReviewQueuePanel — the two are built
 * in different files, and a pair of copied class strings is exactly the drift this exists to stop.
 * Compact-only on purpose: the Alerts page and the shipment detail drawer render full-height cards
 * where a clamped message would hide the sentence that is the whole point of the alert.
 */

/** Identity line — badge + mono title. Never wraps: a second line here defeats the whole thing. */
export const DESK_ROW_HEAD = 'flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden'

/** Sub-line (consignee / customer · route). Always rendered, so an absent one still holds its line. */
export const DESK_ROW_META = 'mt-0.5 h-4 truncate text-xs leading-4 text-text-muted'

/** The sentence — why it fired, or why it is queued. Exactly two lines' worth, always.
 *  `h-10` is the reservation (2 × leading-5); `line-clamp-2` stops a third line from overflowing it. */
export const DESK_ROW_BODY = 'mt-1.5 h-10 overflow-hidden text-sm leading-5 line-clamp-2'

/** Relative timestamp. */
export const DESK_ROW_TIME = 'mt-1 h-4 text-xs leading-4 text-text-muted'
