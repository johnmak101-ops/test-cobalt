import { pgSchema, uuid, text, timestamp, boolean, bigserial } from 'drizzle-orm/pg-core'
import { AUDIT_ENTITY, CHANGE_TYPE, SOURCE_TYPE } from './enums'

/** AUDIT (append-only) — the trust mechanism behind aggressive auto-apply. Every write lands here. */
export const audit = pgSchema('audit')

export const changeLog = audit.table('change_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'number' }), // monotonic ordering across the whole log
  entityType: text('entity_type', { enum: AUDIT_ENTITY }).notNull(),
  entityId: uuid('entity_id').notNull(),
  field: text('field'), // null for create/delete events
  oldValue: text('old_value'),
  newValue: text('new_value'),
  changeType: text('change_type', { enum: CHANGE_TYPE }).notNull(),
  sourceType: text('source_type', { enum: SOURCE_TYPE }).notNull(), // email | manual | system | agent
  sourceId: text('source_id'), // evidence_record_id | match_decision_id | graph message id
  actorUserId: uuid('actor_user_id'), // logical FK → tracking.users.id (manual edits)
  isDelay: boolean('is_delay').notNull().default(false),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
