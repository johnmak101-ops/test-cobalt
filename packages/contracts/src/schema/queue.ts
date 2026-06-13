import { pgSchema, uuid, text, integer, timestamp, boolean, jsonb, customType } from 'drizzle-orm/pg-core'

/** Postgres `bytea` column mapped to a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * The QUEUE schema — owned and WRITTEN by cobalt-queue (VM2 ingestion).
 * Mirrored here verbatim so track-system and the queue share ONE definition.
 * (Convergence step: point cobalt-queue/src/db/schema.ts at this package to kill drift.)
 */
export const queue = pgSchema('queue')

export const MESSAGE_STATUS = [
  'PENDING', // pulled, not yet normalized
  'NORMALIZING',
  'QUEUED', // normalized + handed to pg-boss for the parser agent
  'PROCESSING', // claimed by the agent (set downstream)
  'DONE', // fully resolved (set downstream) → eligible for blob cleanup
  'FAILED',
  'DEAD_LETTER',
] as const

export const queueMessage = queue.table('queue_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  // internetMessageId — the stable dedup key across re-syncs / CCs of the same message
  graphMessageId: text('graph_message_id').notNull().unique(),
  // Graph item id — used to lazily re-fetch the original ("view original")
  graphId: text('graph_id'),
  // original source filename (e.g. the .msg file) — used to join evidence to labelled data
  sourceFile: text('source_file'),
  conversationId: text('conversation_id'),
  subject: text('subject'),
  sender: text('sender'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  status: text('status', { enum: MESSAGE_STATUS }).notNull().default('PENDING'),
  attachmentCount: integer('attachment_count').notNull().default(0),
  needsReview: boolean('needs_review').notNull().default(false),
  retryCount: integer('retry_count').notNull().default(0),
  error: text('error'),
  // set when the maintenance sweep deleted this message's bytea payloads (see RETENTION_DAYS)
  blobsPurgedAt: timestamp('blobs_purged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Poller checkpoint — one row per monitored mailbox (`inbox:<mailbox>`). */
export const ingestState = queue.table('ingest_state', {
  id: text('id').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true }).notNull(),
  deltaLink: text('delta_link'),
  stuckGraphId: text('stuck_graph_id'),
  stuckCount: integer('stuck_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const queueAttachment = queue.table('queue_attachment', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id')
    .notNull()
    .references(() => queueMessage.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  parentFilename: text('parent_filename'), // set when unpacked from a zip
  sourceKind: text('source_kind').notNull(), // image | text_pdf | scanned_pdf | docx | xlsx | zip | text | unknown
  contentHash: text('content_hash').notNull(), // sha-256 of raw bytes (content-level dedup)
  sizeBytes: integer('size_bytes').notNull(),
  declaredMime: text('declared_mime'),
  // Option A keeps the raw blob transiently; we store the NORMALIZED output and
  // re-fetch the original from Graph, so this stays null by default.
  rawBytes: bytea('raw_bytes'),
  needsReview: boolean('needs_review').notNull().default(false),
  warnings: jsonb('warnings').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const queueNormalized = queue.table('queue_normalized', {
  id: uuid('id').primaryKey().defaultRandom(),
  attachmentId: uuid('attachment_id')
    .notNull()
    .references(() => queueAttachment.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  kind: text('kind').notNull(), // text | csv | html | image | passthrough
  textContent: text('text_content'), // for text/csv/html
  imageBytes: bytea('image_bytes'), // for image (PNG/JPG the agent OCRs)
  mime: text('mime'),
  label: text('label'), // page-N, sheet name, etc.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
