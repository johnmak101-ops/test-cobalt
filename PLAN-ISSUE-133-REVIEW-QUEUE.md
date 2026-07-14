# Issue #133 Review-Queue Noise Implementation Plan

> **For agentic workers (any agent — Grok, Claude, human):** Execute strictly task-by-task, in order. Within a task run every step in sequence — write the failing test, SEE it fail, implement, SEE it pass, commit. Check off steps (`- [ ]` → `- [x]`) in this file as you go. Do not batch commits across tasks, do not skip a failing-test step, and do not refactor beyond what a step specifies.

**Goal:** Let ops filter the shipment Review Queue by reason category and bulk-dismiss noise (portal echoes etc.) without poisoning the learning feed, plus pin the multi-HBL no-fusion guarantee with a regression test.

**Architecture:** Dismiss = stamp the existing `shipments.dismissed_at` column (no migration; `review_status` stays `provisional` so dismissed rows never enter `activeConfirmedLegs`/alerts). Queue queries gain a pending/dismissed view split. Reason categorisation is client-side pattern matching next to the existing humanizer. Spec: `SPEC-ISSUE-133-REVIEW-QUEUE.md` (repo root, committed).

**Tech Stack:** NestJS + Kysely (SQL Server) backend, React 19 + TanStack Query + Tailwind frontend, vitest both sides.

## Global Constraints

- Working branch: `fix/133-review-queue-dismiss-filter` (already created; design doc committed).
- NEVER `pnpm -C <pkg>` — run tools via `<pkg>/node_modules/.bin/*` (build-infra gotcha).
- Backend int tests need the local SQL Server container `mssql-2022` on :1433 (already running); test DB `cobalt_test` auto-migrates.
- This plan + the spec live at the repo root, committed on the working branch (repo convention, cf. `LLM-MASTER-MATCHER-SPEC.md`).
- De-correction principle (project rule): never add code that silently corrects agent/matcher values — surface via review flags. Dismiss/restore only stamp verdict metadata; they never rewrite shipment fields.
- Dismiss must NOT set `reviewStatus='confirmed'` and must NOT call `QueueLearningClient.postCorrection` (no confirm-sentinels for noise).
- Raw SQL fragments bypass Kysely's CamelCasePlugin — write `dismissed_at` (snake_case) inside `sql<...>` templates, camelCase in the query builder.
- Commit after every task (conventional commits, `Refs #133`, Co-Authored-By trailer).

---

### Task 1: Repository — queue views + counts exclude dismissed

**Files:**
- Modify: `backend/src/db/repositories/shipment.repository.ts:138-183` (provisionalLegs, reviewQueue, reviewQueueCount)
- Modify: `backend/src/presentation/presentation.service.ts:316-342` (compile-breaks on the rename; wire-through here)
- Modify: `backend/src/shipments/shipments.controller.ts:32-39` (pass `?view`)
- Test: `backend/test/shipment.kysely.int.spec.ts:107-124`

**Interfaces:**
- Consumes: existing `ShipmentRepository` query builder + `sql` import (already in file).
- Produces:
  - `reviewQueue(view?: 'pending' | 'dismissed')` — default `'pending'`; row gains `dismissedAt: Date | null`.
  - `reviewQueueCounts(): Promise<{ pending: number; dismissed: number }>` — REPLACES `reviewQueueCount()`.
  - `provisionalLegs()` now excludes dismissed rows.
  - `PresentationService.reviewQueue(view)` returns rows with `dismissedAt: string | null`; `reviewQueueCounts()` returns `{ provisional, dismissed }`.
  - `GET /api/shipments/review-queue?view=pending|dismissed`.

- [ ] **Step 1: Write the failing test** — in `backend/test/shipment.kysely.int.spec.ts`, replace the body of the existing `it('reviewQueue + reviewQueueCount …')` test (line 107) with:

```ts
  it('reviewQueue views + reviewQueueCounts (pending vs dismissed)', async () => {
    const b = await seedBooking()
    const c = await seedCustomer(`RQ${mark}`)
    await db.updateTable('bookings').set({ customerId: c }).where('id', '=', b).execute()
    const polId = await seedPort(`HKHKG${mark}`)
    const leg = await seedLeg({ bookingId: b, legNo: 21, reviewStatus: 'provisional', kind: 'SHIPMENT', confidence: 25, polId })
    await db.updateTable('shipments').set({ legStatus: 'ACTIVE' }).where('id', '=', leg.id).execute()
    await seedLeg({ bookingId: b, legNo: 22, reviewStatus: 'provisional', kind: 'DOCUMENT' }) // document excluded
    await seedLeg({ bookingId: b, legNo: 23, reviewStatus: 'confirmed', kind: 'SHIPMENT' }) // confirmed excluded
    const gone = await seedLeg({ bookingId: b, legNo: 24, reviewStatus: 'provisional', kind: 'SHIPMENT', dismissedAt: new Date() })

    const q = await repo.reviewQueue()
    const found = q.find((r) => r.id === leg.id)
    expect(found).toBeTruthy()
    expect(found?.customerCode).toBe(`RQ${mark}`)
    expect(found?.polCode).toBe(`HKHKG${mark}`)
    expect(q.find((r) => r.id === gone.id)).toBeUndefined() // dismissed rows leave the pending queue

    const d = await repo.reviewQueue('dismissed')
    expect(d.find((r) => r.id === gone.id)).toBeTruthy()
    expect(d.find((r) => r.id === leg.id)).toBeUndefined()

    const counts = await repo.reviewQueueCounts()
    expect(counts.pending).toBeGreaterThanOrEqual(1)
    expect(counts.dismissed).toBeGreaterThanOrEqual(1)

    // provisionalLegs (the /api/review list) must also skip dismissed rows
    const prov = await repo.provisionalLegs()
    expect(prov.find((r) => r.id === gone.id)).toBeUndefined()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd backend && ./node_modules/.bin/vitest run test/shipment.kysely.int.spec.ts)`
Expected: FAIL — `repo.reviewQueueCounts is not a function` (and/or dismissed row present in pending view).

- [ ] **Step 3: Implement repository changes** — in `backend/src/db/repositories/shipment.repository.ts`:

Replace `provisionalLegs()` (line 138-141):

```ts
  /** Provisional legs awaiting human review (lowest confidence first). Dismissed rows are excluded —
   *  a human already ruled "not a trackable shipment" (see reviewQueue views). */
  provisionalLegs() {
    return this.db
      .selectFrom('shipments')
      .where('reviewStatus', '=', 'provisional')
      .where('dismissedAt', 'is', null)
      .orderBy('confidence', 'asc')
      .selectAll()
      .execute()
  }
```

Change `reviewQueue()` signature (line 148) to `reviewQueue(view: 'pending' | 'dismissed' = 'pending')`, add after the `.where('shipments.legStatus', '<>', 'SUPERSEDED')` line:

```ts
      .where('shipments.dismissedAt', view === 'dismissed' ? 'is not' : 'is', null)
```

and add to the `.select([...])` list:

```ts
        'shipments.dismissedAt as dismissedAt',
```

Replace `reviewQueueCount()` (lines 173-183) with:

```ts
  /** Pending vs dismissed provisional counts — nav badge reads pending; the queue's Dismissed tab reads both. */
  async reviewQueueCounts(): Promise<{ pending: number; dismissed: number }> {
    const row = await this.db
      .selectFrom('shipments')
      .where('kind', '=', 'SHIPMENT')
      .where('reviewStatus', '=', 'provisional')
      .where('legStatus', '<>', 'SUPERSEDED')
      .select([
        sql<number>`sum(case when dismissed_at is null then 1 else 0 end)`.as('pending'),
        sql<number>`sum(case when dismissed_at is not null then 1 else 0 end)`.as('dismissed'),
      ])
      .executeTakeFirst()
    return { pending: Number(row?.pending ?? 0), dismissed: Number(row?.dismissed ?? 0) }
  }
```

- [ ] **Step 4: Wire the rename through presentation + controller** — in `backend/src/presentation/presentation.service.ts` replace `reviewQueue()` signature (line 316) and counts (lines 339-342):

```ts
  async reviewQueue(view: 'pending' | 'dismissed' = 'pending') {
    const rows = await this.shipmentRepo.reviewQueue(view)
```

(inside the row mapping object, after `poCount: r.poCount ?? 0,` add)

```ts
        dismissedAt: isoOrNull(r.dismissedAt),
```

```ts
  /** Nav badge count of provisional shipments awaiting review (+ dismissed for the queue tab). */
  async reviewQueueCounts() {
    const c = await this.shipmentRepo.reviewQueueCounts()
    return { provisional: c.pending, dismissed: c.dismissed }
  }
```

In `backend/src/shipments/shipments.controller.ts` (line 32):

```ts
  @Get('review-queue') reviewQueue(@Query('view') view?: string) {
    return this.ui.reviewQueue(view === 'dismissed' ? 'dismissed' : 'pending')
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `(cd backend && ./node_modules/.bin/vitest run test/shipment.kysely.int.spec.ts)`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/repositories/shipment.repository.ts backend/src/presentation/presentation.service.ts backend/src/shipments/shipments.controller.ts backend/test/shipment.kysely.int.spec.ts
git commit -m "feat(review): pending/dismissed queue views + counts exclude dismissed (#133)"
```

---

### Task 2: ReviewService.dismiss / restore + API endpoints

**Files:**
- Modify: `backend/src/review/dto.ts`
- Modify: `backend/src/review/review.service.ts`
- Modify: `backend/src/review/review.controller.ts`
- Test: `backend/test/review.int.spec.ts`

**Interfaces:**
- Consumes: `ShipmentRepository.findById/updateLeg`, `AuditRepository.write`, Task 1's dismissed-aware `provisionalLegs()`.
- Produces:
  - `ReviewService.dismiss(shipmentIds: string[], actorId: string, note?: string): Promise<{ dismissed: number }>`
  - `ReviewService.restore(shipmentId: string, actorId: string): Promise<{ shipmentId: string; restored: boolean }>`
  - `POST /api/review/dismiss` body `{ shipmentIds: string[], note?: string }` (EDITOR+)
  - `POST /api/review/:id/restore` (EDITOR+)

- [ ] **Step 1: Write the failing tests** — append to the `describe('ReviewService (integration)')` block in `backend/test/review.int.spec.ts` (before the closing `})`):

```ts
  describe('dismiss / restore (#133)', () => {
    function spyLearning() {
      const posts: unknown[] = []
      const client = { postCorrection: async (p: unknown) => { posts.push(p) } } as unknown as QueueLearningClient
      return { posts, client }
    }
    function svcWith(client: QueueLearningClient) {
      const r = repos(db)
      return new ReviewService(r.shipment, r.booking, r.fieldLock, r.audit, client)
    }

    it('dismiss stamps dismissed_at + reviewer, audits, drops from queue(), and posts NO learning signals', async () => {
      const { leg } = await seedProvisional('JOB-D-1', 30)
      const { posts, client } = spyLearning()
      const svc = svcWith(client)

      const res = await svc.dismiss([leg.id], reviewerId, 'portal echo — no carrier move')
      expect(res).toEqual({ dismissed: 1 })

      const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
      expect(updated.dismissedAt).not.toBeNull()
      expect(updated.reviewStatus).toBe('provisional') // NEVER confirmed — stays out of alerts/automation
      expect(updated.reviewedBy).toBe(reviewerId)
      expect(updated.reviewedAt).not.toBeNull()

      expect((await svc.queue()).find((q) => q.id === leg.id)).toBeUndefined()

      const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
      expect(audit.some((a) => a.newValue === 'dismissed' && /portal echo/.test(a.note ?? ''))).toBe(true)
      expect(posts).toHaveLength(0) // dismissal teaches nothing — approving noise would poison the feed
    })

    it('dismiss skips confirmed / DOCUMENT / already-dismissed / unknown ids but processes the rest', async () => {
      const { leg: ok } = await seedProvisional('JOB-D-2', 30)
      const { leg: confirmed } = await seedProvisional('JOB-D-3', 30, { reviewStatus: 'confirmed' })
      const { leg: doc } = await seedProvisional('JOB-D-4', 30, { kind: 'DOCUMENT' })
      const { leg: gone } = await seedProvisional('JOB-D-5', 30, { dismissedAt: new Date('2026-07-01T00:00:00Z') })
      const svc = svcWith(spyLearning().client)

      const res = await svc.dismiss(
        [ok.id, confirmed.id, doc.id, gone.id, '00000000-0000-0000-0000-000000000000'],
        reviewerId,
      )
      expect(res).toEqual({ dismissed: 1 })

      const rows = await db.selectFrom('shipments').where('id', 'in', [ok.id, confirmed.id]).selectAll().execute()
      expect(rows.find((r) => r.id === ok.id)?.dismissedAt).not.toBeNull()
      expect(rows.find((r) => r.id === confirmed.id)?.dismissedAt).toBeNull()
    })

    it('restore clears dismissed_at, audits, and the leg returns to queue()', async () => {
      const { leg } = await seedProvisional('JOB-D-6', 30)
      const svc = svcWith(spyLearning().client)
      await svc.dismiss([leg.id], reviewerId)

      const res = await svc.restore(leg.id, reviewerId)
      expect(res).toEqual({ shipmentId: leg.id, restored: true })

      const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
      expect(updated.dismissedAt).toBeNull()
      expect((await svc.queue()).find((q) => q.id === leg.id)).toBeTruthy()

      const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
      expect(audit.some((a) => a.note === 'review: restored to queue')).toBe(true)

      // restoring a non-dismissed leg is a no-op
      expect(await svc.restore(leg.id, reviewerId)).toEqual({ shipmentId: leg.id, restored: false })
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd backend && ./node_modules/.bin/vitest run test/review.int.spec.ts)`
Expected: FAIL — `svc.dismiss is not a function`.

- [ ] **Step 3: Implement DTO** — in `backend/src/review/dto.ts`, change the import line and append:

```ts
import { ArrayNotEmpty, IsArray, IsObject, IsOptional, IsString } from 'class-validator'
```

```ts
/** Bulk "not a trackable shipment" verdict from the Review Queue (portal echo / no-move noise). */
export class DismissDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) shipmentIds!: string[]
  @IsOptional() @IsString() note?: string
}
```

- [ ] **Step 4: Implement service methods** — in `backend/src/review/review.service.ts`, append inside the class (after `correct`):

```ts
  /** Bulk "not a trackable shipment": stamp dismissed_at so the leg leaves the review queue WITHOUT
   *  vouching for its data. reviewStatus stays 'provisional' (confirmed would enter alerts/automation)
   *  and NO confirm-sentinels are posted (approving noise would poison the queue's learning feed).
   *  Sticky by design: the committer never touches dismissed_at, so a recurring portal echo does not
   *  resurface daily. Rows that are not pending provisional SHIPMENTs are skipped, not errors — the
   *  queue may have moved under a stale selection. */
  async dismiss(shipmentIds: string[], actorId: string, note?: string) {
    let dismissed = 0
    for (const id of shipmentIds) {
      const leg = await this.shipments.findById(id)
      if (!leg || leg.kind !== 'SHIPMENT' || leg.reviewStatus !== 'provisional' || leg.dismissedAt != null) continue
      await this.shipments.updateLeg(id, { dismissedAt: new Date(), reviewedBy: actorId, reviewedAt: new Date() })
      await this.audit.write({
        entityType: 'shipment', entityId: id, field: null,
        oldValue: 'provisional', newValue: 'dismissed', changeType: 'update',
        sourceType: 'manual', actorUserId: actorId,
        note: note?.trim() ? `review: dismissed — ${note.trim()}` : 'review: dismissed — not a trackable shipment',
      })
      dismissed += 1
    }
    return { dismissed }
  }

  /** Undo a dismiss: the leg returns to the pending review queue. No-op when not dismissed. */
  async restore(shipmentId: string, actorId: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    if (leg.dismissedAt == null) return { shipmentId, restored: false }
    await this.shipments.updateLeg(shipmentId, { dismissedAt: null })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: 'dismissed', newValue: 'provisional', changeType: 'update',
      sourceType: 'manual', actorUserId: actorId, note: 'review: restored to queue',
    })
    return { shipmentId, restored: true }
  }
```

- [ ] **Step 5: Implement controller routes** — in `backend/src/review/review.controller.ts`, change the DTO import to `{ ConfirmDto, CorrectDto, DismissDto }` and add (between the `@Get()` and `@Post(':id/confirm')` handlers):

```ts
  /** POST /api/review/dismiss — bulk "not a shipment" verdict from the queue. */
  @Post('dismiss') dismiss(@Body() dto: DismissDto, @CurrentUser() actor: AuthUser) {
    return this.review.dismiss(dto.shipmentIds, actor.id, dto.note)
  }

  /** POST /api/review/:id/restore — undo a dismiss; the leg returns to the pending queue. */
  @Post(':id/restore') restore(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.review.restore(id, actor.id)
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `(cd backend && ./node_modules/.bin/vitest run test/review.int.spec.ts)`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 7: Commit**

```bash
git add backend/src/review backend/test/review.int.spec.ts
git commit -m "feat(review): bulk dismiss + restore verdicts, no learning-feed pollution (#133)"
```

---

### Task 3: Shipment DTO exposes dismissedAt (detail page)

**Files:**
- Modify: `backend/src/presentation/mappers/shipment.mapper.ts:55-59,85-86,138-139`
- Test: `backend/src/presentation/mappers/shipment.mapper.spec.ts`

**Interfaces:**
- Consumes: `findById` selectAll leg row (already carries `dismissedAt`).
- Produces: `UiShipment.dismissedAt: string | null` (frontend detail page reads it in Task 7b).

- [ ] **Step 1: Write the failing test** — in `backend/src/presentation/mappers/shipment.mapper.spec.ts`, add inside the main describe (near the other toUiShipment assertions, after line ~76):

```ts
  it('passes dismissedAt through as ISO (null when absent)', () => {
    expect(toUiShipment(fullInput()).dismissedAt).toBeNull()
    expect(
      toUiShipment({ ...fullInput(), leg: leg({ dismissedAt: new Date('2026-07-14T00:00:00Z') }) }).dismissedAt,
    ).toBe('2026-07-14T00:00:00.000Z')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `(cd backend && ./node_modules/.bin/vitest run src/presentation/mappers/shipment.mapper.spec.ts)`
Expected: FAIL — `dismissedAt` is `undefined`, not `null` (property missing).

- [ ] **Step 3: Implement** — in `backend/src/presentation/mappers/shipment.mapper.ts`:

In `ShipmentLegRow` (after `reviewReasons?: string[] | null` at line 56): `  dismissedAt?: Dateish`
In `UiShipment` (after `reviewReasons: string[]` at line 86): `  dismissedAt: string | null`
In `toUiShipment` (after `reviewReasons: leg.reviewReasons ?? [],` at line 139): `    dismissedAt: isoOrNull(leg.dismissedAt ?? null),`

- [ ] **Step 4: Run test to verify it passes**

Run: `(cd backend && ./node_modules/.bin/vitest run src/presentation/mappers/shipment.mapper.spec.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/presentation/mappers/shipment.mapper.ts backend/src/presentation/mappers/shipment.mapper.spec.ts
git commit -m "feat(review): expose dismissedAt on the shipment DTO (#133)"
```

---

### Task 4: Committer multi-HBL regression test (AC1/AC2 — test only)

**Files:**
- Test: `backend/test/committer.int.spec.ts` (append inside the main describe)

**Interfaces:**
- Consumes: existing `group()` helper + `committer` from the file's beforeAll.
- Produces: nothing — pins `findExistingLeg`'s no-fusion guarantee for the issue-#133 shape.

- [ ] **Step 1: Write the test (expected to PASS — a regression pin, not a bug fix)**

```ts
  it('#133 multi-HBL email: conflicting strong ids never fuse, even with a shared PO and no booking/SO', async () => {
    // The KOHL/YAQI thread: one email, five invoices, booking_no/so_no null on (almost) every doc,
    // identity lives in per-attachment HBL+container+MBL. PO 16068229 is split across two containers.
    const legA = { hbl: 'SE26061400003', cont: 'ONEU0429500', mbl: 'ONEYDACG13378900', pos: ['16068176', '16068227'] }
    const legB = { hbl: 'SE26061400001', cont: 'TRHU5378918', mbl: 'ONEYDACG13380900', pos: ['16068229'] }
    const legC = { hbl: 'SE26061400005', cont: 'ONEU1375780', mbl: 'ONEYDACG13372300', pos: ['16068229', '16068195'], so: 'OI-22604713' }
    const asGroup = (l: { hbl: string; cont: string; mbl: string; pos: string[]; so?: string }) =>
      group({
        pos: l.pos,
        matchKeys: { hbl_awb_fcr_no: l.hbl, container_no: l.cont, mbl: l.mbl, ...(l.so ? { so_no: l.so } : {}) },
        fields: { hbl_awb_fcr_no: l.hbl, container_no: l.cont, mbl: l.mbl, ...(l.so ? { so_no: l.so } : {}) },
        emailTypes: ['Final B/L'],
        events: [{ emailType: 'Final B/L', receivedAt: '2026-07-13T10:45:52Z' }],
        conversationId: 'conv-kohl-yaqi',
      })

    const a = await committer.apply(asGroup(legA))
    const b = await committer.apply(asGroup(legB))
    const c = await committer.apply(asGroup(legC))

    expect(b.action).toBe('create_booking') // same thread must not fuse
    expect(c.action).toBe('create_booking') // PO 16068229 also on legB — conflicting HBL/container wins
    expect(new Set([a.shipmentId, b.shipmentId, c.shipmentId]).size).toBe(3)

    // the shared PO is linked to BOTH bookings (one PO split across two containers)
    const po = await db.selectFrom('purchaseOrders').where('poNumber', '=', '16068229').selectAll().executeTakeFirstOrThrow()
    const links = await db.selectFrom('bookingPos').where('poId', '=', po.id).selectAll().execute()
    expect(new Set(links.map((l) => l.bookingId))).toEqual(new Set([b.bookingId, c.bookingId]))

    // idempotency: re-applying legB amends legB — it never leaks onto legC via the shared PO
    const b2 = await committer.apply(asGroup(legB))
    expect(b2.action).toBe('amend_fields')
    expect(b2.shipmentId).toBe(b.shipmentId)
  })
```

- [ ] **Step 2: Run it — must pass**

Run: `(cd backend && ./node_modules/.bin/vitest run test/committer.int.spec.ts)`
Expected: PASS. If it FAILS, stop and investigate `findExistingLeg` / `strongKeysConflict` (that would be a real AC2 bug, not a test problem).

- [ ] **Step 3: Commit**

```bash
git add backend/test/committer.int.spec.ts
git commit -m "test(committer): pin #133 multi-HBL no-fusion guarantee (shared PO, null booking)"
```

---

### Task 5: Frontend — categorizeReason + unit tests

**Files:**
- Modify: `frontend/src/lib/review-reasons.ts` (append)
- Create: `frontend/src/lib/review-reasons.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type ReasonCategory = 'portal' | 'conflict' | 'multi_id' | 'no_identity' | 'master_miss' | 'extraction' | 'other'`
  - `CATEGORY_LABEL: Record<ReasonCategory, string>`, `CATEGORY_ORDER: ReasonCategory[]`
  - `categorizeReason(raw: string): ReasonCategory`
  - `categoriesOf(reasons: string[]): Set<ReasonCategory>` (empty reasons → `{'other'}`)

- [ ] **Step 1: Write the failing tests** — create `frontend/src/lib/review-reasons.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { categorizeReason, categoriesOf } from './review-reasons'

// Real reason strings as produced by the committer hints, review policy labels, disposition
// reasons, and the queue matcher gate. Categories drive the Review Queue filter chips (#133).
const CASES: Array<[string, string]> = [
  ['platform/portal email without carrier identity — verify booking_no is not a portal LPO', 'portal'],
  ['the email is only a portal alert (not a real booking update)', 'portal'],
  ['backend conflict on qty, gross_weight', 'conflict'],
  ['2 unresolved field conflict(s)', 'conflict'],
  ['the email disagrees with what’s already on the shipment', 'conflict'],
  ['mode change SEA → AIR', 'conflict'],
  ['transport switched between sea and air', 'conflict'],
  ['PO 2605358: brand conflict KOHLS vs SONOMA (kept KOHLS)', 'conflict'],
  ['PO-linked group with an identity supersede (possible over-merge of two shipments)', 'multi_id'],
  ['≥2 distinct co-current values of one strong-id type', 'multi_id'],
  ['matched multiple backend legs', 'multi_id'],
  ['a PO on this email currently belongs to a different shipment', 'multi_id'],
  ['the same reference number already belongs to another shipment', 'multi_id'],
  ['the shipment was moved or reassigned', 'multi_id'],
  ['no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment', 'no_identity'],
  ['neither a strong identity key nor a PO', 'no_identity'],
  ['there’s no booking, bill of lading, AWB, or container number', 'no_identity'],
  ['there’s no purchase order', 'no_identity'],
  ['insufficient identity for auto-apply', 'no_identity'],
  ['forwarder_name "VENA SAIL" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)', 'master_miss'],
  ['pol "CHITTAGONG" did not exact/curated-match a port master — left unlinked', 'master_miss'],
  ['the customer is new or not recognized', 'master_miss'],
  ['new shipment for an unknown / unresolved customer', 'master_miss'],
  ['PO present but customer not known', 'master_miss'],
  ['vision_pending: 2 image attachments not read yet', 'extraction'],
  ['output_truncated — model JSON cut mid-generation', 'extraction'],
  ['body says a file was attached but no attachment was ingested', 'extraction'],
  ['missing cargo detail (qty/gross weight/measurement all empty)', 'extraction'],
  ['ack-only reply with an unlabeled inline screenshot', 'extraction'],
  ['PO 2605358: total_quantity 692 looks like a broadcast total', 'extraction'],
  ['cutoff note: SI cut-off 2026-07-01 (shipping instruction only)', 'other'],
  ['Booking cancelled', 'other'],
]

describe('categorizeReason (#133 filter chips)', () => {
  it.each(CASES)('%s → %s', (raw, expected) => {
    expect(categorizeReason(raw)).toBe(expected)
  })

  it('categoriesOf unions categories and defaults empty → other', () => {
    expect([...categoriesOf([])]).toEqual(['other'])
    const cats = categoriesOf([
      'the email is only a portal alert (not a real booking update)',
      'backend conflict on qty',
    ])
    expect(cats.has('portal')).toBe(true)
    expect(cats.has('conflict')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd frontend && ./node_modules/.bin/vitest run src/lib/review-reasons.test.ts)`
Expected: FAIL — `categorizeReason` is not exported.

- [ ] **Step 3: Implement** — append to `frontend/src/lib/review-reasons.ts`:

```ts
// ---- Reason categories (#133) — drive the Review Queue filter chips + bulk triage. ----

export type ReasonCategory =
  | 'portal'
  | 'conflict'
  | 'multi_id'
  | 'no_identity'
  | 'master_miss'
  | 'extraction'
  | 'other'

export const CATEGORY_LABEL: Record<ReasonCategory, string> = {
  portal: 'Portal echo',
  conflict: 'Field conflict',
  multi_id: 'Multiple identities',
  no_identity: 'No identity',
  master_miss: 'Master-data miss',
  extraction: 'Extraction issue',
  other: 'Other',
}

export const CATEGORY_ORDER: ReasonCategory[] = [
  'portal', 'conflict', 'multi_id', 'no_identity', 'master_miss', 'extraction', 'other',
]

/** First match wins — portal before no_identity (the portal hint also mentions missing carrier id),
 *  conflict before multi_id (a "backend conflict on booking_no" is a field conflict, not a merge risk). */
const CATEGORY_RULES: Array<{ match: RegExp; category: ReasonCategory }> = [
  { match: /platform\/portal email without carrier identity/i, category: 'portal' },
  { match: /only a portal alert/i, category: 'portal' },
  { match: /backend conflict on /i, category: 'conflict' },
  { match: /unresolved field conflict/i, category: 'conflict' },
  { match: /disagrees with what.s already on the shipment/i, category: 'conflict' },
  { match: /mode change \S+ → \S+/i, category: 'conflict' },
  { match: /transport switched between sea and air/i, category: 'conflict' },
  { match: /brand conflict/i, category: 'conflict' },
  { match: /identity supersede/i, category: 'multi_id' },
  { match: /distinct co-current values/i, category: 'multi_id' },
  { match: /matched multiple backend legs/i, category: 'multi_id' },
  { match: /belongs to a different shipment|already belongs to another shipment/i, category: 'multi_id' },
  { match: /moved or reassigned/i, category: 'multi_id' },
  { match: /no booking\/SO\/HBL identity/i, category: 'no_identity' },
  { match: /neither a strong identity key nor a PO/i, category: 'no_identity' },
  { match: /no booking, bill of lading, AWB, or container number/i, category: 'no_identity' },
  { match: /there.s no purchase order/i, category: 'no_identity' },
  { match: /insufficient identity/i, category: 'no_identity' },
  { match: /did not exact(?:\/curated)?-match/i, category: 'master_miss' },
  { match: /customer is new or not recognized/i, category: 'master_miss' },
  { match: /unknown \/ unresolved customer/i, category: 'master_miss' },
  { match: /customer not known/i, category: 'master_miss' },
  { match: /vision_pending|output_truncated|input_truncated|content_filter/i, category: 'extraction' },
  { match: /attachment|missing cargo detail|screenshot|broadcast total/i, category: 'extraction' },
]

/** Bucket one raw review reason for the queue's filter chips. Unknown strings → 'other'. */
export function categorizeReason(raw: string): ReasonCategory {
  for (const r of CATEGORY_RULES) if (r.match.test(raw)) return r.category
  return 'other'
}

/** A shipment's category set = union over its reasons; a reason-less row files under 'other'. */
export function categoriesOf(reasons: string[]): Set<ReasonCategory> {
  const s = new Set<ReasonCategory>()
  for (const r of reasons) s.add(categorizeReason(r))
  return s.size ? s : new Set<ReasonCategory>(['other'])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `(cd frontend && ./node_modules/.bin/vitest run src/lib/review-reasons.test.ts)`
Expected: PASS (34 assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/review-reasons.ts frontend/src/lib/review-reasons.test.ts
git commit -m "feat(review-ui): categorize review reasons for filter chips (#133)"
```

---

### Task 6: Frontend hooks — view param + dismiss/restore mutations

**Files:**
- Modify: `frontend/src/hooks/use-review-queue.ts`

**Interfaces:**
- Consumes: Task 1's `?view=` API + Task 2's endpoints.
- Produces (used by Task 7):
  - `type ReviewQueueView = 'pending' | 'dismissed'`
  - `useReviewQueue(view?: ReviewQueueView)`
  - `ReviewShipment.dismissedAt: string | null`; `ReviewCounts { provisional: number; dismissed: number }`
  - `useDismissShipments()` — mutate `{ shipmentIds: string[]; note?: string }`
  - `useRestoreShipment()` — mutate `{ shipmentId: string }`

- [ ] **Step 1: Implement (UI hooks — exercised by typecheck + Task 7's page; no isolated unit test)**

In `frontend/src/hooks/use-review-queue.ts`:
- Add to `ReviewShipment`: `  dismissedAt: string | null`
- Replace `ReviewCounts`: `export interface ReviewCounts { provisional: number; dismissed: number }`
- Replace `useReviewQueue` and add the view type:

```ts
export type ReviewQueueView = 'pending' | 'dismissed'

export function useReviewQueue(view: ReviewQueueView = 'pending') {
  return useQuery<ReviewQueueResponse>({
    queryKey: ['review-queue', view],
    queryFn: () => api.get(`/shipments/review-queue?view=${view}`),
  })
}
```

- Append after `useCorrectShipment`:

```ts
/**
 * Bulk "not a trackable shipment" (#133): stamps dismissed_at so the rows leave the queue WITHOUT
 * confirming their data (no learning-feed confirm signals). Reversible via useRestoreShipment.
 */
export function useDismissShipments() {
  const invalidate = useInvalidateReview()
  return useMutation({
    mutationFn: ({ shipmentIds, note }: { shipmentIds: string[]; note?: string }) =>
      api.post('/review/dismiss', { shipmentIds, ...(note?.trim() ? { note: note.trim() } : {}) }),
    onSuccess: invalidate,
  })
}

/** Undo a dismiss — the shipment returns to the pending review queue. */
export function useRestoreShipment() {
  const invalidate = useInvalidateReview()
  return useMutation({
    mutationFn: ({ shipmentId }: { shipmentId: string }) => api.post(`/review/${shipmentId}/restore`, {}),
    onSuccess: invalidate,
  })
}
```

(`useInvalidateReview` already invalidates the `['review-queue']` prefix, which covers both view keys.)

- [ ] **Step 2: Typecheck**

Run: `(cd frontend && ./node_modules/.bin/tsc --noEmit)`
Expected: PASS (0 errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-review-queue.ts
git commit -m "feat(review-ui): queue view param + dismiss/restore mutations (#133)"
```

---

### Task 7: ReviewQueuePage — tabs, chips, selection, bulk dismiss, restore

**Files:**
- Modify: `frontend/src/pages/ReviewQueuePage.tsx` (full rewrite below)

**Interfaces:**
- Consumes: Task 5 (`categoriesOf`, `CATEGORY_LABEL`, `CATEGORY_ORDER`, `ReasonCategory`), Task 6 hooks.
- Produces: the ops-facing triage flow (chip filter → select → bulk dismiss; Dismissed tab → restore).

- [ ] **Step 1: Replace the page** — full new content of `frontend/src/pages/ReviewQueuePage.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Ship, Package, Loader2, XCircle, RotateCcw } from 'lucide-react'
import {
  useReviewQueue,
  useReviewCounts,
  useConfirmShipment,
  useDismissShipments,
  useRestoreShipment,
  type ReviewShipment,
  type ReviewQueueView,
} from '../hooks/use-review-queue'
import { Badge } from '../components/ui/Badge'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { cn, formatRelativeTime } from '../lib/utils'
import {
  humanizeReasons,
  categoriesOf,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type ReasonCategory,
} from '../lib/review-reasons'

export default function ReviewQueuePage() {
  const [view, setView] = useState<ReviewQueueView>('pending')
  const { data, isLoading, isError } = useReviewQueue(view)
  const { data: counts } = useReviewCounts()
  const confirmMutation = useConfirmShipment()
  const dismissMutation = useDismissShipments()
  const restoreMutation = useRestoreShipment()
  const navigate = useNavigate()

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [category, setCategory] = useState<ReasonCategory | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState('')

  const shipments = data?.shipments ?? []

  // Chip counts over the CURRENT view (a shipment counts once per category it carries).
  const categoryCounts = useMemo(() => {
    const m = new Map<ReasonCategory, number>()
    for (const s of shipments) for (const c of categoriesOf(s.reviewReasons)) m.set(c, (m.get(c) ?? 0) + 1)
    return m
  }, [shipments])

  const filtered = useMemo(
    () => (category === 'all' ? shipments : shipments.filter((s) => categoriesOf(s.reviewReasons).has(category))),
    [shipments, category],
  )
  const { totalItems, totalPages, pageSize, getPage } = usePagination(filtered, perPage)
  const pageShipments = getPage(page)

  const resetSelection = () => setSelected(new Set())
  const switchView = (v: ReviewQueueView) => {
    setView(v)
    setCategory('all')
    setPage(1)
    resetSelection()
  }
  const pickCategory = (c: ReasonCategory | 'all') => {
    setCategory(c)
    setPage(1)
    resetSelection()
  }
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))
  const toggleAll = () => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((s) => s.id)))

  const handleApprove = (id: string) => {
    setBusyId(id)
    confirmMutation.mutate({ shipmentId: id }, { onSettled: () => setBusyId(null) })
  }
  const handleDismissOne = (id: string) => {
    setBusyId(id)
    dismissMutation.mutate(
      { shipmentIds: [id] },
      {
        onSuccess: () => setSelected((prev) => { const next = new Set(prev); next.delete(id); return next }),
        onSettled: () => setBusyId(null),
      },
    )
  }
  const handleRestore = (id: string) => {
    setBusyId(id)
    restoreMutation.mutate({ shipmentId: id }, { onSettled: () => setBusyId(null) })
  }
  const handleDismissSelected = () => {
    if (selected.size === 0) return
    dismissMutation.mutate(
      { shipmentIds: [...selected], note: bulkNote },
      {
        onSuccess: () => {
          resetSelection()
          setBulkNote('')
        },
      },
    )
  }

  const anyMutating = confirmMutation.isPending || dismissMutation.isPending || restoreMutation.isPending
  const isPendingView = view === 'pending'
  const colSpan = isPendingView ? 7 : 6

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary">Review Queue</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {isPendingView
              ? 'Provisional shipments awaiting confirmation — resolve the flagged reasons, then approve. Dismiss what is not a real shipment (portal echoes, no-move notices).'
              : 'Dismissed items — ruled "not a trackable shipment". Restore anything dismissed by mistake.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View tabs */}
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(
              [
                { key: 'pending', label: `Pending${counts ? ` (${counts.provisional})` : ''}` },
                { key: 'dismissed', label: `Dismissed${counts ? ` (${counts.dismissed})` : ''}` },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => switchView(t.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  view === t.key
                    ? 'bg-cobalt-primary text-white'
                    : 'bg-surface-800 text-text-secondary hover:bg-surface-700 hover:text-text-primary',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <PageSizeSelect value={perPage} onChange={(size) => { setPerPage(size); setPage(1) }} />
        </div>
      </div>

      {/* Reason-category filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => pickCategory('all')}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            category === 'all'
              ? 'border-cobalt-primary bg-cobalt-primary/15 text-cobalt-primary-light'
              : 'border-border bg-surface-800 text-text-secondary hover:text-text-primary',
          )}
        >
          All ({shipments.length})
        </button>
        {CATEGORY_ORDER.filter((c) => (categoryCounts.get(c) ?? 0) > 0).map((c) => (
          <button
            key={c}
            onClick={() => pickCategory(c)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              category === c
                ? 'border-cobalt-primary bg-cobalt-primary/15 text-cobalt-primary-light'
                : 'border-border bg-surface-800 text-text-secondary hover:text-text-primary',
            )}
          >
            {CATEGORY_LABEL[c]} ({categoryCounts.get(c)})
          </button>
        ))}
      </div>

      {/* Bulk-dismiss bar (pending view, ≥1 selected) */}
      {isPendingView && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-800 p-3">
          <span className="text-xs font-medium text-text-primary">{selected.size} selected</span>
          <input
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            placeholder="Optional note (e.g. portal echo — no carrier move)"
            className="h-8 min-w-56 flex-1 rounded-lg border border-border bg-surface-900 px-3 text-xs text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={handleDismissSelected}
            disabled={anyMutating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-3 py-1.5 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dismissMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
            Dismiss {selected.size} — not shipments
          </button>
          <button
            onClick={resetSelection}
            className="rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading review queue...</span>
        </div>
      ) : isError ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-status-critical">Failed to load the review queue.</span>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface-900/50">
                    {isPendingView && (
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAll}
                          title="Select all filtered"
                          className="h-3.5 w-3.5 accent-cobalt-primary"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Booking</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Route</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Why review?</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageShipments.map((s: ReviewShipment) => {
                    const rowBusy = busyId === s.id
                    return (
                      <tr
                        key={s.id}
                        onClick={() => navigate(`/review-queue/${s.id}`)}
                        className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                      >
                        {isPendingView && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(s.id)}
                              onChange={() => toggleRow(s.id)}
                              className="h-3.5 w-3.5 accent-cobalt-primary"
                            />
                          </td>
                        )}

                        <td className="px-4 py-3 text-sm text-text-secondary">
                          {s.customer ?? '—'}
                          {s.forwarder && (
                            <span className="mt-0.5 block text-[11px] text-text-muted">{s.forwarder}</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-medium text-cobalt-primary-light">
                            <Ship size={13} className="shrink-0 text-text-muted" />
                            {s.bookingNo ?? s.soNo ?? '—'}
                          </span>
                          {s.poCount > 0 && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-text-muted">
                              <Package size={10} />
                              {s.poCount} PO{s.poCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>

                        <td className="px-4 py-3">
                          <Badge variant="status" value={s.status} />
                        </td>

                        <td className="px-4 py-3">
                          {s.reviewReasons.length > 0 ? (
                            <ul className="list-disc space-y-0.5 pl-3.5 text-[11px] leading-snug text-text-secondary">
                              {humanizeReasons(s.reviewReasons).map(({ raw, text }) => (
                                <li key={raw} title={raw}>
                                  {text}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                          <span className="mt-1 block text-[10px] text-text-muted">
                            {formatRelativeTime(s.createdAt)}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {isPendingView ? (
                              <>
                                <button
                                  onClick={() => handleApprove(s.id)}
                                  disabled={anyMutating}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/15 px-2.5 py-1.5 text-xs font-medium text-status-success transition-colors hover:bg-status-success/25 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {rowBusy && confirmMutation.isPending ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <CheckCircle size={13} />
                                  )}
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleDismissOne(s.id)}
                                  disabled={anyMutating}
                                  title="Not a trackable shipment — remove from the queue (reversible)"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-2.5 py-1.5 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {rowBusy && dismissMutation.isPending ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <XCircle size={13} />
                                  )}
                                  Dismiss
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleRestore(s.id)}
                                disabled={anyMutating}
                                title="Return this item to the pending review queue"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {rowBusy && restoreMutation.isPending ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={13} />
                                )}
                                Restore
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageShipments.length === 0 && (
                    <tr>
                      <td colSpan={colSpan} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <CheckCircle size={28} className="opacity-40" />
                          <span className="text-sm">
                            {isPendingView
                              ? category === 'all'
                                ? 'No shipments awaiting review.'
                                : `No pending items in “${CATEGORY_LABEL[category as ReasonCategory]}”.`
                              : 'Nothing has been dismissed.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + frontend suite**

Run: `(cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run)`
Expected: PASS (62 pre-existing + new review-reasons tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ReviewQueuePage.tsx
git commit -m "feat(review-ui): reason filter chips, Dismissed tab, bulk + per-row dismiss/restore (#133)"
```

---

### Task 8: ReviewShipmentPage — dismiss action + dismissed banner

**Files:**
- Modify: `frontend/src/hooks/use-shipments.ts:35` (type)
- Modify: `frontend/src/pages/ReviewShipmentPage.tsx`

**Interfaces:**
- Consumes: Task 3's `UiShipment.dismissedAt`, Task 6's mutations.
- Produces: detail-page Dismiss/Restore parity with the list.

- [ ] **Step 1: Add the DTO field** — in `frontend/src/hooks/use-shipments.ts`, next to `reviewStatus?: string | null` (line 35) add:

```ts
  dismissedAt?: string | null
```

- [ ] **Step 2: Wire the page** — in `frontend/src/pages/ReviewShipmentPage.tsx`:

Change the hooks import (line 5):

```ts
import { useConfirmShipment, useCorrectShipment, useDismissShipments, useRestoreShipment } from '../hooks/use-review-queue'
```

Add `XCircle, RotateCcw` to the lucide-react import list.

After `const correctMutation = useCorrectShipment()` (line 161) add:

```ts
  const dismissMutation = useDismissShipments()
  const restoreMutation = useRestoreShipment()
```

Change the `busy` line (217) to:

```ts
  const busy = confirmMutation.isPending || correctMutation.isPending || dismissMutation.isPending || restoreMutation.isPending
```

After `handleCorrectAndApprove` (line 231) add:

```ts
  const isDismissed = !!shipment.dismissedAt
  const handleDismiss = () => {
    if (!id) return
    dismissMutation.mutate({ shipmentIds: [id], note }, { onSuccess: done })
  }
  const handleRestore = () => {
    if (!id) return
    restoreMutation.mutate({ shipmentId: id })
  }
```

Replace the actions bar (the `{/* Actions */}` block, lines 457-483) with:

```tsx
      {/* Actions */}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface-800/95 p-3 shadow-lg backdrop-blur">
        {isDismissed ? (
          <>
            <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-status-critical">
              <XCircle size={13} />
              Dismissed from review — not a trackable shipment. Restore it to approve or correct.
            </span>
            <button
              onClick={handleRestore}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {restoreMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Restore to queue
            </button>
          </>
        ) : (
          <>
            {dirtyCount > 0 && (
              <span className="mr-auto text-xs text-text-muted">
                {dirtyCount} field{dirtyCount !== 1 ? 's' : ''} edited — corrections lock the field so
                the agent can never overwrite it
              </span>
            )}
            <button
              onClick={handleDismiss}
              disabled={busy}
              title="Not a trackable shipment (portal echo / no carrier move) — removes it from the queue; reversible. Your note is saved to the audit trail."
              className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-3 py-2 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dismissMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              Dismiss — not a shipment
            </button>
            <button
              onClick={handleApprove}
              disabled={busy || dirtyCount > 0}
              title={dirtyCount > 0 ? 'You have unsaved corrections — use "Save corrections & Approve"' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/15 px-3 py-2 text-xs font-medium text-status-success transition-colors hover:bg-status-success/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              Approve as-is
            </button>
            <button
              onClick={handleCorrectAndApprove}
              disabled={busy || dirtyCount === 0 || correctBlocked}
              title={correctBlocked ? 'Add a note for the agent before saving corrections' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {correctMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save corrections & Approve
            </button>
          </>
        )}
      </div>
```

- [ ] **Step 3: Typecheck + full frontend suite**

Run: `(cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run)`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/use-shipments.ts frontend/src/pages/ReviewShipmentPage.tsx
git commit -m "feat(review-ui): dismiss/restore on the review detail page (#133)"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite** — `(cd backend && ./node_modules/.bin/vitest run)` — Expected: ≥486 passing, 0 failing.
- [ ] **Step 2: Backend build** — `(cd backend && ./node_modules/.bin/nest build)` — Expected: exit 0.
- [ ] **Step 3: Full frontend suite + build** — `(cd frontend && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc && ./node_modules/.bin/vite build)` — Expected: exit 0.
- [ ] **Step 4 (if the local stack is up): smoke the endpoints** — optional; the int tests already cover the service layer. Do not block on this.

### Task 10: Ship

- [ ] **Step 1: Push** — `git push -u origin fix/133-review-queue-dismiss-filter`
- [ ] **Step 2: PR** — `gh pr create` titled `fix(review): reason filter + bulk dismiss for review-queue noise (#133)`; body maps the four issue ACs to what shipped (AC3 fully; AC1/AC2 pinned by regression test track-side, record-splitting stays in cobalt-queue; AC4 untouched), lists out-of-scope follow-ups (portal→DOCUMENT, split-by-HBL UX, bulk restore), uses `Refs #133` (NOT `Fixes` — queue-side work remains), ends with the Claude Code attribution line.
