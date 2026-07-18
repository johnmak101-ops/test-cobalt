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
import {
  isRecomputedDataIssueReason,
  mergeReviewReasonsWithDataIssues,
  planPoReconcile,
} from '../src/reconcile/committer-po-reconciler'
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
    style: string
    poCount: number
  }>`
    SELECT sp.shipment_id AS shipmentId,
           po.item_style_no AS style,
           COUNT(*) AS poCount
    FROM shipment_pos sp
    INNER JOIN purchase_orders po ON po.id = sp.po_id
    WHERE po.item_style_no IS NOT NULL
      AND po.item_style_no LIKE '%,%'
    GROUP BY sp.shipment_id, po.item_style_no
    HAVING COUNT(*) >= 2
  `.execute(db)

  console.log(`Found ${candidates.rows.length} shipment×style broadcast signature(s)`)

  let updatedPos = 0
  let touchedShipments = 0

  for (const cand of candidates.rows) {
    const shipmentId = cand.shipmentId
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

    if (!changes.length) continue
    touchedShipments++
    console.log(`  shipment ${shipmentId}:`)
    for (const c of changes) {
      console.log(`    PO ${c.poNumber}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}${APPLY ? ' [written]' : ' [dry-run]'}`)
    }

    // Refresh leg review_reasons: drop stale style conflicts, leave others
    if (APPLY) {
      const leg = await db
        .selectFrom('shipments')
        .where('id', '=', shipmentId)
        .select(['id', 'reviewReasons', 'matchKeys'])
        .executeTakeFirst()
      if (leg) {
        const prior = (Array.isArray(leg.reviewReasons)
          ? (leg.reviewReasons as string[])
          : typeof leg.reviewReasons === 'string'
            ? (JSON.parse(leg.reviewReasons as string) as string[])
            : []) as string[]
        // Drop stale style-conflict / style-broadcast reasons, re-plan from current enrichment
        const kept = prior.filter(
          (r) => !(isRecomputedDataIssueReason(r) && /item(?:_style_no conflict|\/style)/i.test(r)),
        )
        const plan = planPoReconcile({
          pos,
          fields: {},
          poEnrichment: enrichment,
          unattributed: [],
          gk: strongKeys((leg.matchKeys as Record<string, unknown>) ?? {}),
        })
        const next = mergeReviewReasonsWithDataIssues(kept, plan.poFlagReasons)
        await db
          .updateTable('shipments')
          .set({ reviewReasons: next as never, updatedAt: new Date() })
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
