/**
 * Repair PO item_style_no when nested-subset union (Task 1 pickItemStyleNo) would
 * upgrade a single-token stored style to a proper multi-token superset from evidence.
 *
 * Prefer candidates: purchase_orders with a non-null single-token item_style_no
 * (no comma). Re-runs resolvePoEnrichment over stored parsed_record evidence (no re-parse).
 *
 * Usage (from backend/):
 *   pnpm exec ts-node -P tsconfig.json scripts/backfill-po-style-subset-union.ts           # dry-run
 *   pnpm exec ts-node -P tsconfig.json scripts/backfill-po-style-subset-union.ts --apply  # write
 *
 * Never run against the demo DB without reviewing the plan output first.
 * Spec: cobalt-queue docs/superpowers/specs/2026-07-21-po-item-style-subset-union-design.md
 */
import { createKysely } from '../src/db/kysely/mssql-dialect'
import type { DB } from '../src/db/kysely/db'
import { resolvePoEnrichment, type PoEvidenceInput } from '../src/reconcile/po-enrichment'
import { isStyleTokenSuperset } from '../src/lib/style-tokens'
import { normKey } from '../src/reconcile/match-keys'

const SQL_SERVER_URL =
  process.env.SQL_SERVER_URL ??
  'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

const APPLY = process.argv.includes('--apply')
/** Allow --apply against demo-looking URLs only with this flag. */
const FORCE = process.argv.includes('--force')

async function main() {
  if (/cobalt_demo|demo/i.test(SQL_SERVER_URL) && APPLY && !FORCE) {
    console.error(
      'Refusing --apply against a demo-looking database. Pass --force if intentional, or re-check SQL_SERVER_URL.',
    )
    process.exit(2)
  }

  const db = createKysely<DB>(SQL_SERVER_URL)
  console.log(APPLY ? 'MODE: APPLY' : 'MODE: dry-run (pass --apply to write)')
  console.log('DB:', SQL_SERVER_URL.replace(/Password=[^;]+/i, 'Password=***'))

  // Single-token item_style_no only — multi-token rows already have ≥2 styles; union upgrade
  // targets incomplete INV/PL singles that lost a nested multi-style list (Set1 PO 25312).
  const candidates = await db
    .selectFrom('purchaseOrders')
    .select(['id', 'poNumber', 'itemStyleNo'])
    .where('itemStyleNo', 'is not', null)
    .where((eb) => eb.not(eb('itemStyleNo', 'like', '%,%')))
    .execute()

  console.log(`Candidates (single-token item_style_no): ${candidates.length}`)

  if (!candidates.length) {
    console.log('Nothing to examine.')
    await db.destroy()
    return
  }

  const posNorm = [
    ...new Set(candidates.map((c) => normKey(c.poNumber)).filter(Boolean)),
  ] as string[]

  // Message-complete evidence: every record on any email that mentions these POs
  // (same shape as EvidenceRepository.forCommitEnrichment path A / style-broadcast backfill).
  const msgRows = await db
    .selectFrom('parsedRecord')
    .select('messageId')
    .where('poNoNorm', 'in', posNorm)
    .execute()
  const messageIds = [...new Set(msgRows.map((r) => r.messageId).filter(Boolean))] as string[]

  if (!messageIds.length) {
    console.log('No parsed_record evidence for any candidate PO (po_no_norm).')
    await db.destroy()
    return
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

  console.log(
    `Evidence: ${evidence.length} parsed_record row(s) across ${messageIds.length} message(s)`,
  )

  const enrichment = resolvePoEnrichment(evidence)

  type PlanRow = {
    poId: string
    poNumber: string
    old: string
    neu: string
    apply: boolean
    reason: string
  }
  const plan: PlanRow[] = []
  let wouldApply = 0

  for (const po of candidates) {
    const key = normKey(po.poNumber)
    const old = (po.itemStyleNo ?? '').trim()
    const enr = enrichment.get(key)
    const neu = (enr?.itemStyleNo ?? '').trim()

    if (!neu) {
      plan.push({
        poId: po.id,
        poNumber: po.poNumber,
        old,
        neu: '',
        apply: false,
        reason: 'no-enrich-style',
      })
      continue
    }
    if (old.toUpperCase() === neu.toUpperCase() || old === neu) {
      plan.push({
        poId: po.id,
        poNumber: po.poNumber,
        old,
        neu,
        apply: false,
        reason: 'unchanged',
      })
      continue
    }
    if (!isStyleTokenSuperset(neu, old)) {
      plan.push({
        poId: po.id,
        poNumber: po.poNumber,
        old,
        neu,
        apply: false,
        reason: 'not-superset',
      })
      continue
    }

    plan.push({
      poId: po.id,
      poNumber: po.poNumber,
      old,
      neu,
      apply: true,
      reason: 'superset-upgrade',
    })
    wouldApply++
  }

  // Prefer showing upgrades first, then interesting skips, then bulk unchanged.
  plan.sort((a, b) => {
    const rank = (r: PlanRow) =>
      r.apply ? 0 : r.reason === 'not-superset' ? 1 : r.reason === 'no-enrich-style' ? 2 : 3
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    return a.poNumber.localeCompare(b.poNumber)
  })

  console.log('')
  console.log('poNumber\told\tnew\tapply?\treason')
  for (const r of plan) {
    // Always print upgrades; print other rows when few candidates or when specifically 25312.
    if (
      r.apply ||
      r.poNumber === '25312' ||
      r.reason === 'not-superset' ||
      plan.length <= 40
    ) {
      console.log(
        `${r.poNumber}\t${JSON.stringify(r.old)}\t${JSON.stringify(r.neu)}\t${r.apply ? 'YES' : 'no'}\t${r.reason}`,
      )
    }
  }
  if (plan.length > 40) {
    const skipped = plan.filter((r) => !r.apply && r.reason === 'unchanged').length
    console.log(`… ${skipped} unchanged single-token PO(s) omitted from table`)
  }

  if (APPLY) {
    let updated = 0
    for (const r of plan) {
      if (!r.apply) continue
      await db
        .updateTable('purchaseOrders')
        .set({ itemStyleNo: r.neu, updatedAt: new Date() })
        .where('id', '=', r.poId)
        .execute()
      await db
        .insertInto('changeLog')
        .values({
          entityType: 'purchase_order',
          entityId: r.poId,
          field: 'itemStyleNo',
          oldValue: r.old,
          newValue: r.neu,
          changeType: 'update',
          sourceType: 'system',
          actorUserId: null,
          note: 'po-style subset-union backfill: nested superset upgrade from parsed evidence',
        } as never)
        .execute()
      updated++
      console.log(`  wrote PO ${r.poNumber}: ${JSON.stringify(r.old)} → ${JSON.stringify(r.neu)}`)
    }
    console.log(`Done. Updated ${updated} PO row(s).`)
  } else {
    console.log(
      `Dry-run complete. Would upgrade ${wouldApply} PO row(s). Re-run with --apply to write.`,
    )
  }

  await db.destroy()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
