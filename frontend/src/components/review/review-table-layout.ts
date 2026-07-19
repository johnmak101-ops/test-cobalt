/**
 * Shared column geometry for Review decision tables (POs & styles + field conflicts).
 * Both tables must use the same tracks so stacked grids line up:
 *   Field/PO# | Current | From email / AI
 */
export const REVIEW_COL = {
  /** Field name / PO# */
  label: 'w-[24%]',
  /** Current system / style on shipment */
  existing: 'w-[32%]',
  /** AI / email proposed */
  proposed: 'w-[44%]',
} as const

/** Widths for <colgroup> (inline styles set from ReviewColGroup in .tsx). */
export const REVIEW_COL_WIDTHS = ['24%', '32%', '44%'] as const

export const REVIEW_TABLE_CLASS = 'w-full min-w-[36rem] table-fixed border-collapse'

/**
 * Review card type scale — one ladder for every block on the decision desk.
 *
 * | Role    | Size | Use |
 * |---------|------|-----|
 * | topic   | 16px | Panel titles: Needs attention |
 * | value   | 14px | PO#, styles, AI, existing (mono) |
 * | body    | 14px | Field labels, critical rows, needs-attention lines |
 * | meta    | 12px | Subtitles, table headers, group titles, counts |
 * | caption | 11px | Hints under values |
 */
export const REVIEW_FS = {
  /** Section topic titles (Needs attention) */
  topic: 'text-base leading-snug',
  /** @deprecated use topic — kept as alias */
  title: 'text-base leading-snug',
  value: 'text-sm leading-snug',
  body: 'text-sm leading-snug',
  label: 'text-sm leading-snug',
  meta: 'text-xs leading-tight',
  caption: 'text-[11px] leading-tight',
} as const

/** Mono field value class used in tables */
export const REVIEW_VALUE = `field-value font-mono ${REVIEW_FS.value} text-text-primary`

export const REVIEW_TH = `px-3 py-2.5 text-left ${REVIEW_FS.meta} font-medium text-text-muted`

export const REVIEW_TD = `min-w-0 overflow-hidden px-3 py-2.5 align-top ${REVIEW_FS.value}`

export const REVIEW_GROUP_HEADER = `px-3 py-2 text-left ${REVIEW_FS.meta} font-semibold uppercase tracking-wide text-text-muted bg-surface-900/30`

/** Shared thead labels — same wording on PO + conflict tables so columns read as one grid. */
export const REVIEW_HEAD = {
  label: 'Field / PO#',
  existing: 'Current',
  proposed: 'From email / AI',
} as const

/** Shared status-panel shell for Needs attention. */
export const REVIEW_PANEL =
  'rounded-lg border border-border bg-surface-900 px-3 py-2.5'

/** Bullet list under a status panel. */
export const REVIEW_PANEL_LIST = 'mt-1.5 space-y-1'

export const REVIEW_PANEL_ITEM =
  'flex min-w-0 items-start gap-2 text-sm leading-snug text-text-secondary'

export const REVIEW_PANEL_DOT = 'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full'
