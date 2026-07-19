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
 * Review decision type scale (descending visual weight).
 *
 * | Role     | Size   | Use |
 * |----------|--------|-----|
 * | title    | 14px   | Band titles that demand action (Critical for sailing) |
 * | value    | 14px   | Mono field values (PO#, styles, AI proposed) |
 * | body     | 13px   | Readable alert lines, dense body copy |
 * | label    | 12px   | Field names, row labels |
 * | meta     | 11px   | Section kickers, table headers, group titles |
 * | caption  | 10px   | Hints under a value |
 */
export const REVIEW_FS = {
  title: 'text-sm', // 14px
  value: 'text-sm', // 14px
  body: 'text-[13px] leading-snug',
  label: 'text-xs', // 12px
  meta: 'text-[11px] leading-tight',
  caption: 'text-[10px] leading-tight',
} as const

/** Mono field value — Order Details / conflict / PO style parity */
export const REVIEW_VALUE = 'field-value font-mono text-sm text-text-primary'

export const REVIEW_TH =
  'px-3 py-2 text-left text-[11px] font-medium leading-tight text-text-muted'

export const REVIEW_TD =
  'min-w-0 max-w-0 overflow-hidden px-3 py-2.5 text-sm'

export const REVIEW_GROUP_HEADER =
  'px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide leading-tight text-text-muted'
