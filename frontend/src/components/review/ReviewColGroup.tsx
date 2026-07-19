import { REVIEW_COL_WIDTHS } from './review-table-layout'

/** Explicit <colgroup> so table-fixed columns stay aligned across stacked PO + conflict tables. */
export function ReviewColGroup() {
  return (
    <colgroup>
      {REVIEW_COL_WIDTHS.map((w) => (
        <col key={w} style={{ width: w }} />
      ))}
    </colgroup>
  )
}
