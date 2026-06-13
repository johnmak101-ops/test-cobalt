import { pgSchema, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { MATCH_ACTION, MATCH_REQUEST_STATUS, MATCH_DECISION_STATUS, CONFIDENCE } from './enums'

/**
 * MATCH — the VM2(agent) ↔ VM1(committer) boundary, carried over Postgres (no cross-VM HTTP).
 * NestJS writes a `match_request` (evidence + pre-fetched candidates); the matching agent
 * writes a `match_decision`; the deterministic NestJS committer drains decisions and applies them.
 */
export const match = pgSchema('match')

export const matchRequest = match.table('match_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  evidenceRecordId: uuid('evidence_record_id').notNull(), // logical FK → evidence.parsed_record.id
  messageId: uuid('message_id'), // logical FK → queue.queue_message.id
  candidates: jsonb('candidates').$type<unknown>(), // bookings/legs (by match_keys) + masters snapshot
  status: text('status', { enum: MATCH_REQUEST_STATUS }).notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const matchDecision = match.table('match_decision', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => matchRequest.id, { onDelete: 'cascade' }),
  evidenceRecordId: uuid('evidence_record_id').notNull(),
  action: text('action', { enum: MATCH_ACTION }).notNull(),
  targetBookingId: uuid('target_booking_id'), // logical FK → tracking.bookings.id
  targetShipmentId: uuid('target_shipment_id'), // logical FK → tracking.shipments.id
  decision: jsonb('decision').$type<Record<string, unknown>>(), // field diffs, match_keys, etc.
  extractionConfidence: text('extraction_confidence', { enum: CONFIDENCE }),
  resolutionConfidence: text('resolution_confidence', { enum: CONFIDENCE }), // split confidences
  reasoning: text('reasoning'),
  status: text('status', { enum: MATCH_DECISION_STATUS }).notNull().default('PENDING_COMMIT'),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
