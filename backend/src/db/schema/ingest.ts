import { pgSchema, uuid, text, integer, timestamp, jsonb, customType, unique } from 'drizzle-orm/pg-core'

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
  messageId: uuid('message_id').notNull().references(() => ingestEmailMessage.id, { onDelete: 'cascade' }),
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
}, (t) => [
  // one row per (email, record index) — lets a re-POST of the same decision upsert in place instead of
  // delete-then-insert (which isn't concurrency-safe: a same-batch duplicate could silently overwrite).
  unique('ingest_parsed_record_gmid_idx_uq').on(t.graphMessageId, t.recordIdx),
])

/** Graph sync watermark for the Settings "last sync" tile (was `queue.ingest_state`). */
export const ingestSyncState = ingest.table('ingest_state', {
  id: text('id').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
