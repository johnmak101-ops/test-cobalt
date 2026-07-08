# Separate ShipTrack onto its own database (light mirror + Graph-on-demand)

- **Date:** 2026-07-08
- **Repo:** `cobalt_track_system` (customer-facing tracking app, "ShipTrack")
- **Status:** Design approved, pending spec review → implementation plan
- **Related:** `TODO.md` → "Architecture — split queue + ShipTrack into SEPARATE databases"; memory `cobalt-system-wiring`; prior spec `2026-07-07-inline-contracts-into-backend-design.md`

---

## 🧒 一句話（ELI5）

現在 ShipTrack 跟 cobalt-queue **住在同一個資料庫**，ShipTrack 會直接伸手進 cobalt-queue 的抽屜（`queue`/`evidence` schema）拿 email 跟解析結果。這次要讓 ShipTrack **搬到自己的資料庫**，不再共用抽屜。

作法：ShipTrack 自己家裡放一份**輕量影印本**（`ingest` schema：只存 email 的 metadata + `parsed_record` 解析文字，**不存**大檔案）。真正要看 email 內文或下載附件時，**直接去 Microsoft Graph（信箱）抓**——這條路 body 已經做好了，附件再補一小塊。解析結果（`parsed_record`）則由 cobalt-queue 在既有的 `POST /api/decisions` 裡**順便推過來**。

因為這個 DB 是**可丟的 dev 資料庫**，不用搬資料、不用怕弄壞 production——直接重建 + reseed 就好。拆完之後，那 7 個原本跨 schema 的 join 全部變成同一個 DB 內的 join，只是換個表名。

---

## Context / current state

ShipTrack and `cobalt-queue` both connect to ONE Postgres `cobalt` and **share** the `queue` + `evidence` schemas; ShipTrack reads them in-process via cross-schema SQL.

| Fact | Value |
|---|---|
| Connection | `drizzle.provider.ts` — single `DATABASE_URL`, one pool; comment: "shares ONE Postgres with the write-heavy queue" |
| Schema filter | `drizzle.config.ts` → `['public','queue','evidence','tracking','audit','alerts']` |
| Hard coupling | `evidence.parsed_record.message_id` → **cross-schema FK** to `queue.queue_message.id` (`schema/evidence.ts:14`) |
| Runtime touch points | **9 files** read/write `queue`/`evidence` tables |
| Cross-schema joins | **7**, and **every one joins `queue`/`evidence` against a `tracking` table** — so all 7 break the instant the schemas physically separate (cross-DB joins are impossible) |
| Enabler | `POST /api/decisions` already carries the **merged** decision (`fields`, `evidenceRefs`, `events`, `pos`/`poQty`, `conflicts`) — but **not** the per-email `parsed_record` rows |
| Graph already wired | `emails/graph.service.ts` `GraphService` + `emails.service.ts` `getOriginal()` **already re-fetch the email BODY from Microsoft Graph** when the local body is purged; Graph is already treated as the durable "view original" source |

### The 7 cross-schema joins (the hard cases)

| # | Site | Join | Powers |
|---|---|---|---|
| 1 | `email.repository.listInbox` | `queue_message × review_email × email_read` + subquery `tracking.shipment_milestones` | Inbox list |
| 2 | `email.repository.unreadCount` | `queue_message × email_read` | Unread KPI |
| 3 | `email.repository.emailsForShipment` | `shipment_emails × queue_message` | "Related Emails" |
| 4 | `shipment.repository.documents` | `tracking.shipment_emails × evidence.parsed_record` | Unlinked Documents list |
| 5 | `shipment.repository.documentDetail` | `shipment_emails × parsed_record` AND `shipment_emails × queue_message` | Document detail + source-email id |
| 6 | `db/reclassify-platform-documents.ts` | `shipment_emails × queue_message` (raw `pg`) | One-shot platform backfill |
| 7 | `evidence.repository.forMessages` / `allWithMessage` | `parsed_record × queue_message` | Change-History replay, PO-enrichment |

Full inventory of the 9 runtime files + definition/migration/test files: see the background audit summarized in `TODO.md`.

## Goal

Make ShipTrack run on its **own database**, owning only `tracking` / `audit` / `alerts` + a new **`ingest`** mirror schema — with **no** `queue`/`evidence` schemas in its DB. Integration with cobalt-queue becomes **HTTP-only** (`POST /api/decisions`) plus **on-demand Microsoft Graph** for heavy email content. ShipTrack must build, test, seed, and run entirely from its own DB throughout.

## Scope

**Constraint (user):** the live DB is **disposable, dev-only → no data migration**. We reset and reseed.

### In scope (ShipTrack side — self-contained and verifiable in dev)

1. New **`ingest`** mirror schema: `email_message`, `email_attachment`, `parsed_record` — light (metadata + parsed text). Body/attachment **bytes are NULLABLE dev-seed-only columns**; real mail leaves them null and falls back to Graph.
2. Rewire all **9 files / 7 joins** to read `ingest.*` (intra-DB joins; mostly a schema-name swap).
3. **Graph-on-demand** for heavy content: body (already built) + **new** attachment-original fetch (`GraphService.fetchAttachments`), with **local-bytes-first → Graph fallback** (symmetric with the existing body path).
4. Extend `POST /api/decisions` (**additive, back-compat**) with an optional per-email `evidence[]` array; implement ShipTrack's **receive** side (persist into `ingest`).
5. Replace `seed.ts` writes to `queue`/`evidence` with writes to `ingest` (mock corpus + optional seed bytes so the demo shows bodies/attachments).
6. Config/migration/tests: drop `queue`/`evidence` from `drizzle.config.ts`; delete `schema/queue.ts` + `schema/evidence.ts`; add `schema/ingest.ts` + migration; update `test/setup-db.ts` and the two integration specs.

### Out of scope (documented contract; separate `D:\cobalt-queue` change — a follow-up)

- cobalt-queue pointing at its **own** DB and **populating the `evidence[]` push** (the send-side).
- ShipTrack's dev demo + tests run off its own **seed** + **synthetic decision payloads**, so the cobalt-queue change is **not blocking** for this spec. The contract in §"decisions payload extension" is the hand-off.

## Decision

**Light track-owned mirror + Graph-on-demand**, chosen over:

- **Full HTTP API on demand** (ShipTrack stores nothing; calls cobalt-queue for everything): would force rewriting all 7 joins into app-level fetch-then-join, add a network hop to list endpoints, and break email viewing when the queue is down.
- **Full mirror incl. all bytes**: simplest joins but duplicates large binaries — needless given Graph is already the durable source and the DB is disposable dev-only.

The mirror keeps the 7 join sites almost unchanged (schema-name swap), and the heavy source is **Graph, not cobalt-queue's API** — so **cobalt-queue never needs an email API**.

---

## Detailed design

### 1. The `ingest` schema (`backend/src/db/schema/ingest.ts`)

Mirrors exactly the columns the current `queue`/`evidence` reads select — nothing more.

**`ingest.email_message`** — mirror of the `queue.queue_message` columns ShipTrack reads:
`id (uuid pk)`, `graph_message_id (text)` ← Graph **immutable** id, `graph_id (text)`, `subject`, `sender`, `received_at (timestamptz)`, `status`, `conversation_id`, `source_file`, `attachment_count (int)`, `to_recipients (jsonb)`, `cc_recipients (jsonb)`, `body_text (text, NULLABLE — dev-seed only)`, `body_html (text, NULLABLE — dev-seed only)`, `created_at`.

**`ingest.email_attachment`** — mirror of the attachment metadata + optional dev bytes:
`id (uuid pk)`, `message_id → ingest.email_message`, `graph_attachment_id (text)` ← for Graph fetch, `filename`, `declared_mime`, `size_bytes (int)`, `source_kind`, `raw_bytes (bytea, NULLABLE — dev-seed only)`, `created_at`.
*Note:* the queue's **normalized** artifacts (`queue_normalized.text_content`/`image_bytes` — e.g. docx→preview-image conversions) are **not mirrored** (see Risk 1).

**`ingest.parsed_record`** — 1:1 mirror of `evidence.parsed_record`, append-only:
`id`, `graph_message_id`, `message_id → ingest.email_message`, `record_idx`, `po_no`, `email_type`, `sender_type`, `mode`, `fields (jsonb)`, `match_keys (jsonb)`, `confidence`, `parser_adapter`, `created_at`.

All FKs are intra-schema / intra-DB. **No** cross-schema FK. `db/zod.ts` `ParsedFields` is retained (now the contract for `ingest.parsed_record.fields`).

### 2. Repository rewrites (the 7 joins → intra-DB)

| Site | Change |
|---|---|
| `evidence.repository.ts` (`forMessages`, `allWithMessage`, `sendersByGraphIds`) | `schema.parsedRecord`/`schema.queueMessage` → `ingest.parsedRecord`/`ingest.emailMessage`; joins now intra-`ingest`. Interfaces (`EvidenceRow`) unchanged → **zero change** in `committer`/`reconcile`/`alerts`/`presentation` consumers. |
| `email.repository.ts` (all 11 methods) | `queue_message`/`queue_attachment`/`queue_normalized`/`ingest_state` → `ingest.email_message`/`ingest.email_attachment`. Drop `queue_normalized` joins (bytes now come from `email_attachment.raw_bytes` or Graph). `listInbox` still joins `review_email`/`email_read`/`shipment_milestones` — all app-owned, now same-DB. `ingest_state` (Graph watermark) → see §5. |
| `masters.repository.ts` (`evidenceMajorities`, raw SQL `FROM evidence.parsed_record`) | → `FROM ingest.parsed_record`. |
| `shipment.repository.ts` (`documents`, `documentDetail`, raw-SQL subqueries) | `evidence.parsed_record`/`queue.queue_message` → `ingest.parsed_record`/`ingest.email_message`; now same-DB joins with `tracking.shipment_emails`. |
| `db/reclassify-platform-documents.ts` (one-shot) | raw `pg` `queue.queue_message` → `ingest.email_message`. |

### 3. Graph attachment fetch (new — mirrors the existing body path)

- Add **`GraphService.fetchAttachments(graphMessageId)`** → `GET /v1.0/users/{mailbox}/messages/{id}/attachments?$select=id,name,contentType,size,contentBytes`, mapping `fileAttachment.contentBytes` (base64) → the `EmailAttachment` DTO.
- `emails.service.ts` `getAttachments()` / `getAttachmentOriginal()`: resolve **local first** (`ingest.email_attachment.raw_bytes`, populated for dev/mock) → **else Graph** (`graph_attachment_id` + `graph_message_id`), exactly like `getOriginal()` does for the body today. Degrades to `available:false` when neither is present (unchanged contract).
- Graph returns the **original** file only — not the queue's normalized preview (Risk 1).

### 4. `POST /api/decisions` payload extension (contract for cobalt-queue)

Additive, back-compat (legacy callers omit it → no mirror write, unchanged behavior):

```ts
// CreateDecisionDto (new optional field)
evidence?: {
  graphMessageId: string
  recordIdx: number
  poNo?: string | null
  emailType?: string | null
  senderType?: string | null
  mode?: string | null
  fields?: Record<string, unknown>
  matchKeys?: Record<string, unknown>
  // email metadata for the ingest.email_message row:
  subject?: string | null
  sender?: string | null
  receivedAt?: string | null
  conversationId?: string | null
  sourceFile?: string | null
  attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string }[]
}[]
```

`DecisionsService.ingest()` **upserts** the `ingest.email_message` + `ingest.email_attachment` + `ingest.parsed_record` rows from `evidence[]` (idempotent on `graph_message_id` / `record_idx`) before handing the merged group to the committer. This is what feeds `allWithMessage()`/`forMessages()` after the split.

### 5. `ingest_state` (Graph sync watermark)

`email.repository.ingestState()` reads `queue.ingest_state` (last Graph sync). Options: (a) mirror a minimal `ingest.ingest_state` fed by the decisions push / a heartbeat; (b) since ShipTrack now talks to Graph itself, surface a ShipTrack-local watermark. **Decision:** add `ingest.ingest_state` (light, single-row) written on decision ingest; dev seed sets one row. Keeps the Settings "last sync" tile working.

### 6. Seed (`db/seed.ts`)

Replace the writes to `queue.queue_message`/`queue_attachment`/`queue_normalized` (+ the `review_email.message_id` back-write) with writes to `ingest.email_message` (incl. seeded `body_text`/`body_html`), `ingest.email_attachment` (incl. seeded `raw_bytes` for the demo), and `ingest.parsed_record`. Keep the `mock:` id convention so `getOriginal()`/attachments resolve locally in dev (no Graph source for mock mail).

### 7. Config / migration / tests

| Item | Change |
|---|---|
| `drizzle.config.ts` | `schemaFilter` → `['public','tracking','audit','alerts','ingest']` |
| `schema/queue.ts`, `schema/evidence.ts` | **delete**; add `schema/ingest.ts`; update `schema/index.ts` + `contracts.ts` exports (keep `zod.ts` `ParsedFields`) |
| `schema/tracking.ts` | logical-FK comments (`evidenceRecordId`, `shipment_emails.message_id`/`graph_message_id`, `email_read.message_id`) now reference `ingest.*`; keep them **logical** (no hard FK) to avoid seed-order coupling |
| Migrations | Dev/disposable → add one migration that **creates `ingest`** and **drops `queue`+`evidence`**; regenerate snapshot. (Migration-chain squash is optional, deferred.) |
| `test/setup-db.ts` | truncate `ingest.*` instead of `queue.*`/`evidence.*` |
| `committer.int.spec.ts`, `reconcile.int.spec.ts` | seed `ingest.email_message` + `ingest.parsed_record` instead of `queue`/`evidence` |

---

## Verification (dev — evidence before "done")

1. **Fresh ShipTrack-only DB** (own `DATABASE_URL`): run the migration + seed → assert `queue`/`evidence` schemas **do not exist**; `ingest` does.
2. **Green baseline:** backend `tsc` + `vitest run` (target ≈ 373) + build, frontend `tsc` + `vitest run` (incl. the `no-db-access` guardrail) + build.
3. **Exercise the app from the mirror** (via `/run` or preview): Inbox loads; "view original" shows the seeded mock body; attachment download serves seeded bytes; PO-enrichment + Change-History render from `ingest.parsed_record`; Unlinked Documents + document detail; alerts.
4. **Decisions receive path:** POST a synthetic `/api/decisions` carrying `evidence[]` → assert `ingest.email_message`/`parsed_record` rows written and Change-History / PO-enrichment reflect them.
5. **Graph attachment path:** unit-test `GraphService.fetchAttachments` mapping; confirm graceful `available:false` when `GRAPH_*` unset (dev) and real fetch when configured.

## Risks & caveats

1. **Normalized attachment previews are dropped.** `queue_normalized` (docx→image, parsed html/csv) is not mirrored; Graph returns only the original file. Inline office-doc **preview** degrades to "download the original." Body + original-file download unaffected.
2. **Mock/dev corpus has no Graph source.** `mock:` mail relies on seeded `ingest` bytes for the demo; Graph-fetch is the **prod** path for real mail.
3. **`graph_message_id` must be Graph's immutable id** and the mail must still exist in the mailbox; deleted/moved mail → view-original/attachments degrade (already graceful).
4. **cobalt-queue send-side is a separate repo change.** Until done, the mirror is fed only by seed + synthetic payloads — sufficient for dev, but the split is not "wired to live queue" until that lands.
5. **`allWithMessage()` stays a full scan** over the mirror (behavior-preserving); the indexed-SQL perf fix remains a separate `TODO.md` item.
