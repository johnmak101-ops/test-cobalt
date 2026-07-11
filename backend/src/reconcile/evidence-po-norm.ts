/**
 * Normalized PO key for a parsed_record row — FROZEN parity with po-enrichment `poKeyOf`
 * (`normKey(po_no) || normKey(match_keys.customer_po)`). Written to `parsed_record.po_no_norm` on
 * ingest so `forCommitEnrichment` can find emails that mention a target PO without scanning the table.
 */
import { normKey } from './match-keys'

/** Empty string → null (SQL index column stores null when the record belongs to no PO). */
export function evidencePoNorm(
  poNo: unknown,
  matchKeys: Record<string, unknown> | null | undefined,
): string | null {
  const n = normKey(poNo) || normKey(matchKeys?.customer_po)
  return n || null
}
