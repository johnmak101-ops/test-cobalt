import { z } from 'zod'

/**
 * Runtime contracts for the two cross-service seams:
 *   1. evidence.parsed_record.fields  — what the PARSER emits (cobalt-queue → track-system)
 *   2. match_decision                  — what the MATCHING AGENT emits (VM2 → committer on VM1)
 * `.passthrough()` keeps these lenient: the LLM may add fields; we store the full JSONB anyway.
 */

const nullishStr = z.string().nullish()

/** The 21 fields, one record per PO (mirrors email-parser-soul.md). */
export const ParsedFields = z
  .object({
    customer_code: nullishStr,
    customer_po: nullishStr,
    vendor_code: nullishStr,
    item_style_no: nullishStr,
    booking_no: nullishStr,
    so_no: nullishStr,
    hbl_awb_fcr_no: nullishStr,
    mbl: nullishStr,
    container_no: nullishStr,
    scac_code: nullishStr, // SCAC — ocean carrier code (keyword/4-letter regex in the parser)
    forwarder_name: nullishStr,
    consignee_name: nullishStr,
    consignee_address: nullishStr,
    cargo_ready_date: nullishStr,
    warehouse_start_date: nullishStr,
    warehouse_end_date: nullishStr,
    etd: nullishStr,
    atd: nullishStr,
    eta: nullishStr,
    in_dc_date: nullishStr,
    qty: z.union([z.number(), z.string()]).nullish(),
    poi: nullishStr, // port of loading (origin) — resolved to UN/LOCODE downstream
    pod: nullishStr, // port of discharge (destination)
  })
  .passthrough()
export type ParsedFields = z.infer<typeof ParsedFields>

/** The bag of keys a record can be matched on (booking# rotates away → never key on it alone). */
export const MatchKeys = z
  .object({
    customer_po: nullishStr,
    so_no: nullishStr,
    booking_no: nullishStr,
    hbl_awb_fcr_no: nullishStr,
    mbl: nullishStr,
    conversation_id: nullishStr,
  })
  .passthrough()
export type MatchKeys = z.infer<typeof MatchKeys>

export const Amendment = z.object({ field: z.string(), old: z.unknown().nullish(), new: z.unknown().nullish() })
export const NeedsReviewFlag = z.object({
  field: nullishStr,
  reason: z.string(),
  severity: z.enum(['high', 'medium', 'low']).nullish(),
})

/** A single parser record (one email × one PO). */
export const ParsedRecordZ = z.object({
  recordIdx: z.number(),
  poNo: z.string().nullable(),
  emailType: z.string(),
  senderType: z.string(),
  mode: z.string().nullable(),
  fields: ParsedFields,
  matchKeys: MatchKeys,
  amendments: z.array(Amendment),
  needsReview: z.array(NeedsReviewFlag),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type ParsedRecordZ = z.infer<typeof ParsedRecordZ>
