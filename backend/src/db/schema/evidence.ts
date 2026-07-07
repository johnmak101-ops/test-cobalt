import { pgSchema, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { queueMessage } from './queue'

/**
 * EVIDENCE — append-only "what each email claimed" (parser output).
 * One row per (email × PO record); mirrors the soul-doc 20-field structure.
 * WRITTEN by cobalt-queue's parser; READ by track-system's matching/committer.
 * THIS TABLE IS THE CONTRACT SEAM between the two services.
 */
export const evidence = pgSchema('evidence')

export const parsedRecord = evidence.table('parsed_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id')
    .notNull()
    .references(() => queueMessage.id, { onDelete: 'cascade' }),
  graphMessageId: text('graph_message_id'),
  recordIdx: integer('record_idx').notNull(),
  poNo: text('po_no'),
  emailType: text('email_type'),
  senderType: text('sender_type'),
  mode: text('mode'),
  // the 20 fields (see ParsedFields in ../zod.ts for the shape)
  fields: jsonb('fields').$type<Record<string, unknown>>(),
  // { customer_po, so_no, booking_no, hbl_awb_fcr_no, mbl, conversation_id }
  matchKeys: jsonb('match_keys').$type<Record<string, unknown>>(),
  amendments: jsonb('amendments').$type<unknown[]>(),
  needsReview: jsonb('needs_review').$type<unknown[]>(),
  confidence: text('confidence'),
  parserAdapter: text('parser_adapter'), // stub | azure | responses | opencode | openpave
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
