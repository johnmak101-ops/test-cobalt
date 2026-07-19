/**
 * Shared column geometry for Review decision tables (POs & styles + field conflicts).
 * Both tables must use the same % tracks so stacked grids line up: label | existing | proposed.
 */
export const REVIEW_COL = {
  /** Field / PO# */
  label: 'w-[22%]',
  /** Existing / Current style */
  existing: 'w-[33%]',
  /** AI Proposed / From email · actions */
  proposed: 'w-[45%]',
} as const

export const REVIEW_TABLE_CLASS = 'w-full min-w-[36rem] table-fixed'

/**
 * Review card type scale — one ladder for every block on the decision desk.
 *
 * Priority (visual weight, high → low):
 *   1. Critical for sailing title
 *   2. Table / critical field values (what ops decide)
 *   3. Field labels + Needs attention lines
 *   4. Section chrome (kickers, table headers)
 *   5. Captions / soft warnings
 *
 * Sizes are stepped so chrome never outshouts decisions, and alerts never
 * outshout the critical band.
 */
export const REVIEW_FS = {
  /** 14px — Critical band title only */
  title: 'text-sm leading-snug',
  /** 13px — mono values (PO#, style, AI proposed, existing) */
  value: 'text-[13px] leading-snug',
  /** 12px — field labels, critical row names, needs-attention lines */
  body: 'text-xs leading-snug',
  /** 12px alias for labels (same as body; weight differs in components) */
  label: 'text-xs leading-snug',
  /** 11px — section kickers, group headers, table headers, counts */
  meta: 'text-[11px] leading-tight',
  /** 10px — captions under values, soft hints */
  caption: 'text-[10px] leading-tight',
} as const

/** Mono field value class used in tables */
export const REVIEW_VALUE = `field-value font-mono ${REVIEW_FS.value} text-text-primary`

export const REVIEW_TH = `px-3 py-2 text-left ${REVIEW_FS.meta} font-medium text-text-muted`

export const REVIEW_TD = `min-w-0 max-w-0 overflow-hidden px-3 py-2 ${REVIEW_FS.value}`

export const REVIEW_GROUP_HEADER = `px-3 py-1.5 text-left ${REVIEW_FS.meta} font-semibold uppercase tracking-wide text-text-muted`
