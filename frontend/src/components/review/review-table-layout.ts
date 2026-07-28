/**
 * Shared column geometry for Review decision tables (POs & styles + field conflicts).
 * Both tables must use the same tracks so stacked grids line up:
 *   Field/PO# | Current | From email / AI | Reference Email
 *
 * The reference column carries the "which email said this?" affordance. It exists on BOTH tables
 * even though only the conflict table fills it — dropping it from the PO table would knock the two
 * grids out of alignment, which is the one thing this module exists to prevent.
 */
export const REVIEW_COL = {
  /** Field name / PO# */
  label: 'w-[20%]',
  /** Current system / style on shipment */
  existing: 'w-[27%]',
  /** AI / email proposed */
  proposed: 'w-[41%]',
  /** Source-email link per proposed candidate */
  reference: 'w-[12%]',
} as const

/** Widths for <colgroup> (inline styles set from ReviewColGroup in .tsx). */
export const REVIEW_COL_WIDTHS = ['20%', '27%', '41%', '12%'] as const

/** min-width up from 36rem: four tracks need the room before the reference header wraps to three lines. */
export const REVIEW_TABLE_CLASS = 'w-full min-w-[42rem] table-fixed border-collapse'

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

/**
 * Table group headers. Sentence/Title case as written in the source string — NOT uppercased in CSS.
 * Titles and subtitles across the review card capitalise the first letter only; ALL CAPS made the
 * group header shout louder than the panel title above it.
 */
export const REVIEW_GROUP_HEADER = `px-3 py-2 text-left ${REVIEW_FS.meta} font-semibold text-text-muted bg-surface-900/30`

/** Shared thead labels for the conflict grid. The POs & Styles section keeps these column TRACKS
 *  but names its own first two columns "PO" / "Item/Style" (#358) — the generic wording never fit
 *  its rows.
 *
 *  `proposed` is a track name, not a claim: nothing in that column is awaiting an apply. Conflicts
 *  the commit settled are stripped upstream (openDecisions), so every value that reaches it is one
 *  the committer read and did not write. "AI Proposed" said the opposite and was wrong.
 *
 *  It said "Also Seen In Email", which was true while every value in the column came from an email.
 *  It no longer does: an unlinked party's row offers Mesh MASTERS — five LOGWIN branches that appear
 *  in no email at all — so the header was captioning them as something the sender wrote. "Other
 *  values" is true of both, and each row still shows its own provenance (a master code chip, the
 *  reference email) where the header cannot. */
export const REVIEW_HEAD = {
  label: 'Field / PO#',
  existing: 'Current',
  proposed: 'Other values',
  reference: 'Reference Email',
} as const

/** Shared status-panel shell for Needs attention. */
export const REVIEW_PANEL =
  'rounded-lg border border-border bg-surface-900 px-3 py-2.5'

/** Bullet list under a status panel. */
export const REVIEW_PANEL_LIST = 'mt-1.5 space-y-1'

export const REVIEW_PANEL_ITEM =
  'flex min-w-0 items-start gap-2 text-sm leading-snug text-text-secondary'

export const REVIEW_PANEL_DOT = 'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full'
