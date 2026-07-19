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
 * Shared type scale for Review decision UI (tables, critical band, style lists).
 * Prevents body (16px) inheritance on bare "—" / labels, and PO (xs) vs style (sm) mismatch.
 */
export const REVIEW_FS = {
  /** Section titles, table headers, group labels */
  meta: 'text-[11px]',
  /** Captions / secondary hints under a value */
  caption: 'text-[10px]',
  /** Row labels (field name, section body labels) */
  label: 'text-xs',
  /** Field values (PO#, styles, AI proposed, critical missing values) */
  value: 'text-sm',
} as const

/** Mono field value — Order Details / conflict / PO style parity */
export const REVIEW_VALUE =
  'field-value font-mono text-sm text-text-primary'

export const REVIEW_TH =
  'px-3 py-2 text-left text-[11px] font-medium text-text-muted'

export const REVIEW_TD =
  'min-w-0 max-w-0 overflow-hidden px-3 py-2.5 text-sm'

export const REVIEW_GROUP_HEADER =
  'px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted'
