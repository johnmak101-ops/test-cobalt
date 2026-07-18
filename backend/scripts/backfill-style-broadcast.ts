/**
 * Table-truth P5 — repair PO item_style_no when ≥2 linked POs share an identical multi-token
 * broadcast list. Re-runs resolvePoEnrichment over stored parsed_record evidence (no re-parse).
 *
 * Usage (from backend/):
 *   pnpm exec ts-node -P tsconfig.json scripts/backfill-style-broadcast.ts           # dry-run
 *   pnpm exec ts-node -P tsconfig.json scripts/backfill-style-broadcast.ts --apply  # write
 *
 * Never run against the demo DB without reviewing the plan output first.
 * Spec: docs/superpowers/specs/2026-07-18-table-truth-one-shot-design.md
 */
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import type { DB } from '../src/db/kysely/db'
import { resolvePoEnrichment, styleCommaCount, type PoEvidenceInput } from '../src/reconcile/po-enrichment'
import { normKey } from '../src/reconcile/match-keys'
import { planPoReconcile } from '../src/reconcile/committer-po-reconciler'
import { strongKeys } from '../src/reconcile/match-keys'

const SQL_SERVER_URL =
  process.env.SQL_SERVER_URL ??
  'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

const APPLY = process.argv.includes('--apply')

async function main() {
  if (/cobalt_demo|demo/i.test(SQL_SERVER_URL) && APPLY) {
    console.error('Refusing --apply against a demo-looking database. Unset SEED_DEMO targets and re-check SQL_SERVER_URL.')
    process.exit(2)
  }

  const db = createKysely<DB>(SQL_SERVER_URL)
  console.log(APPLY ? 'MODE: APPLY' : 'MODE: dry-run (pass --apply to write)')
  console.log('DB:', SQL_SERVER_URL.replace(/Password=[^;]+/i, 'Password=***'))

  // Shipments with ≥2 POs that share the same multi-token item_style_no (broadcast signature)
  const candidates = await sql<{
    shipmentId: string
  }>`
    SELECT sp.shipment_id AS shipmentId
    FROM shipment_pos sp
    INNER JOIN purchase_orders po ON po.id = sp.po_id
    WHERE po.item_style_no IS NOT NULL
      AND po.item_style_no LIKE '%,%'
    GROUP BY sp.shipment_id, po.item_style_no
    HAVING COUNT(*) >= 2
  `.execute(db)

  // ALSO: legs still carrying a style conflict/broadcast reason (old dump or new format). The PO rows
  // may already be fixed (a prior run, or another leg of the same booking processed first) — such legs
  // never surface via the signature query, yet their stale reasons are exactly what needs refreshing.
  // Verification found the IZAC ACTIVE leg stranded this way.
  const staleReasonLegs = await sql<{ shipmentId: string }>`
    SELECT s.id AS shipmentId
    FROM shipments s
    WHERE CAST(s.review_reasons AS NVARCHAR(MAX)) LIKE '%item_style_no conflict%'
       OR CAST(s.review_reasons AS NVARCHAR(MAX)) LIKE '%item/style%'
  `.execute(db)

  const shipmentIds = [...new Set([
    ...candidates.rows.map((r) => r.shipmentId),
    ...staleReasonLegs.rows.map((r) => r.shipmentId),
  ])]
  console.log(
    `Found ${candidates.rows.length} broadcast signature(s) + ${staleReasonLegs.rows.length} leg(s) with style reasons → ${shipmentIds.length} shipment(s) to examine`,
  )

  let updatedPos = 0
  let touchedShipments = 0

  for (const shipmentId of shipmentIds) {
    // Linked POs for this shipment
    const linked = await db
      .selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .where('shipmentPos.shipmentId', '=', shipmentId)
      .select([
        'purchaseOrders.id as poId',
        'purchaseOrders.poNumber as poNumber',
        'purchaseOrders.itemStyleNo as itemStyleNo',
      ])
      .execute()

    const pos = linked.map((r) => r.poNumber)
    const posNorm = pos.map((p) => normKey(p)).filter(Boolean)

    // Evidence: every parsed_record on any email that mentions these POs
    const msgRows = posNorm.length
      ? await db
          .selectFrom('parsedRecord')
          .select('messageId')
          .where('poNoNorm', 'in', posNorm)
          .execute()
      : []
    const messageIds = [...new Set(msgRows.map((r) => r.messageId).filter(Boolean))] as string[]
    if (!messageIds.length) {
      console.log(`  skip ${shipmentId}: no parsed_record evidence for linked POs`)
      continue
    }

    const evidence = (await db
      .selectFrom('parsedRecord')
      .innerJoin('emailMessage', 'parsedRecord.messageId', 'emailMessage.id')
      .where('parsedRecord.messageId', 'in', messageIds)
      .select([
        'parsedRecord.id',
        'parsedRecord.messageId',
        'parsedRecord.fields',
        'parsedRecord.matchKeys',
        'parsedRecord.poNo',
        'emailMessage.receivedAt',
      ])
      .execute()) as PoEvidenceInput[]

    const enrichment = resolvePoEnrichment(evidence)
    const changes: { poNumber: string; from: string | null; to: string | null }[] = []

    for (const po of linked) {
      const enr = enrichment.get(normKey(po.poNumber))
      if (!enr?.itemStyleNo) continue
      const from = po.itemStyleNo
      const to = enr.itemStyleNo
      if ((from ?? '') === (to ?? '')) continue
      // Only rewrite when current looks multi-token (broadcast) OR new is more specific
      if (from && styleCommaCount(from) >= 2 && styleCommaCount(to) <= styleCommaCount(from)) {
        changes.push({ poNumber: po.poNumber, from, to })
        if (APPLY) {
          await db
            .updateTable('purchaseOrders')
            .set({ itemStyleNo: to, updatedAt: new Date() })
            .where('id', '=', po.poId)
            .execute()
          await db
            .insertInto('changeLog')
            .values({
              entityType: 'purchase_order',
              entityId: po.poId,
              field: 'itemStyleNo',
              oldValue: from,
              newValue: to,
              changeType: 'update',
              sourceType: 'system',
              actorUserId: null,
              note: 'table-truth P5 backfill: specific-beats-superset style re-derive (no re-parse)',
            } as never)
            .execute()
          updatedPos++
        }
      }
    }

    // Reason refresh — DECOUPLED from `changes`: shipment_pos links the same POs to multiple legs
    // (active + superseded/cancelled). The first leg processed fixes the PO rows; later legs then see
    // from===to, so gating the refresh on `changes` stranded their stale dumps (the IZAC ACTIVE leg).
    const leg = await db
      .selectFrom('shipments')
      .where('id', '=', shipmentId)
      .select(['id', 'reviewReasons', 'matchKeys'])
      .executeTakeFirst()
    let next: string[] = []
    let staleDropped = 0
    let reasonsChanged = false
    if (leg) {
      const prior = (Array.isArray(leg.reviewReasons)
        ? (leg.reviewReasons as string[])
        : typeof leg.reviewReasons === 'string'
          ? (JSON.parse(leg.reviewReasons as string) as string[])
          : []) as string[]
      // Drop ONLY the enrichment-derived brand/style classes that the plan below regenerates — NOT the
      // whole recomputed class (mergeReviewReasonsWithDataIssues): with fields:{} the plan cannot
      // regenerate qty issues, so a full-class drop would silently lose legitimate qty reasons.
      const ENRICH_RE = /^PO\s+\S+:\s*(?:brand conflict\b|item(?:_style_no conflict\b|\/style))/i
      const kept = prior.filter((r) => !ENRICH_RE.test(String(r)))
      staleDropped = prior.length - kept.length
      const plan = planPoReconcile({
        pos,
        fields: {},
        poEnrichment: enrichment,
        unattributed: [],
        gk: strongKeys((leg.matchKeys as Record<string, unknown>) ?? {}),
      })
      next = [...new Set([...kept, ...plan.poFlagReasons])]
      // REPLACE stale flags, never seed flags onto legs that had none: only a leg that dropped a stale
      // enrichment reason (or whose PO rows changed this run) gets the freshly-derived plan flags.
      // Otherwise a backfill would spray brand/style flags across every examined leg — review-queue churn.
      reasonsChanged =
        (staleDropped > 0 || changes.length > 0) &&
        (next.length !== prior.length || next.some((r, i) => r !== prior[i]))
    }

    if (!changes.length && !reasonsChanged) continue
    touchedShipments++
    console.log(`  shipment ${shipmentId}:`)
    for (const c of changes) {
      console.log(`    PO ${c.poNumber}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}${APPLY ? ' [written]' : ' [dry-run]'}`)
    }
    if (reasonsChanged) {
      console.log(
        `    reasons: ${staleDropped} enrichment reason(s) re-derived → ${next.length} total${APPLY ? ' [written]' : ' [dry-run]'}`,
      )
      if (APPLY) {
        // review_reasons is nvarchar(max) JSON — tedious rejects a raw JS array
        await db
          .updateTable('shipments')
          .set({ reviewReasons: JSON.stringify(next) as never, updatedAt: new Date() })
          .where('id', '=', shipmentId)
          .execute()
      }
    }
  }

  console.log(
    APPLY
      ? `Done. Updated ${updatedPos} PO row(s) across ${touchedShipments} shipment(s).`
      : `Dry-run complete. Would touch ${touchedShipments} shipment(s). Re-run with --apply to write.`,
  )
  await db.destroy()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
