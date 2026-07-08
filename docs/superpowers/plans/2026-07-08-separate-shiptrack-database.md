# Separate ShipTrack Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ShipTrack off the shared `cobalt` Postgres onto its own database that owns only `tracking`/`audit`/`alerts` plus a new light `ingest` mirror, with email body/attachments fetched from Microsoft Graph on demand.

**Architecture:** Add an `ingest` schema (`email_message`, `email_attachment`, `parsed_record`, `ingest_state`) **alongside** the existing `queue`/`evidence` schemas, migrate every consumer to read `ingest` (all 7 cross-schema joins become intra-DB), then **delete** `queue`/`evidence`. Heavy content (body, attachment originals) is re-fetched from Graph for real mail; the `body_*`/`raw_bytes` columns are dev-seed-only. `parsed_record` rows arrive via an additive `evidence[]` field on `POST /api/decisions`.

**Tech Stack:** NestJS 11, Drizzle ORM 0.45 (`drizzle-kit` 0.31), Postgres 16, Vitest 2, `pg` Pool, Microsoft Graph (client-credentials, already wired in `emails/graph.service.ts`).

## Global Constraints

- **Never `pnpm -C <pkg>`** (creates a divergent nested `drizzle-orm` → ~178 phantom tsc errors). Run backend tooling via `backend/node_modules/.bin/*` or `pnpm --filter backend <script>`. The **root** `.bin` has only `concurrently`.
- **Commands** (git-bash, from repo root): backend tests `(cd backend && node_modules/.bin/vitest run <path>)`; typecheck `(cd backend && node_modules/.bin/tsc --noEmit)`; build `(cd backend && node_modules/.bin/nest build)`; generate migration `(cd backend && node_modules/.bin/drizzle-kit generate)`.
- **`DATABASE_URL`** for CLI tools = the value in `backend/.env` (dev DB `cobalt`, e.g. `postgres://postgres:postgres@localhost:5432/cobalt`). `TEST_DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/cobalt_test`; `TEST_ADMIN_URL` to `.../postgres`.
- **Test-DB migration quirk:** `backend/test/setup-db.ts` `getTestDb()` only replays `drizzle/*.sql` when the `tracking` schema is **absent**. After ANY migration change, force a clean re-migrate first:
  `psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'drop database if exists cobalt_test with (force)'`
- **`ingest` export names are prefixed** (`ingestEmailMessage`, `ingestEmailAttachment`, `ingestParsedRecord`, `ingestSyncState`) so they never clash with the still-present `queue`/`evidence` exports during the additive phase.
- **Dev DB is disposable / dev-only** — no data migration; recreate + reseed freely. Dropping `queue`/`evidence` (Task 9) removes them from ShipTrack's DB; cobalt-queue must move to its own DB (separate repo, out of scope) before it can run again against a fresh ShipTrack DB.
- **DRY / YAGNI / TDD / frequent commits.** One task = one green, committable deliverable.

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `backend/src/db/schema/ingest.ts` | **new** — the `ingest` mirror tables | 1 |
| `backend/src/db/schema/index.ts` | export `ingest`; later drop `queue`/`evidence` | 1, 9 |
| `backend/drizzle.config.ts` | `schemaFilter` add `ingest`; later drop `queue`/`evidence` | 1, 9 |
| `backend/drizzle/00NN_*.sql` | **new** migrations: add ingest; drop queue/evidence | 1, 9 |
| `backend/src/db/seed.ts` | write `ingest.*` (additive; queue/evidence writes removed in 9) | 2, 9 |
| `backend/src/db/repositories/evidence.repository.ts` | read `ingest.parsed_record`/`ingest.email_message` | 3 |
| `backend/src/db/repositories/email.repository.ts` | read `ingest.*`; drop `queue_normalized` join | 4 |
| `backend/src/db/repositories/masters.repository.ts` | raw SQL `FROM ingest.parsed_record` | 5 |
| `backend/src/db/repositories/shipment.repository.ts` | raw SQL → `ingest.*` | 5 |
| `backend/src/db/reclassify-platform-documents.ts` | raw `pg` → `ingest.email_message` | 6 |
| `backend/src/emails/graph.service.ts` | **new** `fetchAttachments()` | 7 |
| `backend/src/emails/emails.service.ts` | attachment local→Graph fallback | 7 |
| `backend/src/decisions/dto.ts` | **new** optional `evidence[]` | 8 |
| `backend/src/decisions/decisions.service.ts` | persist `evidence[]` into `ingest` | 8 |
| `backend/src/db/repositories/ingest.repository.ts` | **new** — upsert `ingest.*` from a decision | 8 |
| `backend/test/setup-db.ts` | truncate `ingest.*`; drop `queue`/`evidence` | 3, 9 |
| `backend/test/{committer,reconcile}.int.spec.ts` | seed `ingest.*` | 3 |

---

### Task 1: Add the `ingest` schema (additive — nothing reads it yet)

**Files:**
- Create: `backend/src/db/schema/ingest.ts`
- Modify: `backend/src/db/schema/index.ts`, `backend/drizzle.config.ts`
- Create (generated): `backend/drizzle/0015_add_ingest_mirror.sql`
- Test: `backend/test/ingest-schema.int.spec.ts`

**Interfaces:**
- Produces: `ingestEmailMessage`, `ingestEmailAttachment`, `ingestParsedRecord`, `ingestSyncState` (drizzle tables in the `ingest` pg-schema).

- [ ] **Step 1: Write `ingest.ts`**

```ts
// backend/src/db/schema/ingest.ts
import { pgSchema, uuid, text, integer, timestamp, jsonb, customType } from 'drizzle-orm/pg-core'

/** Postgres `bytea` ↔ Node Buffer (dev-seed bytes only). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return 'bytea' } })

/**
 * INGEST — ShipTrack's OWN light mirror of the email + parsed-record data it used to read from the
 * cobalt-queue `queue`/`evidence` schemas over the (now-removed) shared DB. Fed by `POST /api/decisions`
 * `evidence[]` and, in dev, by the seed. Heavy content (email body, attachment originals) is NOT stored
 * for real mail — it is re-fetched from Microsoft Graph on demand; `body_*` / `raw_bytes` are populated
 * ONLY by the dev seed (the `mock:` corpus has no mailbox copy).
 */
export const ingest = pgSchema('ingest')

export const ingestEmailMessage = ingest.table('email_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  graphMessageId: text('graph_message_id').notNull().unique(), // Graph immutable id
  graphId: text('graph_id'),
  sourceFile: text('source_file'),
  conversationId: text('conversation_id'),
  subject: text('subject'),
  sender: text('sender'),
  toRecipients: text('to_recipients'),
  ccRecipients: text('cc_recipients'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  status: text('status'),
  attachmentCount: integer('attachment_count').notNull().default(0),
  bodyText: text('body_text'), // dev-seed only → else Graph
  bodyHtml: text('body_html'), // dev-seed only → else Graph
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ingestEmailAttachment = ingest.table('email_attachment', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().references(() => ingestEmailMessage.id, { onDelete: 'cascade' }),
  graphAttachmentId: text('graph_attachment_id'), // for the on-demand Graph fetch
  filename: text('filename').notNull(),
  declaredMime: text('declared_mime'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  sourceKind: text('source_kind'),
  rawBytes: bytea('raw_bytes'), // dev-seed only → else Graph
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ingestParsedRecord = ingest.table('parsed_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => ingestEmailMessage.id, { onDelete: 'cascade' }),
  graphMessageId: text('graph_message_id'),
  recordIdx: integer('record_idx').notNull().default(0),
  poNo: text('po_no'),
  emailType: text('email_type'),
  senderType: text('sender_type'),
  mode: text('mode'),
  fields: jsonb('fields').$type<Record<string, unknown>>(),
  matchKeys: jsonb('match_keys').$type<Record<string, unknown>>(),
  confidence: text('confidence'),
  parserAdapter: text('parser_adapter'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Graph sync watermark for the Settings "last sync" tile (was `queue.ingest_state`). */
export const ingestSyncState = ingest.table('ingest_state', {
  id: text('id').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: Export it + widen the schema filter**

In `backend/src/db/schema/index.ts` add after the `alerts` line:
```ts
export * from './ingest' // owned by track-system — light mirror of queue/evidence (replacing them)
```
In `backend/drizzle.config.ts` change `schemaFilter` to include `ingest`:
```ts
schemaFilter: ['public', 'queue', 'evidence', 'tracking', 'audit', 'alerts', 'ingest'],
```

- [ ] **Step 3: Generate the migration**

Run: `(cd backend && node_modules/.bin/drizzle-kit generate)`
Expected: a new `backend/drizzle/0015_*.sql` containing `CREATE SCHEMA "ingest";` + `CREATE TABLE "ingest"."email_message" …` (3 tables + `ingest_state`), and **no** changes to queue/evidence tables. Rename the file to `0015_add_ingest_mirror.sql` if drizzle used a random suffix (keep the `0015_` prefix and update `drizzle/meta/_journal.json`'s tag to match).

- [ ] **Step 4: Write the failing test**

```ts
// backend/test/ingest-schema.int.spec.ts
import { afterAll, beforeAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, closeTestDb, type TestDB } from './setup-db'
import * as schema from '../src/db/contracts'

let db: TestDB
beforeAll(async () => { db = (await getTestDb()).db })
afterAll(async () => { await closeTestDb() })

it('ingest.parsed_record round-trips via the drizzle mapping', async () => {
  const [msg] = await db.insert(schema.ingestEmailMessage)
    .values({ graphMessageId: 'gmsg-ingest-1', subject: 'hi', sender: 'a@b.c' }).returning()
  await db.insert(schema.ingestParsedRecord)
    .values({ messageId: msg!.id, graphMessageId: 'gmsg-ingest-1', poNo: 'PO1', fields: { customer_code: 'X' } })
  const rows = await db.execute(sql`select count(*)::int n from ingest.parsed_record where po_no = 'PO1'`)
  expect((rows as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(1)
})
```

- [ ] **Step 5: Force a clean test DB, run the test — expect FAIL then PASS**

Run: `psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'drop database if exists cobalt_test with (force)'`
Run: `(cd backend && node_modules/.bin/vitest run test/ingest-schema.int.spec.ts)`
Expected: PASS (fresh `cobalt_test` replays 0000→0015, so `ingest.*` exists). If you skipped Step 3 it FAILS with `relation "ingest.parsed_record" does not exist`.

- [ ] **Step 6: Typecheck + build + commit**

Run: `(cd backend && node_modules/.bin/tsc --noEmit && node_modules/.bin/nest build)` → clean.
```bash
git add -A backend/src/db/schema/ingest.ts backend/src/db/schema/index.ts backend/drizzle.config.ts backend/drizzle/ backend/test/ingest-schema.int.spec.ts
git commit -m "feat(ingest): add ingest mirror schema (email_message/attachment/parsed_record) alongside queue/evidence"
```

---

### Task 2: Seed populates `ingest` (additive — keep queue/evidence writes)

**Files:**
- Modify: `backend/src/db/seed.ts` (the block writing `queue.queue_message`/`queue_attachment`/`queue_normalized` + `evidence.parsed_record`)

**Interfaces:**
- Consumes: Task 1 tables.
- Produces: seeded `ingest.email_message` (with `bodyText`/`bodyHtml`), `ingest.email_attachment` (with `rawBytes`), `ingest.parsed_record` for the `mock:` corpus.

- [ ] **Step 1: Mirror each seeded mock email into `ingest`**

Find the seed block (around `seed.ts:337-368`) that deletes+inserts `schema.queueMessage`/`queueAttachment`/`queueNormalized` and the `evidence` `parsedRecord`. **Leave those inserts in place** and, immediately after each `queueMessage` insert, add the parallel `ingest` rows using the SAME ids/values:
```ts
// --- ingest mirror (additive; queue/evidence writes above stay until Task 9) ---
const [ingMsg] = await db.insert(schema.ingestEmailMessage).values({
  graphMessageId: qm.graphMessageId,       // reuse the mock graph_message_id
  graphId: qm.graphId ?? null,
  sourceFile: qm.sourceFile ?? null,
  conversationId: qm.conversationId ?? null,
  subject: qm.subject ?? null,
  sender: qm.sender ?? null,
  receivedAt: qm.receivedAt ?? null,
  status: qm.status ?? 'DONE',
  attachmentCount: qm.attachmentCount ?? 0,
  bodyText: qm.bodyText ?? null,           // dev demo body
  bodyHtml: qm.bodyHtml ?? null,
}).returning()
// attachments (dev demo bytes)
for (const a of attachmentsForThisEmail) {
  await db.insert(schema.ingestEmailAttachment).values({
    messageId: ingMsg!.id,
    filename: a.filename, declaredMime: a.declaredMime ?? null,
    sizeBytes: a.sizeBytes ?? 0, sourceKind: a.sourceKind ?? null,
    rawBytes: a.rawBytes ?? null,
  })
}
// parsed record(s)
await db.insert(schema.ingestParsedRecord).values({
  messageId: ingMsg!.id, graphMessageId: qm.graphMessageId,
  poNo: pr.poNo ?? null, emailType: pr.emailType ?? null, senderType: pr.senderType ?? null,
  mode: pr.mode ?? null, fields: pr.fields ?? {}, matchKeys: pr.matchKeys ?? {},
})
```
(Adapt the variable names — `qm`, `pr`, `attachmentsForThisEmail` — to the actual locals in `seed.ts`. If the seed builds the rows inline in the insert call, hoist them to locals first so both the queue and ingest inserts share them. Also seed one `schema.ingestSyncState` row: `{ id: 'inbox:mock', watermark: new Date(), lastSyncAt: new Date() }`.)

- [ ] **Step 2: Run the seed against a scratch DB**

Run: `psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'drop database if exists cobalt_seedcheck with (force)' -c 'create database cobalt_seedcheck'`
Run: `(cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5432/cobalt_seedcheck" node_modules/.bin/drizzle-kit migrate && DATABASE_URL="postgres://postgres:postgres@localhost:5432/cobalt_seedcheck" node_modules/.bin/ts-node -P tsconfig.json src/db/seed.ts)`
Expected: seed completes without error.

- [ ] **Step 3: Assert ingest is populated**

Run: `psql "postgres://postgres:postgres@localhost:5432/cobalt_seedcheck" -c "select (select count(*) from ingest.email_message) msgs, (select count(*) from ingest.parsed_record) prs, (select count(*) from ingest.email_attachment where raw_bytes is not null) att_bytes"`
Expected: `msgs > 0`, `prs > 0`, `att_bytes > 0`.

- [ ] **Step 4: Typecheck + commit**

Run: `(cd backend && node_modules/.bin/tsc --noEmit)` → clean.
```bash
git add backend/src/db/seed.ts
git commit -m "feat(seed): mirror the mock email corpus into ingest.* (body + attachment bytes + parsed_record)"
```

---

### Task 3: Point `EvidenceRepository` at `ingest` + swap int-test seeds

**Files:**
- Modify: `backend/src/db/repositories/evidence.repository.ts`
- Modify: `backend/test/committer.int.spec.ts`, `backend/test/reconcile.int.spec.ts`, `backend/test/setup-db.ts`

**Interfaces:**
- Consumes: Task 1 tables. Produces: unchanged `EvidenceRow` / method signatures (`forMessages`, `allWithMessage`, `sendersByGraphIds`) — so `committer`/`reconcile`/`alerts`/`presentation` need **no** change.

- [ ] **Step 1: Swap the table references** in `evidence.repository.ts`. Replace `schema.parsedRecord` → `schema.ingestParsedRecord` and `schema.queueMessage` → `schema.ingestEmailMessage` in all three methods (`forMessages`, `allWithMessage`, `sendersByGraphIds`). Column accessors are identical (`.messageId`, `.fields`, `.matchKeys`, `.emailType`, `.poNo`, `.mode`, `.subject`, `.sender`, `.receivedAt`, `.conversationId`, `.graphMessageId`). The `innerJoin` predicate stays `eq(ingestParsedRecord.messageId, ingestEmailMessage.id)`.

- [ ] **Step 2: Update the int-test seeds** — in `committer.int.spec.ts` and `reconcile.int.spec.ts`, replace every `insert(schema.queueMessage)` → `insert(schema.ingestEmailMessage)` and `insert(schema.parsedRecord)` → `insert(schema.ingestParsedRecord)` (drop any `graph`-only queue columns not on the ingest tables, e.g. `retryCount`; keep `graphMessageId`, `subject`, `sender`, `receivedAt`, `fields`, `matchKeys`, `poNo`, `emailType`, `senderType`, `mode`).

- [ ] **Step 3: Update `resetDb()` truncate list** in `test/setup-db.ts` — add `ingest.parsed_record, ingest.email_attachment, ingest.email_message, ingest.ingest_state` to the `truncate table … cascade` list (keep `evidence.parsed_record, queue.queue_message` for now — they still exist).

- [ ] **Step 4: Force clean test DB + run the affected specs**

Run: `psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'drop database if exists cobalt_test with (force)'`
Run: `(cd backend && node_modules/.bin/vitest run test/committer.int.spec.ts test/reconcile.int.spec.ts src/alerts src/presentation)`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
git add backend/src/db/repositories/evidence.repository.ts backend/test/committer.int.spec.ts backend/test/reconcile.int.spec.ts backend/test/setup-db.ts
git commit -m "refactor(evidence): read ingest.parsed_record ⋈ ingest.email_message (intra-DB); seed ingest in int tests"
```

---

### Task 4: Point `EmailRepository` at `ingest` (drop the `queue_normalized` join)

**Files:**
- Modify: `backend/src/db/repositories/email.repository.ts`

**Interfaces:**
- Consumes: Task 1 tables. Produces: same method names; `attachmentById`/`attachmentsFor`/`attachmentsByMessageId` now return **one row per attachment** (no per-normalized-part fan-out) with columns `{ attachmentId, filename, sourceKind, sizeBytes, declaredMime, rawBytes, graphAttachmentId, messageGraphId }` (no `kind`/`mime`/`label`/`textContent`/`imageBytes`).

- [ ] **Step 1: Swap message/attachment reads.** Replace `schema.queueMessage` → `schema.ingestEmailMessage`, `schema.queueAttachment` → `schema.ingestEmailAttachment`, `schema.ingestState` → `schema.ingestSyncState` throughout. In `findIngested`/`emailBody`/`listInbox`/`thread`/`emailsForShipment`/`ingestionStatus`/`unreadCount` the only change is the table symbol (columns `graphMessageId`,`graphId`,`subject`,`sender`,`receivedAt`,`bodyText`,`bodyHtml`,`sourceFile`,`attachmentCount`,`status`,`conversationId`,`toRecipients`,`ccRecipients` all exist on `ingestEmailMessage`). The `listInbox` joins to `reviewEmail`/`emailRead` and the `tracking.shipment_milestones` subquery are unchanged (all same-DB now).

- [ ] **Step 2: Rewrite the two attachment-join methods** to read only `ingestEmailAttachment` (no `queueNormalized`):
```ts
attachmentById(attachmentId: string) {
  return this.db
    .select({
      attachmentId: schema.ingestEmailAttachment.id,
      filename: schema.ingestEmailAttachment.filename,
      sourceKind: schema.ingestEmailAttachment.sourceKind,
      sizeBytes: schema.ingestEmailAttachment.sizeBytes,
      declaredMime: schema.ingestEmailAttachment.declaredMime,
      rawBytes: schema.ingestEmailAttachment.rawBytes,
      graphAttachmentId: schema.ingestEmailAttachment.graphAttachmentId,
      messageGraphId: schema.ingestEmailMessage.graphMessageId,
    })
    .from(schema.ingestEmailAttachment)
    .innerJoin(schema.ingestEmailMessage, eq(schema.ingestEmailMessage.id, schema.ingestEmailAttachment.messageId))
    .where(eq(schema.ingestEmailAttachment.id, attachmentId))
}

async attachmentsFor(graphMessageId: string) {
  const [msg] = await this.db.select({ id: schema.ingestEmailMessage.id, graphMessageId: schema.ingestEmailMessage.graphMessageId })
    .from(schema.ingestEmailMessage).where(eq(schema.ingestEmailMessage.graphMessageId, graphMessageId)).limit(1)
  if (!msg) return []
  return this.db
    .select({
      attachmentId: schema.ingestEmailAttachment.id,
      filename: schema.ingestEmailAttachment.filename,
      sourceKind: schema.ingestEmailAttachment.sourceKind,
      sizeBytes: schema.ingestEmailAttachment.sizeBytes,
      declaredMime: schema.ingestEmailAttachment.declaredMime,
      rawBytes: schema.ingestEmailAttachment.rawBytes,
      graphAttachmentId: schema.ingestEmailAttachment.graphAttachmentId,
      messageGraphId: sql<string>`${msg.graphMessageId}`,
    })
    .from(schema.ingestEmailAttachment)
    .where(eq(schema.ingestEmailAttachment.messageId, msg.id))
}
```
(`thread` still counts attachments via `ingestEmailAttachment`. `attachmentsByMessageId` keeps its shape but reads `ingestEmailAttachment`.) Update the header comment to say the source is now the track-owned `ingest` schema.

- [ ] **Step 3: Adjust the callers in `emails.service.ts` for the flattened shape.** `getAttachments()`/`getAttachmentOriginal()` currently group per-part rows and read `imageBytes`/`textContent`/`mime`/`kind`. With one row per attachment: drop the `groups` collapse; for each row serve `rawBytes` (if present) else fall through to Graph (Task 7). Provisionally (before Task 7) return `parsedOnly:false` and `base64` from `rawBytes` only. Keep `EmailAttachment` shape; set `kind = sourceKind`, `mime = declaredMime`. Remove references to `imageBytes`/`textContent`/`passthrough`.

- [ ] **Step 4: Update the email specs.** In `backend/src/presentation/email-presentation.service.spec.ts` and `backend/src/emails/emails.spec.ts`, update any fake-repo rows to the new flat attachment shape (`{ attachmentId, filename, sourceKind, sizeBytes, declaredMime, rawBytes, graphAttachmentId, messageGraphId }`) and drop `imageBytes`/`textContent`/`kind`/`mime`/`label` fields.

- [ ] **Step 5: Run the email/presentation specs**

Run: `(cd backend && node_modules/.bin/vitest run src/emails src/presentation)`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
git add backend/src/db/repositories/email.repository.ts backend/src/emails/emails.service.ts backend/src/emails/emails.spec.ts backend/src/presentation/email-presentation.service.spec.ts
git commit -m "refactor(email): read ingest.email_message/email_attachment; drop queue_normalized (originals only)"
```

---

### Task 5: Point the raw-SQL repositories at `ingest`

**Files:**
- Modify: `backend/src/db/repositories/masters.repository.ts:425`, `backend/src/db/repositories/shipment.repository.ts` (documents `:320`, documentDetail `:369` + `:388`)

- [ ] **Step 1: `masters.repository.ts`** — in `evidenceMajorities()` change `FROM evidence.parsed_record` → `FROM ingest.parsed_record`.

- [ ] **Step 2: `shipment.repository.ts`** — in `documents()` and `documentDetail()` change the `senderType` subquery `join evidence.parsed_record pr on pr.graph_message_id = se.graph_message_id` → `join ingest.parsed_record pr on pr.graph_message_id = se.graph_message_id`; and in `documentDetail()` change the `emailId` subquery `join queue.queue_message qm on qm.graph_message_id = se.graph_message_id` → `join ingest.email_message qm on qm.graph_message_id = se.graph_message_id`.

- [ ] **Step 3: Run the shipment/masters specs**

Run: `(cd backend && node_modules/.bin/vitest run src/db test/shipment.int.spec.ts 2>/dev/null; node_modules/.bin/vitest run --dir src)`
Expected: PASS. (Run the full `src` unit suite; there is no cross-schema fixture needed — the subqueries are exercised by the documents/detail specs if present, else guarded by typecheck + Task 10 app verification.)

- [ ] **Step 4: Typecheck + commit**

```bash
git add backend/src/db/repositories/masters.repository.ts backend/src/db/repositories/shipment.repository.ts
git commit -m "refactor(repos): masters/shipment raw SQL reads ingest.* instead of queue/evidence"
```

---

### Task 6: Point the one-shot backfill script at `ingest`

**Files:**
- Modify: `backend/src/db/reclassify-platform-documents.ts:42-45`

- [ ] **Step 1:** Change the raw `pg` query `LEFT JOIN queue.queue_message qm ON qm.graph_message_id = se.graph_message_id` → `LEFT JOIN ingest.email_message qm ON qm.graph_message_id = se.graph_message_id`. (This script is a manual maintenance pass; no dedicated spec.)

- [ ] **Step 2: Typecheck + build + commit**

Run: `(cd backend && node_modules/.bin/tsc --noEmit && node_modules/.bin/nest build)` → clean.
```bash
git add backend/src/db/reclassify-platform-documents.ts
git commit -m "refactor(script): reclassify-platform-documents reads ingest.email_message"
```

---

### Task 7: Graph attachment fetch + local→Graph fallback

**Files:**
- Modify: `backend/src/emails/graph.service.ts`, `backend/src/emails/emails.service.ts`
- Test: `backend/src/emails/graph.service.spec.ts` (new or existing), `backend/src/emails/emails.spec.ts`

**Interfaces:**
- Produces: `GraphService.fetchAttachments(graphMessageId): Promise<{ graphAttachmentId: string; filename: string; mime: string; sizeBytes: number; body: Buffer }[]>` and a `mapGraphAttachments()` pure mapper.

- [ ] **Step 1: Write the failing mapper test**

```ts
// backend/src/emails/graph.service.spec.ts (add)
import { expect, it } from 'vitest'
import { mapGraphAttachments } from './graph.service'

it('maps Graph fileAttachments to download rows (decoding contentBytes)', () => {
  const rows = mapGraphAttachments({
    value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'att1', name: 'bl.pdf',
              contentType: 'application/pdf', size: 3, contentBytes: Buffer.from('abc').toString('base64') }],
  })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ graphAttachmentId: 'att1', filename: 'bl.pdf', mime: 'application/pdf', sizeBytes: 3 })
  expect(rows[0]!.body.toString()).toBe('abc')
})
```
Run: `(cd backend && node_modules/.bin/vitest run src/emails/graph.service.spec.ts)` → FAIL (`mapGraphAttachments` not exported).

- [ ] **Step 2: Implement `mapGraphAttachments` + `fetchAttachments`** in `graph.service.ts`:
```ts
export function mapGraphAttachments(json: { value?: any[] }) {
  return (json.value ?? [])
    .filter((a) => (a['@odata.type'] ?? '').includes('fileAttachment') && typeof a.contentBytes === 'string')
    .map((a) => ({
      graphAttachmentId: String(a.id),
      filename: String(a.name ?? 'attachment'),
      mime: String(a.contentType ?? 'application/octet-stream'),
      sizeBytes: Number(a.size ?? 0),
      body: Buffer.from(a.contentBytes, 'base64'),
    }))
}
```
Add the method (mirrors `fetchMessage`):
```ts
/** All file attachments of a message from Graph (original bytes). Throws on transport/auth failure. */
async fetchAttachments(graphMessageId: string) {
  const c = this.cfg()
  const token = await this.accessToken()
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}` +
    `/messages/${encodeURIComponent(graphMessageId)}/attachments?$select=id,name,contentType,size,contentBytes`
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`graph attachments ${res.status}`)
  return mapGraphAttachments((await res.json()) as { value?: any[] })
}
```
Run: `(cd backend && node_modules/.bin/vitest run src/emails/graph.service.spec.ts)` → PASS.

- [ ] **Step 3: Wire the fallback in `emails.service.ts`.** In `getAttachments()`/`getAttachmentOriginal()`, after resolving local rows: if a row has `rawBytes`, serve it (unchanged); **else** if `this.graph.configured()` and the row has `graphAttachmentId` + `messageGraphId`, call `this.graph.fetchAttachments(messageGraphId)` (once, memoized per call) and match by `graphAttachmentId` to serve `body`/`mime`; else `available:false`/`parsedOnly`. Wrap Graph calls in try/catch → log + degrade (never throw), exactly like `getOriginal`.

- [ ] **Step 4: Add a fallback test** in `emails.spec.ts`:
```ts
it('falls back to Graph for an attachment with no local bytes', async () => {
  const service = svc(
    { configured: () => true, fetchAttachments: async () => [{ graphAttachmentId: 'att1', filename: 'bl.pdf', mime: 'application/pdf', sizeBytes: 3, body: Buffer.from('abc') }] },
    { attachmentById: async () => [{ attachmentId: 'x', filename: 'bl.pdf', sourceKind: 'text_pdf', sizeBytes: 3, declaredMime: 'application/pdf', rawBytes: null, graphAttachmentId: 'att1', messageGraphId: 'gmsg1' }] },
  )
  const file = await service.getAttachmentOriginal('x')
  expect(file?.body.toString()).toBe('abc')
})
```
Run: `(cd backend && node_modules/.bin/vitest run src/emails)` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/emails/graph.service.ts backend/src/emails/graph.service.spec.ts backend/src/emails/emails.service.ts backend/src/emails/emails.spec.ts
git commit -m "feat(graph): fetch attachment originals on demand; local-bytes-first fallback (mirrors body path)"
```

---

### Task 8: `POST /api/decisions` `evidence[]` → persist into `ingest`

**Files:**
- Modify: `backend/src/decisions/dto.ts`, `backend/src/decisions/decisions.service.ts`, `backend/src/decisions/decisions.module.ts`
- Create: `backend/src/db/repositories/ingest.repository.ts` (+ register in `backend/src/db/repositories.module.ts`)
- Test: `backend/test/decisions-evidence.int.spec.ts`

**Interfaces:**
- Produces: `IngestRepository.upsertFromDecision(evidence: EvidenceInput[]): Promise<void>` — idempotent on `graph_message_id` (message) and (`graph_message_id`,`record_idx`) (parsed_record).

- [ ] **Step 1: Add the optional `evidence[]` DTO field** in `dto.ts`:
```ts
/** Per-email parsed records + email metadata that back Change-History / PO-enrichment after the DB split.
 *  Additive: legacy callers omit it → no ingest write (unchanged). Populated by cobalt-queue's send-side. */
@IsOptional() @IsArray() evidence?: {
  graphMessageId: string
  recordIdx?: number
  poNo?: string | null
  emailType?: string | null
  senderType?: string | null
  mode?: string | null
  fields?: Record<string, unknown>
  matchKeys?: Record<string, unknown>
  subject?: string | null
  sender?: string | null
  receivedAt?: string | null
  conversationId?: string | null
  sourceFile?: string | null
  attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string }[]
}[]
```

- [ ] **Step 2: Write `ingest.repository.ts`**
```ts
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

export interface EvidenceInput {
  graphMessageId: string; recordIdx?: number
  poNo?: string | null; emailType?: string | null; senderType?: string | null; mode?: string | null
  fields?: Record<string, unknown>; matchKeys?: Record<string, unknown>
  subject?: string | null; sender?: string | null; receivedAt?: string | null
  conversationId?: string | null; sourceFile?: string | null
  attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string }[]
}

/** Persists the per-email parsed records + email metadata a decision carries into the local ingest mirror. */
@Injectable()
export class IngestRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async upsertFromDecision(evidence: EvidenceInput[]): Promise<void> {
    for (const e of evidence) {
      const [msg] = await this.db.insert(schema.ingestEmailMessage)
        .values({
          graphMessageId: e.graphMessageId, subject: e.subject ?? null, sender: e.sender ?? null,
          receivedAt: e.receivedAt ? new Date(e.receivedAt) : null, conversationId: e.conversationId ?? null,
          sourceFile: e.sourceFile ?? null, attachmentCount: e.attachments?.length ?? 0, status: 'DONE',
        })
        .onConflictDoUpdate({
          target: schema.ingestEmailMessage.graphMessageId,
          set: { subject: sql`excluded.subject`, sender: sql`excluded.sender`, receivedAt: sql`excluded.received_at` },
        })
        .returning()
      for (const a of e.attachments ?? []) {
        await this.db.insert(schema.ingestEmailAttachment)
          .values({ messageId: msg!.id, graphAttachmentId: a.graphAttachmentId, filename: a.filename,
                    declaredMime: a.declaredMime ?? null, sizeBytes: a.sizeBytes ?? 0, sourceKind: a.sourceKind ?? null })
          .onConflictDoNothing()
      }
      await this.db.insert(schema.ingestParsedRecord)
        .values({ messageId: msg!.id, graphMessageId: e.graphMessageId, recordIdx: e.recordIdx ?? 0,
                  poNo: e.poNo ?? null, emailType: e.emailType ?? null, senderType: e.senderType ?? null,
                  mode: e.mode ?? null, fields: e.fields ?? {}, matchKeys: e.matchKeys ?? {} })
        .onConflictDoNothing()
    }
  }
}
```
Register it: add `IngestRepository` to the `providers`/`exports` of `backend/src/db/repositories.module.ts` (follow the `EvidenceRepository` pattern). Add a partial unique index so `onConflictDoNothing` on parsed_record is meaningful — in `ingest.ts` add `.unique()` composite or, simpler, rely on message upsert + delete-existing-records-for-message before insert. **Decision:** before inserting parsed records for a message, `delete from ingest.parsed_record where graph_message_id = e.graphMessageId` (idempotent replace) — add that line before the parsed-record insert loop.

- [ ] **Step 3: Call it from `DecisionsService.ingest`.** Inject `IngestRepository`; at the top of `ingest()` (after the `skip` early-return), `if (dto.evidence?.length) await this.ingest.upsertFromDecision(dto.evidence)` — before `this.committer.apply(group)` so `allWithMessage()` sees the rows. Add `IngestRepository` to `decisions.module.ts` imports/providers (or via `RepositoriesModule`).

- [ ] **Step 4: Write the failing int test**
```ts
// backend/test/decisions-evidence.int.spec.ts
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, closeTestDb, resetDb, type TestDB } from './setup-db'
import { IngestRepository } from '../src/db/repositories/ingest.repository'

let db: TestDB
beforeAll(async () => { db = (await getTestDb()).db })
beforeEach(async () => { await resetDb(db) })
afterAll(async () => { await closeTestDb() })

it('persists evidence[] into ingest.* idempotently', async () => {
  const repo = new IngestRepository(db as any)
  const ev = [{ graphMessageId: 'g1', recordIdx: 0, poNo: 'PO9', subject: 's', fields: { customer_code: 'C' },
                attachments: [{ graphAttachmentId: 'a1', filename: 'x.pdf' }] }]
  await repo.upsertFromDecision(ev)
  await repo.upsertFromDecision(ev) // re-POST
  const r = await db.execute(sql`select
    (select count(*) from ingest.email_message where graph_message_id='g1') m,
    (select count(*) from ingest.parsed_record where graph_message_id='g1') p,
    (select count(*) from ingest.email_attachment) a`)
  const row = (r as unknown as { rows: { m: number; p: number; a: number }[] }).rows[0]!
  expect([row.m, row.p, row.a]).toEqual([1, 1, 1])
})
```
Run: `psql … -c 'drop database if exists cobalt_test with (force)'` then `(cd backend && node_modules/.bin/vitest run test/decisions-evidence.int.spec.ts)` → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
git add backend/src/decisions/ backend/src/db/repositories/ingest.repository.ts backend/src/db/repositories.module.ts backend/src/db/schema/ingest.ts backend/test/decisions-evidence.int.spec.ts
git commit -m "feat(decisions): additive evidence[] payload persists parsed_record + email metadata into ingest"
```

---

### Task 9: Delete `queue` + `evidence` (teardown)

**Files:**
- Delete: `backend/src/db/schema/queue.ts`, `backend/src/db/schema/evidence.ts`
- Modify: `backend/src/db/schema/index.ts`, `backend/drizzle.config.ts`, `backend/src/db/seed.ts`, `backend/test/setup-db.ts`
- Create (generated + hand-finished): `backend/drizzle/0016_drop_queue_evidence.sql`

- [ ] **Step 1: Prove nothing references the old schemas.** Run:
`grep -rnE 'queueMessage|queueAttachment|queueNormalized|parsedRecord|schema\.ingestState|queue\.queue_message|evidence\.parsed_record' backend/src backend/test`
Expected: **zero** hits except inside `schema/queue.ts`/`schema/evidence.ts` themselves. Fix any stragglers (e.g. `presentation/mappers/email.mapper.ts` type imports) before proceeding.

- [ ] **Step 2: Remove the queue/evidence seed writes** from `seed.ts` (the inserts you left in Task 2) — keep only the `ingest.*` writes.

- [ ] **Step 3: Drop the schema files + exports.** Delete `schema/queue.ts` and `schema/evidence.ts`; remove their two `export * from './queue'|'./evidence'` lines from `schema/index.ts`; set `drizzle.config.ts` `schemaFilter` to `['public', 'tracking', 'audit', 'alerts', 'ingest']`.

- [ ] **Step 4: Update `resetDb()`** in `setup-db.ts` — remove `evidence.parsed_record, queue.queue_message` from the truncate list (they no longer exist); keep the `ingest.*` entries from Task 3.

- [ ] **Step 5: Generate + finish the drop migration.** Run `(cd backend && node_modules/.bin/drizzle-kit generate)`. It emits `DROP TABLE` for the queue/evidence tables. Append the schema drops to the generated `0016_*.sql` (rename to `0016_drop_queue_evidence.sql`):
```sql
DROP SCHEMA IF EXISTS "evidence" CASCADE;
DROP SCHEMA IF EXISTS "queue" CASCADE;
```

- [ ] **Step 6: Force clean test DB + run the FULL backend suite**

Run: `psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'drop database if exists cobalt_test with (force)'`
Run: `(cd backend && node_modules/.bin/vitest run)`
Expected: all specs PASS; the fresh `cobalt_test` replays 0000→0016 and ends with **no** `queue`/`evidence` schema.

- [ ] **Step 7: Assert the schemas are gone + typecheck/build**

Run: `psql "postgres://postgres:postgres@localhost:5432/cobalt_test" -c "select schema_name from information_schema.schemata where schema_name in ('queue','evidence','ingest')"`
Expected: only `ingest`.
Run: `(cd backend && node_modules/.bin/tsc --noEmit && node_modules/.bin/nest build)` → clean.

- [ ] **Step 8: Commit**

```bash
git add -A backend/src/db/schema backend/drizzle.config.ts backend/src/db/seed.ts backend/test/setup-db.ts backend/drizzle/
git commit -m "feat(db): drop queue/evidence schemas — ShipTrack now owns only tracking/audit/alerts/ingest"
```

---

### Task 10: Full-stack verification on a fresh ShipTrack-only DB

**Files:** none (verification + evidence).

- [ ] **Step 1: Recreate the dev DB clean.**

Run: `psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'drop database if exists cobalt with (force)' -c 'create database cobalt'`
Run: `(cd backend && node_modules/.bin/drizzle-kit migrate && node_modules/.bin/ts-node -P tsconfig.json src/db/seed.ts)`
Run: `psql "postgres://postgres:postgres@localhost:5432/cobalt" -c "select schema_name from information_schema.schemata where schema_name in ('queue','evidence','ingest')"` → only `ingest`.

- [ ] **Step 2: Green baseline — both packages.**

Run: `(cd backend && node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit && node_modules/.bin/nest build)`
Run: `(cd frontend && node_modules/.bin/vitest run && node_modules/.bin/tsc && node_modules/.bin/vite build)`
Expected: backend ≈ prior count **+3 new specs** all green (incl. `decisions-evidence`, `ingest-schema`, graph attachment); frontend green incl. `src/test/no-db-access.test.ts`.

- [ ] **Step 3: Drive the app (mirror-backed).** Start `pnpm --filter backend dev` + `pnpm --filter frontend dev` (or the preview tooling). Verify against the seeded mock corpus:
  - **Inbox** lists emails (from `ingest.email_message`), unread count renders.
  - **View original** for a mock email shows the seeded body; **attachment download** returns the seeded bytes.
  - **PO-enrichment + Change-History** on a shipment render (from `ingest.parsed_record`).
  - **Unlinked Documents** list + a document's detail panel open (sender type + source-email id resolve).
  - **Settings** "last sync" tile shows the seeded `ingest.ingest_state`.

- [ ] **Step 4: Exercise the decisions receive path live.** With the backend running, POST a minimal decision carrying `evidence[]` (EDITOR/ADMIN service token) and confirm the new `ingest` rows + downstream:
```bash
curl -sS -X POST http://localhost:3000/api/decisions -H 'content-type: application/json' \
  -H "authorization: Bearer $EDITOR_TOKEN" \
  -d '{"matchKey":{"booking_no":"BK-VERIFY-1"},"fields":{"customer_code":"C"},"confidence":90,
       "evidence":[{"graphMessageId":"verify-g1","recordIdx":0,"poNo":"PO-V1","subject":"verify",
       "fields":{"customer_code":"C"}}]}'
psql "postgres://postgres:postgres@localhost:5432/cobalt" -c "select count(*) from ingest.parsed_record where graph_message_id='verify-g1'"
```
Expected: HTTP 2xx; the `parsed_record` count is 1.

- [ ] **Step 5: Update docs + memory (no code).** Tick the DB-split items in `TODO.md`; note in the `cobalt-system-wiring` memory that ShipTrack now owns its DB (tracking/audit/alerts/ingest) and reads email/evidence via the `ingest` mirror + Graph, not the shared `queue`/`evidence` schemas; record the remaining cobalt-queue send-side follow-up. Commit:
```bash
git add TODO.md
git commit -m "docs(todo): ShipTrack DB split done (ingest mirror + Graph-on-demand); cobalt-queue send-side remains"
```

---

## Self-review

**Spec coverage:** `ingest` schema (T1) ✓ · rewire all 9 files / 7 joins: evidence.repo (T3), email.repo (T4), masters+shipment (T5), reclassify (T6), seed (T2/T9), int specs + setup-db (T3/T9) ✓ · Graph attachment fetch (T7) ✓ · `evidence[]` payload + receive side (T8) ✓ · drop queue/evidence + config/migration (T9) ✓ · verification incl. app + decisions path (T10) ✓. Out-of-scope cobalt-queue send-side is explicitly a T10-Step-5 follow-up note. `ingest_state` mirrored via `ingestSyncState` (T1/T4). `zod.ts` `ParsedFields` untouched (still valid — `ingest.parsed_record.fields` has the same shape).

**Placeholder scan:** no TBD/TODO; every code/edit step shows the code or the exact old→new string; commands have expected output.

**Type consistency:** `ingestEmailMessage`/`ingestEmailAttachment`/`ingestParsedRecord`/`ingestSyncState` used identically across T1–T9; the flattened attachment row shape (`{ attachmentId, filename, sourceKind, sizeBytes, declaredMime, rawBytes, graphAttachmentId, messageGraphId }`) is defined in T4 and consumed unchanged in T4/T7 specs; `EvidenceInput` defined in T8 matches the `dto.ts` `evidence[]` shape and the `IngestRepository.upsertFromDecision` signature.
